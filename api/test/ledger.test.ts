import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate, openDb, transaction } from '../src/db.js';
import { getBalance, postCredit, postDebit } from '../src/ledger.js';
import { loadSeed, type Seed } from '../src/seed.js';

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  db.prepare("INSERT INTO accounts VALUES ('acc_1', 'Алишер', '2025-01-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO payments VALUES ('pay_1', 'acc_1', 300, 'succeeded', 'mp_1', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')").run();
  return db;
}

test('credit updates balance atomically', () => {
  const db = setup();
  postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 100 });
  postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 250 });
  assert.equal(getBalance(db, 'acc_1'), 350);
  const count = db.prepare('SELECT COUNT(*) AS n FROM ledger_postings WHERE account_id = ?').get('acc_1') as { n: number };
  assert.equal(count.n, 2);
});

test('failed posting leaves no trace', () => {
  const db = setup();
  assert.throws(() => postCredit(db, { accountId: 'acc_missing', paymentId: 'pay_1', amountMinor: 100 }));
  assert.equal(getBalance(db, 'acc_missing'), 0);
  const count = db.prepare('SELECT COUNT(*) AS n FROM ledger_postings').get() as { n: number };
  assert.equal(count.n, 0);
});

test('debit reduces balance', () => {
  const db = setup();
  postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 300 });
  db.prepare("INSERT INTO refunds VALUES ('ref_1', 'pay_1', 100, 'succeeded', 'rf_1', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z')").run();
  postDebit(db, { accountId: 'acc_1', paymentId: 'pay_1', refundId: 'ref_1', amountMinor: 100 });
  assert.equal(getBalance(db, 'acc_1'), 200);
});

const seed: Seed = {
  accounts: [
    { id: 'acc_a', owner_name: 'Алишер' },
    { id: 'acc_b', owner_name: 'Бахтиёр' },
    { id: 'acc_c', owner_name: 'Нодира' },
  ],
  payments: [
    { id: 'pay_1', account_id: 'acc_a', amount_minor: 1000, status: 'succeeded', provider_payment_id: 'mp_1', created_at: '2025-03-02T10:00:00.000Z', updated_at: '2025-03-02T10:00:00.000Z' },
    { id: 'pay_2', account_id: 'acc_a', amount_minor: 500, status: 'succeeded', provider_payment_id: 'mp_2', created_at: '2025-03-01T10:00:00.000Z', updated_at: '2025-03-01T10:00:00.000Z' },
    { id: 'pay_3', account_id: 'acc_b', amount_minor: 700, status: 'succeeded', provider_payment_id: 'mp_3', created_at: '2025-03-03T10:00:00.000Z', updated_at: '2025-03-03T10:00:00.000Z' },
  ],
  refunds: [
    { id: 'ref_1', payment_id: 'pay_1', amount_minor: 200, status: 'succeeded', provider_refund_id: 'rf_1', created_at: '2025-03-04T10:00:00.000Z', updated_at: '2025-03-04T10:00:00.000Z' },
  ],
  postings: [
    { id: 'pst_1', account_id: 'acc_a', payment_id: 'pay_1', refund_id: null, kind: 'credit', amount_minor: 1000, created_at: '2025-03-02T10:00:00.000Z' },
    { id: 'pst_2', account_id: 'acc_a', payment_id: 'pay_2', refund_id: null, kind: 'credit', amount_minor: 500, created_at: '2025-03-01T10:00:00.000Z' },
    { id: 'pst_3', account_id: 'acc_a', payment_id: 'pay_1', refund_id: 'ref_1', kind: 'debit', amount_minor: 200, created_at: '2025-03-04T10:00:00.000Z' },
    { id: 'pst_4', account_id: 'acc_b', payment_id: 'pay_3', refund_id: null, kind: 'credit', amount_minor: 700, created_at: '2025-03-03T10:00:00.000Z' },
  ],
};

test('loadSeed twice leaves one copy and correct balances', () => {
  const db = openDb(':memory:');
  migrate(db);
  loadSeed(db, seed);
  loadSeed(db, seed);

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count('accounts'), 3);
  assert.equal(count('payments'), 3);
  assert.equal(count('refunds'), 1);
  assert.equal(count('ledger_postings'), 4);
  assert.equal(count('ledger_balances'), 3);

  assert.equal(getBalance(db, 'acc_a'), 1300);
  assert.equal(getBalance(db, 'acc_b'), 700);
  assert.equal(getBalance(db, 'acc_c'), 0);

  const acc = db.prepare("SELECT created_at FROM accounts WHERE id = 'acc_a'").get() as { created_at: string };
  assert.equal(acc.created_at, '2025-03-01T10:00:00.000Z');
});

test('transaction nests: an outer failure rolls back inner postings', () => {
  const db = setup();
  assert.throws(() =>
    transaction(db, () => {
      postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 100 });
      throw new Error('boom');
    }),
  );
  assert.equal(getBalance(db, 'acc_1'), 0);
  const count = db.prepare('SELECT COUNT(*) AS n FROM ledger_postings').get() as { n: number };
  assert.equal(count.n, 0);
});

test('transaction nests: inner postings commit together with the outer one', () => {
  const db = setup();
  transaction(db, () => {
    postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 100 });
    postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 50 });
  });
  assert.equal(getBalance(db, 'acc_1'), 150);
});

test('failing ROLLBACK does not mask the original error', () => {
  const db = setup();
  assert.throws(
    () =>
      transaction(db, () => {
        db.exec('ROLLBACK'); // транзакция уже закрыта — повторный ROLLBACK в transaction() упадёт
        throw new Error('original');
      }),
    /original/,
  );
});

test('transaction nests: an inner failure caught by the outer call keeps the outer transaction', () => {
  const db = setup();
  transaction(db, () => {
    postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 100 });
    assert.throws(() => transaction(db, () => { throw new Error('inner'); }), /inner/);
    postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 50 });
  });
  assert.equal(getBalance(db, 'acc_1'), 150);
});

test('transaction can be opened again after a nested call failed', () => {
  const db = setup();
  assert.throws(() => transaction(db, () => transaction(db, () => { throw new Error('boom'); })), /boom/);
  transaction(db, () => {
    postCredit(db, { accountId: 'acc_1', paymentId: 'pay_1', amountMinor: 70 });
  });
  assert.equal(getBalance(db, 'acc_1'), 70);
  // после выхода из transaction() новая транзакция открывается без ошибки «within a transaction»
  db.exec('BEGIN IMMEDIATE');
  db.exec('ROLLBACK');
});
