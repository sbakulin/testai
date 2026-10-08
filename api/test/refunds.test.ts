import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StandUnavailableError } from '../src/mockpay.js';
import { insertPayment, setupApp } from './helpers.js';

function refund(app: ReturnType<typeof setupApp>['app'], payment = 'pay_1', payload: object = { amount_minor: 5000000 }) {
  return app.inject({ method: 'POST', url: `/payments/${payment}/refunds`, payload });
}

test('refund for succeeded payment → 201 processing, sent to provider with our id as key', async () => {
  const { app, db, refundCalls } = setupApp();
  insertPayment(db, { status: 'succeeded' });

  const r = await refund(app);
  assert.equal(r.statusCode, 201);
  const body = r.json();
  assert.match(body.id, /^ref_[0-9a-f]{12}$/);
  assert.deepEqual(body, { id: body.id, payment_id: 'pay_1', amount_minor: 5000000, status: 'processing' });
  assert.deepEqual(refundCalls, [{ payment_id: 'mp_pay_1', amount: '50000.00', idempotency_key: body.id }]);
  const row = db.prepare('SELECT status, provider_refund_id FROM refunds WHERE id = ?').get(body.id) as {
    status: string;
    provider_refund_id: string;
  };
  assert.deepEqual({ ...row }, { status: 'processing', provider_refund_id: 'rf_1' });
});

test('refund only for succeeded payment → 422 otherwise', async () => {
  const { app, db, refundCalls } = setupApp();
  for (const status of ['new', 'pending', 'failed']) {
    insertPayment(db, { id: `pay_${status}`, status });
    const r = await refund(app, `pay_${status}`);
    assert.equal(r.statusCode, 422, status);
    assert.deepEqual(r.json(), { error: 'payment_not_succeeded' });
  }
  assert.equal(refundCalls.length, 0);
});

test('refund over remaining amount → 422', async () => {
  const { app, db } = setupApp();
  insertPayment(db, { status: 'succeeded', amount_minor: 10000 });

  assert.equal((await refund(app, 'pay_1', { amount_minor: 6000 })).statusCode, 201);
  const over = await refund(app, 'pay_1', { amount_minor: 4001 });
  assert.equal(over.statusCode, 422);
  assert.deepEqual(over.json(), { error: 'refund_exceeds_payment' });
  assert.equal((await refund(app, 'pay_1', { amount_minor: 4000 })).statusCode, 201);
});

test('failed refunds do not count against the payment', async () => {
  const { app, db } = setupApp();
  insertPayment(db, { status: 'succeeded', amount_minor: 10000 });
  const ts = '2025-01-02T00:00:00.000Z';
  db.prepare("INSERT INTO refunds VALUES ('ref_x', 'pay_1', 10000, 'failed', 'rf_x', ?, ?)").run(ts, ts);

  assert.equal((await refund(app, 'pay_1', { amount_minor: 10000 })).statusCode, 201);
});

test('validates payment and amount', async () => {
  const { app, db } = setupApp();
  insertPayment(db, { status: 'succeeded' });

  assert.equal((await refund(app, 'pay_nope')).statusCode, 404);
  for (const amount_minor of [0, -1, 1.5, '100', null]) {
    assert.equal((await refund(app, 'pay_1', { amount_minor })).statusCode, 400, `amount ${amount_minor}`);
  }
});

test('provider down → 502 and the refund is marked failed', async () => {
  const { app, db } = setupApp({
    async createRefund() {
      throw new StandUnavailableError();
    },
  });
  insertPayment(db, { status: 'succeeded' });

  const r = await refund(app);
  assert.equal(r.statusCode, 502);
  assert.deepEqual(r.json(), { error: 'stand_unavailable' });
  const row = db.prepare('SELECT status FROM refunds').get() as { status: string };
  assert.equal(row.status, 'failed');
  // неудавшийся возврат не занимает сумму платежа
  assert.equal((await refund(app)).statusCode, 502);
});
