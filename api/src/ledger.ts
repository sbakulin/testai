import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.js';

interface Posting {
  accountId: string;
  paymentId: string;
  refundId: string | null;
  kind: 'credit' | 'debit';
  amountMinor: number;
}

function post(db: DatabaseSync, p: Posting): void {
  const delta = p.kind === 'credit' ? p.amountMinor : -p.amountMinor;
  transaction(db, () => {
    db.prepare(
      `INSERT INTO ledger_postings (id, account_id, payment_id, refund_id, kind, amount_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `pst_${randomBytes(6).toString('hex')}`,
      p.accountId,
      p.paymentId,
      p.refundId,
      p.kind,
      p.amountMinor,
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO ledger_balances (account_id, balance_minor) VALUES (?, ?)
       ON CONFLICT(account_id) DO UPDATE SET balance_minor = balance_minor + excluded.balance_minor`,
    ).run(p.accountId, delta);
  });
}

export function postCredit(
  db: DatabaseSync,
  input: { accountId: string; paymentId: string; amountMinor: number },
): void {
  post(db, { ...input, refundId: null, kind: 'credit' });
}

export function postDebit(
  db: DatabaseSync,
  input: { accountId: string; paymentId: string; refundId: string; amountMinor: number },
): void {
  post(db, { ...input, kind: 'debit' });
}

export function getBalance(db: DatabaseSync, accountId: string): number {
  const row = db
    .prepare('SELECT balance_minor FROM ledger_balances WHERE account_id = ?')
    .get(accountId) as { balance_minor: number } | undefined;
  return row?.balance_minor ?? 0;
}
