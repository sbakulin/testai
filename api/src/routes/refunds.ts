import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { transaction } from '../db.js';
import { MockpayError } from '../mockpay.js';
import { toSums } from '../money.js';

interface PaymentRow {
  id: string;
  amount_minor: number;
  status: string;
  provider_payment_id: string | null;
}

export function refundsRoutes(app: FastifyInstance, { db, mockpay }: AppDeps): void {
  const findPayment = db.prepare('SELECT id, amount_minor, status, provider_payment_id FROM payments WHERE id = ?');
  const refundedSum = db.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM refunds
     WHERE payment_id = ? AND status IN ('processing', 'succeeded')`,
  );
  const insertRefund = db.prepare(
    `INSERT INTO refunds (id, payment_id, amount_minor, status, provider_refund_id, created_at, updated_at)
     VALUES (?, ?, ?, 'processing', NULL, ?, ?)`,
  );
  const setProviderId = db.prepare('UPDATE refunds SET provider_refund_id = ?, updated_at = ? WHERE id = ?');
  const markFailed = db.prepare(
    `UPDATE refunds SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'processing'`,
  );

  app.post<{ Params: { id: string } }>('/payments/:id/refunds', async (req, reply) => {
    const payment = findPayment.get(req.params.id) as PaymentRow | undefined;
    if (!payment) return reply.code(404).send({ error: 'payment_not_found' });

    const { amount_minor } = (req.body ?? {}) as { amount_minor?: unknown };
    if (typeof amount_minor !== 'number' || !Number.isSafeInteger(amount_minor) || amount_minor <= 0) {
      return reply.code(400).send({ error: 'invalid_amount' });
    }

    const id = `ref_${randomBytes(6).toString('hex')}`;
    // Проверка остатка и вставка возврата — в одной транзакции
    const rejection = transaction(db, () => {
      const current = findPayment.get(payment.id) as unknown as PaymentRow;
      if (current.status !== 'succeeded') return 'payment_not_succeeded';
      const { total } = refundedSum.get(payment.id) as { total: number };
      if (total + amount_minor > current.amount_minor) return 'refund_exceeds_payment';
      const now = new Date().toISOString();
      insertRefund.run(id, payment.id, amount_minor, now, now);
      return null;
    });
    if (rejection) return reply.code(422).send({ error: rejection });

    try {
      const created = await mockpay.createRefund({
        payment_id: payment.provider_payment_id ?? '',
        amount: toSums(amount_minor),
        idempotency_key: id,
      });
      setProviderId.run(created.id, new Date().toISOString(), id);
    } catch (err) {
      if (err instanceof MockpayError) {
        // Только явный отказ провайдера (4xx) закрывает возврат; при 5xx исход неизвестен
        if (err.status >= 400 && err.status < 500) {
          markFailed.run(new Date().toISOString(), id);
          return reply.code(502).send({ error: 'provider_rejected' });
        }
        return reply.code(502).send({ error: 'provider_error' });
      }
      // StandUnavailableError: провайдер мог обработать запрос, возврат остаётся в processing до вебхука
      throw err;
    }

    return reply.code(201).send({ id, payment_id: payment.id, amount_minor, status: 'processing' });
  });
}
