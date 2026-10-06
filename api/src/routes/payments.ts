import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { toSums } from '../money.js';

export function paymentsRoutes(app: FastifyInstance, { db, mockpay }: AppDeps): void {
  app.post('/payments', async (req, reply) => {
    const { account_id, amount_minor } = (req.body ?? {}) as { account_id?: unknown; amount_minor?: unknown };
    if (typeof account_id !== 'string' || !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(account_id)) {
      return reply.code(404).send({ error: 'account_not_found' });
    }
    if (typeof amount_minor !== 'number' || !Number.isSafeInteger(amount_minor) || amount_minor <= 0) {
      return reply.code(400).send({ error: 'invalid_amount' });
    }

    const id = `pay_${randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO payments (id, account_id, amount_minor, status, provider_payment_id, created_at, updated_at)
       VALUES (?, ?, ?, 'new', NULL, ?, ?)`,
    ).run(id, account_id, amount_minor, now, now);

    // Если провайдер недоступен, платёж остаётся в статусе new, а ошибка уходит в обработчик
    const created = await mockpay.createPayment({ merchant_reference: id, amount: toSums(amount_minor) });
    db.prepare(
      `UPDATE payments SET status = 'pending', provider_payment_id = ?, updated_at = ? WHERE id = ?`,
    ).run(created.id, new Date().toISOString(), id);

    return reply.code(201).send(db.prepare('SELECT * FROM payments WHERE id = ?').get(id));
  });

  app.get<{ Params: { id: string } }>('/payments/:id', async (req, reply) => {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!payment) return reply.code(404).send({ error: 'payment_not_found' });
    const refunds = db
      .prepare('SELECT * FROM refunds WHERE payment_id = ? ORDER BY created_at, rowid')
      .all(req.params.id);
    return { ...payment, refunds };
  });
}
