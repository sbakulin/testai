import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { connect } from '../connect.mjs';
import { reset } from '../reset.mjs';
import { StandError } from '../lib/stand.mjs';
import { json, startStub } from './stub-stand.mjs';

const seed = {
  accounts: [
    { id: 'acc_1', owner_name: 'Первый' },
    { id: 'acc_2', owner_name: 'Второй' },
  ],
  payments: [
    {
      id: 'pay_1', account_id: 'acc_1', amount_minor: 10000, status: 'succeeded',
      provider_payment_id: 'mp_1', created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z',
    },
  ],
  refunds: [],
  postings: [
    {
      id: 'post_1', account_id: 'acc_1', payment_id: 'pay_1', refund_id: null,
      kind: 'credit', amount_minor: 10000, created_at: '2026-01-01T10:00:00Z',
    },
  ],
};

const bundle = {
  files: { 'TASK.md': '# Задача\n', 'webhooks.log': 'строка журнала\n' },
  seed,
  webhook_secret: 'whsec_test',
  expires_at: '2026-12-01T10:00:00+00:00',
};

let tmp;
let stand;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'connect-'));
  stand = await startStub((req, res) => {
    if (req.url === '/s/CODE/task') return json(res, 200, bundle);
    json(res, 403, { detail: 'invalid or expired code' });
  });
});

afterEach(async () => {
  await stand.close();
  rmSync(tmp, { recursive: true, force: true });
});

function countRows(file, table) {
  const db = new DatabaseSync(file);
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } finally {
    db.close();
  }
}

test('connect writes task files, env and seeds db', async () => {
  await connect('CODE', { root: tmp, standUrl: stand.url });
  assert.ok(existsSync(join(tmp, 'task/TASK.md')) && existsSync(join(tmp, 'task/webhooks.log')));
  assert.ok(existsSync(join(tmp, 'task/seed.json')));
  const env = readFileSync(join(tmp, '.env.local'), 'utf8');
  assert.match(env, /STAND_CODE=CODE/);
  assert.match(env, /WEBHOOK_SECRET=whsec_test/);
  assert.match(env, new RegExp(`STAND_URL=${stand.url}`));
  assert.equal(countRows(join(tmp, 'api/data/app.db'), 'accounts'), 2);
  assert.equal(countRows(join(tmp, 'api/data/app.db'), 'payments'), 1);
});

test('connect twice is idempotent, even with db open elsewhere', async () => {
  await connect('CODE', { root: tmp, standUrl: stand.url });
  const dbFile = join(tmp, 'api/data/app.db');
  const other = new DatabaseSync(dbFile);
  other.exec('PRAGMA journal_mode = WAL');
  try {
    await connect('CODE', { root: tmp, standUrl: stand.url });
    assert.equal(other.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 2);
  } finally {
    other.close();
  }
  assert.equal(countRows(dbFile, 'payments'), 1);
});

test('connect: unreachable stand → StandError unreachable, message has «порт 8090», no stack', async () => {
  await stand.close();
  await assert.rejects(connect('CODE', { root: tmp, standUrl: stand.url }), (err) => {
    assert.ok(err instanceof StandError);
    assert.equal(err.kind, 'unreachable');
    assert.match(err.message, /порт 8090/);
    assert.doesNotMatch(err.message, /\n\s+at /);
    return true;
  });
  stand = await startStub(() => {});
});

test('connect: 403 → StandError expired', async () => {
  await assert.rejects(connect('WRONG', { root: tmp, standUrl: stand.url }), (err) => {
    assert.ok(err instanceof StandError);
    assert.equal(err.kind, 'expired');
    assert.match(err.message, /Код не подходит или истёк/);
    return true;
  });
  assert.equal(existsSync(join(tmp, '.env.local')), false);
});

test('reset reloads seed from task/seed.json', async () => {
  await connect('CODE', { root: tmp, standUrl: stand.url });
  const dbFile = join(tmp, 'api/data/app.db');
  const db = new DatabaseSync(dbFile);
  db.exec('DELETE FROM ledger_postings; DELETE FROM payments;');
  db.close();
  await reset({ root: tmp });
  assert.equal(countRows(dbFile, 'payments'), 1);
  assert.equal(countRows(dbFile, 'ledger_postings'), 1);
});

test('reset without seed.json asks to connect first', async () => {
  await assert.rejects(reset({ root: tmp }), /Нет данных: сначала npm run connect -- КОД/);
});

test('connect: file names from the bundle cannot escape task/', async () => {
  const evil = { ...bundle, files: { '../evil.txt': 'x', 'sub/dir/deep.txt': 'y', '..\\win.txt': 'z', 'TASK.md': '# Задача\n' } };
  await stand.close();
  stand = await startStub((req, res) => json(res, 200, evil));
  await connect('CODE', { root: tmp, standUrl: stand.url });
  assert.equal(existsSync(join(tmp, 'evil.txt')), false);
  assert.ok(existsSync(join(tmp, 'task/evil.txt')));
  assert.ok(existsSync(join(tmp, 'task/deep.txt')));
  assert.ok(existsSync(join(tmp, 'task/win.txt')));
  assert.ok(existsSync(join(tmp, 'task/TASK.md')));
});
