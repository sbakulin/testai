import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { transaction } from '../db.js';
import { postCredit, postDebit } from '../ledger.js';
import { toMinor } from '../money.js';

interface WebhookEvent {
  type: string;
  payment: { merchant_reference: string };
  amount: string;
  refund: { idempotency_key: string };
}

const SIGNATURE_RE = /^[0-9a-f]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Проверяет форму события; для неизвестных типов достаточно строкового type. */
function parseEvent(raw: string): WebhookEvent | null {
  const event: unknown = JSON.parse(raw);
  if (!isRecord(event) || typeof event.type !== 'string') return null;
  if (event.type.startsWith('payment.')) {
    if (!isRecord(event.payment) || typeof event.payment.merchant_reference !== 'string') return null;
    if (event.type === 'payment.succeeded') {
      if (typeof event.amount !== 'string') return null;
      try {
        if (toMinor(event.amount) <= 0) return null;
      } catch {
        return null;
      }
    }
  } else if (event.type.startsWith('refund.')) {
    if (!isRecord(event.refund) || typeof event.refund.idempotency_key !== 'string') return null;
  }
  return event as unknown as WebhookEvent;
}

function signatureMatches(secret: string, rawBody: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function webhooksRoutes(app: FastifyInstance, { db, webhookSecret }: AppDeps): void {
  // Подпись считается по сырому телу, поэтому парсер с сырой строкой действует только внутри этого плагина
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

    const findPayment = db.prepare('SELECT id, account_id FROM payments WHERE id = ?');
    const findRefund = db.prepare('SELECT id, payment_id, amount_minor FROM refunds WHERE id = ?');
    const setPaymentStatus = db.prepare(
      `UPDATE payments SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
    );
    const setRefundStatus = db.prepare(
      `UPDATE refunds SET status = ?, updated_at = ? WHERE id = ? AND status = 'processing'`,
    );

    scope.post('/webhooks/mockpay', async (req, reply) => {
      const raw = typeof req.body === 'string' ? req.body : '';
      if (!signatureMatches(webhookSecret, raw, req.headers['x-signature'])) {
        return reply.code(401).send({ error: 'invalid_signature' });
      }

      let event: WebhookEvent | null;
      try {
        event = parseEvent(raw);
      } catch {
        return reply.code(400).send({ error: 'invalid_json' });
      }
      if (!event) return reply.code(400).send({ error: 'invalid_event' });

      const now = new Date().toISOString();
      switch (event.type) {
        case 'payment.succeeded':
        case 'payment.failed': {
          const payment = findPayment.get(event.payment.merchant_reference) as
            | { id: string; account_id: string }
            | undefined;
          if (!payment) return reply.code(404).send({ error: 'payment_not_found' });

          if (event.type === 'payment.failed') {
            setPaymentStatus.run('failed', now, payment.id);
            break;
          }
          const amountMinor = toMinor(event.amount);
          transaction(db, () => {
            if (Number(setPaymentStatus.run('succeeded', now, payment.id).changes) === 0) return;
            postCredit(db, { accountId: payment.account_id, paymentId: payment.id, amountMinor });
          });
          break;
        }
        case 'refund.succeeded':
        case 'refund.failed': {
          const refund = findRefund.get(event.refund.idempotency_key) as
            | { id: string; payment_id: string; amount_minor: number }
            | undefined;
          if (!refund) return reply.code(404).send({ error: 'refund_not_found' });

          if (event.type === 'refund.failed') {
            setRefundStatus.run('failed', now, refund.id);
            break;
          }
          const payment = findPayment.get(refund.payment_id) as { id: string; account_id: string };
          transaction(db, () => {
            if (Number(setRefundStatus.run('succeeded', now, refund.id).changes) === 0) return;
            postDebit(db, {
              accountId: payment.account_id,
              paymentId: payment.id,
              refundId: refund.id,
              amountMinor: refund.amount_minor,
            });
          });
          break;
        }
        default:
          // Неизвестные типы событий подтверждаем, чтобы провайдер не слал их повторно
          break;
      }
      return { ok: true };
    });
  });
}
