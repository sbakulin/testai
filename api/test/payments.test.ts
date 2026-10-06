import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp, buildNotConnectedApp } from '../src/app.js';
import { migrate, openDb } from '../src/db.js';
import { StandUnavailableError, type MockpayClient } from '../src/mockpay.js';

function setup(opts: { down?: boolean } = {}) {
  const db = openDb(':memory:');
  migrate(db);
  const calls: { merchant_reference: string; amount: string }[] = [];
  const mockpay: MockpayClient = {
    async createPayment(input) {
      if (opts.down) throw new StandUnavailableError();
      calls.push(input);
      return { id: `mp_${calls.length}`, status: 'pending' };
    },
    async getPayment(id) {
      return { id, status: 'pending' };
    },
    async createRefund() {
      return { id: 'rf_1', status: 'processing' };
    },
  };
  const app = buildApp({ db, mockpay, receipts: { send: async () => {} }, webhookSecret: 'secret' });
  return { app, db, calls };
}

async function createAccount(app: ReturnType<typeof setup>['app'], owner_name: string) {
  const r = await app.inject({ method: 'POST', url: '/accounts', payload: { owner_name } });
  assert.equal(r.statusCode, 201);
  return r.json().id as string;
}

test('POST /payments creates pending payment at provider', async () => {
  const { app, calls } = setup();
  const account_id = await createAccount(app, 'Алишер');
  const r = await app.inject({ method: 'POST', url: '/payments', payload: { account_id, amount_minor: 15000000 } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().status, 'pending');
  assert.equal(r.json().provider_payment_id, 'mp_1');
  assert.deepEqual(calls[0], { merchant_reference: r.json().id, amount: '150000.00' });
  assert.match(r.json().id, /^pay_[0-9a-f]{12}$/);
});

test('POST /payments validates input', async () => {
  const { app, calls } = setup();
  const account_id = await createAccount(app, 'Алишер');
  const post = (payload: object) => app.inject({ method: 'POST', url: '/payments', payload });

  assert.equal((await post({ account_id: 'acc_nope', amount_minor: 100 })).statusCode, 404);
  for (const amount_minor of [0, -5, 1.5, '100', null]) {
    assert.equal((await post({ account_id, amount_minor })).statusCode, 400, `amount ${amount_minor}`);
  }
  assert.equal(calls.length, 0);
});

test('provider down → 502 stand_unavailable, payment stays new', async () => {
  const { app, db } = setup({ down: true });
  const account_id = await createAccount(app, 'Алишер');
  const r = await app.inject({ method: 'POST', url: '/payments', payload: { account_id, amount_minor: 100 } });
  assert.equal(r.statusCode, 502);
  assert.deepEqual(r.json(), { error: 'stand_unavailable' });
  const row = db.prepare('SELECT status, provider_payment_id FROM payments').get() as { status: string; provider_payment_id: string | null };
  assert.equal(row.status, 'new');
  assert.equal(row.provider_payment_id, null);
});

test('GET /accounts/:id/payments lists all payments newest first and filters by q', async () => {
  const { app, db } = setup();
  const account_id = await createAccount(app, 'Алишер');
  const other = await createAccount(app, 'Бахтиёр');
  const insert = db.prepare("INSERT INTO payments VALUES (?, ?, 100, 'succeeded', ?, ?, ?)");
  for (let i = 0; i < 120; i++) {
    const ts = new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString();
    insert.run(`pay_${String(i).padStart(12, '0')}`, account_id, `mp_${i}`, ts, ts);
  }
  insert.run('pay_foreign00000', other, 'mp_foreign', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');

  const all = (await app.inject({ url: `/accounts/${account_id}/payments` })).json();
  assert.equal(all.length, 120);
  assert.equal(all[0].id, 'pay_000000000119');
  assert.equal(all[119].id, 'pay_000000000000');

  const byId = (await app.inject({ url: `/accounts/${account_id}/payments?q=pay_00000000011` })).json();
  assert.deepEqual(byId.map((p: { id: string }) => p.id).sort(), [
    'pay_000000000110', 'pay_000000000111', 'pay_000000000112', 'pay_000000000113', 'pay_000000000114',
    'pay_000000000115', 'pay_000000000116', 'pay_000000000117', 'pay_000000000118', 'pay_000000000119',
  ]);

  const byProvider = (await app.inject({ url: `/accounts/${account_id}/payments?q=mp_77` })).json();
  assert.deepEqual(byProvider.map((p: { id: string }) => p.id), ['pay_000000000077']);

  assert.equal((await app.inject({ url: `/accounts/${account_id}/payments?q=mp_foreign` })).json().length, 0);
  assert.equal((await app.inject({ url: '/accounts/acc_nope/payments' })).statusCode, 404);
});

test('GET /accounts returns balances and counts sorted by owner name', async () => {
  const { app, db } = setup();
  const b = await createAccount(app, 'Бахтиёр');
  await createAccount(app, 'Алишер');
  db.prepare("INSERT INTO payments VALUES ('pay_1', ?, 100, 'succeeded', 'mp_1', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')").run(b);

  const list = (await app.inject({ url: '/accounts' })).json();
  assert.deepEqual(list.map((a: { owner_name: string }) => a.owner_name), ['Алишер', 'Бахтиёр']);
  assert.equal(list[1].payments_count, 1);
  assert.equal(list[1].balance_minor, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/accounts', payload: { owner_name: ' ' } })).statusCode, 400);
});

test('GET /accounts/:id/balance and GET /payments/:id', async () => {
  const { app, db } = setup();
  const account_id = await createAccount(app, 'Алишер');
  const r = await app.inject({ method: 'POST', url: '/payments', payload: { account_id, amount_minor: 12345 } });
  const payment = r.json();
  db.prepare("INSERT INTO refunds VALUES ('ref_1', ?, 100, 'pending', 'rf_1', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z')").run(payment.id);

  const balance = await app.inject({ url: `/accounts/${account_id}/balance` });
  assert.deepEqual(balance.json(), { account_id, balance_minor: 0, balance: '0.00' });
  assert.equal((await app.inject({ url: '/accounts/acc_nope/balance' })).statusCode, 404);

  const got = (await app.inject({ url: `/payments/${payment.id}` })).json();
  assert.equal(got.id, payment.id);
  assert.equal(got.refunds.length, 1);
  assert.equal(got.refunds[0].id, 'ref_1');
  assert.equal((await app.inject({ url: '/payments/pay_nope' })).statusCode, 404);
});

test('no config → 503 not_connected', async () => {
  const app = buildNotConnectedApp();
  for (const [method, url] of [['GET', '/accounts'], ['POST', '/payments'], ['GET', '/anything/else']] as const) {
    const r = await app.inject({ method, url });
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.json(), { error: 'not_connected' });
  }
});
