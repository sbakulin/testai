CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  owner_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_payment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_account_idx ON payments(account_id, created_at);
CREATE INDEX IF NOT EXISTS payments_provider_idx ON payments(provider_payment_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_refund_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  payment_id TEXT REFERENCES payments(id),
  refund_id TEXT REFERENCES refunds(id),
  kind TEXT NOT NULL CHECK (kind IN ('credit', 'debit')),
  amount_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_postings_account_idx ON ledger_postings(account_id);

CREATE TABLE IF NOT EXISTS ledger_balances (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  balance_minor INTEGER NOT NULL DEFAULT 0
);
