import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { migrate, openDb } from '../src/db.js';
import type { MockpayClient } from '../src/mockpay.js';

export const WEBHOOK_SECRET = 'whsec_test';

export function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export interface RefundCall {
  payment_id: string;
  amount: string;
  idempotency_key: string;
}

export function setupApp(overrides: Partial<MockpayClient> = {}) {
  const db = openDb(':memory:');
  migrate(db);
  const refundCalls: RefundCall[] = [];
  const receiptCalls: { payment_id: string; amount: string }[] = [];
  const mockpay: MockpayClient = {
    async createPayment() {
      return { id: 'mp_1', status: 'pending' };
    },
    async getPayment(id) {
      return { id, status: 'pending' };
    },
    async createRefund(input) {
      refundCalls.push(input);
      return { id: `rf_${refundCalls.length}`, status: 'processing' };
    },
    ...overrides,
  };
  const receipts = {
    async send(input: { payment_id: string; amount: string }) {
      receiptCalls.push(input);
    },
  };
  const app = buildApp({ db, mockpay, receipts, webhookSecret: WEBHOOK_SECRET });
  return { app, db, refundCalls, receiptCalls };
}

export function insertPayment(
  db: ReturnType<typeof openDb>,
  opts: { id?: string; status?: string; amount_minor?: number } = {},
): { accountId: string; paymentId: string } {
  const accountId = 'acc_1';
  const paymentId = opts.id ?? 'pay_1';
  const ts = '2025-01-01T00:00:00.000Z';
  db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?)').run(accountId, 'Алишер', ts);
  db.prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    paymentId,
    accountId,
    opts.amount_minor ?? 15000000,
    opts.status ?? 'pending',
    `mp_${paymentId}`,
    ts,
    ts,
  );
  return { accountId, paymentId };
}
