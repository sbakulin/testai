import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.js';

export interface Seed {
  accounts: { id: string; owner_name: string }[];
  payments: {
    id: string;
    account_id: string;
    amount_minor: number;
    status: string;
    provider_payment_id: string | null;
    created_at: string;
    updated_at: string;
  }[];
  refunds: {
    id: string;
    payment_id: string;
    amount_minor: number;
    status: string;
    provider_refund_id: string | null;
    created_at: string;
    updated_at: string;
  }[];
  postings: {
    id: string;
    account_id: string;
    payment_id: string | null;
    refund_id: string | null;
    kind: 'credit' | 'debit';
    amount_minor: number;
    created_at: string;
  }[];
}

/** Заменяет содержимое таблиц данными из seed и пересчитывает остатки по проводкам. */
export function loadSeed(db: DatabaseSync, seed: Seed): void {
  // У счёта нет своей даты в seed — берём время самого раннего платежа
  const firstPayment = new Map<string, string>();
  for (const p of seed.payments) {
    const prev = firstPayment.get(p.account_id);
    if (prev === undefined || p.created_at < prev) firstPayment.set(p.account_id, p.created_at);
  }
  const now = new Date().toISOString();

  transaction(db, () => {
    for (const table of ['ledger_postings', 'ledger_balances', 'refunds', 'payments', 'accounts']) {
      db.exec(`DELETE FROM ${table}`);
    }

    const insertAccount = db.prepare('INSERT INTO accounts (id, owner_name, created_at) VALUES (?, ?, ?)');
    for (const a of seed.accounts) insertAccount.run(a.id, a.owner_name, firstPayment.get(a.id) ?? now);

    const insertPayment = db.prepare(
      `INSERT INTO payments (id, account_id, amount_minor, status, provider_payment_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of seed.payments) {
      insertPayment.run(
        p.id, p.account_id, p.amount_minor, p.status, p.provider_payment_id, p.created_at, p.updated_at,
      );
    }

    const insertRefund = db.prepare(
      `INSERT INTO refunds (id, payment_id, amount_minor, status, provider_refund_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of seed.refunds) {
      insertRefund.run(
        r.id, r.payment_id, r.amount_minor, r.status, r.provider_refund_id, r.created_at, r.updated_at,
      );
    }

    const insertPosting = db.prepare(
      `INSERT INTO ledger_postings (id, account_id, payment_id, refund_id, kind, amount_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of seed.postings) {
      insertPosting.run(p.id, p.account_id, p.payment_id, p.refund_id, p.kind, p.amount_minor, p.created_at);
    }

    db.exec(
      `INSERT INTO ledger_balances (account_id, balance_minor)
       SELECT a.id, COALESCE(SUM(CASE p.kind WHEN 'credit' THEN p.amount_minor ELSE -p.amount_minor END), 0)
       FROM accounts a LEFT JOIN ledger_postings p ON p.account_id = a.id
       GROUP BY a.id`,
    );
  });
}
