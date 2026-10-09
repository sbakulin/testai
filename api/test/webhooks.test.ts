import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBalance } from '../src/ledger.js';
import { insertPayment, setupApp, sign } from './helpers.js';

function paymentEvent(type: string, paymentId = 'pay_1', amount = '150000.00') {
  return JSON.stringify({
    event_id: 'evt_1',
    type,
    payment: { id: `mp_${paymentId}`, merchant_reference: paymentId },
    amount,
    currency: 'UZS',
  });
}

function refundEvent(type: string, key: string, amount = '-50000.00') {
  return JSON.stringify({
    event_id: 'evt_2',
    type,
    payment: { id: 'mp_pay_1', merchant_reference: 'pay_1' },
    amount,
    currency: 'UZS',
    refund: { id: 'rf_1', idempotency_key: key },
  });
}

function deliver(app: ReturnType<typeof setupApp>['app'], body: string, signature = sign(body)) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/mockpay',
    headers: { 'content-type': 'application/json', 'x-signature': signature },
    payload: body,
  });
}

test('bad signature → 401', async () => {
  const { app, db } = setupApp();
  insertPayment(db);
  const body = paymentEvent('payment.succeeded');

  assert.equal((await deliver(app, body, 'deadbeef')).statusCode, 401);
  assert.equal((await deliver(app, body, sign(body, 'other-secret'))).statusCode, 401);
  const noHeader = await app.inject({
    method: 'POST',
    url: '/webhooks/mockpay',
    headers: { 'content-type': 'application/json' },
    payload: body,
  });
  assert.equal(noHeader.statusCode, 401);
  assert.equal(getBalance(db, 'acc_1'), 0);
});

test('signature is checked over the raw body bytes', async () => {
  const { app, db } = setupApp();
  insertPayment(db);
  const body = paymentEvent('payment.succeeded');
  const spaced = body.replace(',"type"', ', "type"');

  assert.equal((await deliver(app, spaced, sign(body))).statusCode, 401);
  assert.equal((await deliver(app, spaced, sign(spaced))).statusCode, 200);
});

test('malformed JSON with a valid signature → 400', async () => {
  const { app } = setupApp();
  const body = '{"type":';
  const r = await deliver(app, body);
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { error: 'invalid_json' });
});

test('payment.succeeded credits webhook amount and marks succeeded', async () => {
  const { app, db } = setupApp();
  insertPayment(db);

  const r = await deliver(app, paymentEvent('payment.succeeded'));
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal(getBalance(db, 'acc_1'), 15000000);
  const row = db.prepare("SELECT status FROM payments WHERE id = 'pay_1'").get() as { status: string };
  assert.equal(row.status, 'succeeded');
});

test('payment.succeeded credits the amount from the webhook, not the stored one', async () => {
  const { app, db } = setupApp();
  insertPayment(db, { amount_minor: 100 });

  await deliver(app, paymentEvent('payment.succeeded', 'pay_1', '150000.00'));
  assert.equal(getBalance(db, 'acc_1'), 15000000);
});

test('payment.failed marks failed without posting', async () => {
  const { app, db } = setupApp();
  insertPayment(db);

  const r = await deliver(app, paymentEvent('payment.failed'));
  assert.equal(r.statusCode, 200);
  const row = db.prepare("SELECT status FROM payments WHERE id = 'pay_1'").get() as { status: string };
  assert.equal(row.status, 'failed');
  assert.equal(getBalance(db, 'acc_1'), 0);
});

test('unknown merchant_reference → 404', async () => {
  const { app } = setupApp();
  const r = await deliver(app, paymentEvent('payment.succeeded', 'pay_nope'));
  assert.equal(r.statusCode, 404);
});

test('unknown event type is acknowledged and ignored', async () => {
  const { app, db } = setupApp();
  insertPayment(db);
  const r = await deliver(app, paymentEvent('payment.disputed'));
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal(getBalance(db, 'acc_1'), 0);
});

test('refund.succeeded debits once; refund.failed does not debit', async () => {
  const { app, db } = setupApp();
  insertPayment(db, { status: 'succeeded' });
  const ts = '2025-01-02T00:00:00.000Z';
  db.prepare("INSERT INTO ledger_balances VALUES ('acc_1', 15000000)").run();
  db.prepare("INSERT INTO refunds VALUES ('ref_ok', 'pay_1', 5000000, 'processing', 'rf_1', ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO refunds VALUES ('ref_bad', 'pay_1', 1000000, 'processing', 'rf_2', ?, ?)").run(ts, ts);

  const ok = await deliver(app, refundEvent('refund.succeeded', 'ref_ok'));
  assert.equal(ok.statusCode, 200);
  assert.equal(getBalance(db, 'acc_1'), 10000000);

  const bad = await deliver(app, refundEvent('refund.failed', 'ref_bad', '-10000.00'));
  assert.equal(bad.statusCode, 200);
  assert.equal(getBalance(db, 'acc_1'), 10000000);

  const statuses = db.prepare('SELECT id, status FROM refunds ORDER BY id').all();
  assert.deepEqual(statuses.map((r) => ({ ...r })), [
    { id: 'ref_bad', status: 'failed' },
    { id: 'ref_ok', status: 'succeeded' },
  ]);
  const payment = db.prepare("SELECT status FROM payments WHERE id = 'pay_1'").get() as { status: string };
  assert.equal(payment.status, 'succeeded');
});

test('refund event with unknown idempotency_key → 404', async () => {
  const { app, db } = setupApp();
  insertPayment(db, { status: 'succeeded' });
  const r = await deliver(app, refundEvent('refund.succeeded', 'ref_nope'));
  assert.equal(r.statusCode, 404);
});

test('other routes keep the normal JSON parsing', async () => {
  const { app } = setupApp();
  const r = await app.inject({
    method: 'POST',
    url: '/accounts',
    headers: { 'content-type': 'application/json' },
    payload: '{"owner_name":',
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, 'bad_request');
});

test('validly signed but malformed events → 400 invalid_event', async () => {
  const { app, db } = setupApp();
  insertPayment(db);
  const valid = JSON.parse(paymentEvent('payment.succeeded'));
  const bodies = [
    'null',
    '42',
    '"text"',
    '[]',
    '{}',
    JSON.stringify({ ...valid, type: 7 }),
    JSON.stringify({ ...valid, payment: undefined }),
    JSON.stringify({ ...valid, payment: { id: 'mp_1' } }),
    JSON.stringify({ ...valid, amount: undefined }),
    JSON.stringify({ ...valid, amount: 'abc' }),
    JSON.stringify({ ...valid, amount: '0.00' }),
    JSON.stringify({ ...valid, amount: '-10.00' }),
    JSON.stringify({ type: 'refund.succeeded', amount: '-1.00' }),
    JSON.stringify({ type: 'refund.failed', refund: { id: 'rf_1' } }),
  ];
  for (const body of bodies) {
    const r = await deliver(app, body);
    assert.equal(r.statusCode, 400, body);
    assert.deepEqual(r.json(), { error: 'invalid_event' }, body);
  }
  assert.equal(getBalance(db, 'acc_1'), 0);
});

test('unknown event type without a payment is still acknowledged', async () => {
  const { app } = setupApp();
  const r = await deliver(app, JSON.stringify({ type: 'something.else' }));
  assert.equal(r.statusCode, 200);
});

test('signature must be 64 hex chars; empty or missing body → 401', async () => {
  const { app } = setupApp();
  const body = paymentEvent('payment.succeeded');
  assert.equal((await deliver(app, body, 'zz'.repeat(32))).statusCode, 401);
  assert.equal((await deliver(app, body, sign(body).slice(0, 62))).statusCode, 401);
  assert.equal((await deliver(app, '', 'a'.repeat(64))).statusCode, 401);
  const noBody = await app.inject({ method: 'POST', url: '/webhooks/mockpay', headers: { 'x-signature': 'a'.repeat(64) } });
  assert.equal(noBody.statusCode, 401);
});
