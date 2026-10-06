import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { getBalance } from '../ledger.js';
import { toSums } from '../money.js';

export function accountsRoutes(app: FastifyInstance, { db }: AppDeps): void {
  const accountExists = db.prepare('SELECT 1 FROM accounts WHERE id = ?');

  app.get('/accounts', async () =>
    db
      .prepare(
        `SELECT a.id, a.owner_name,
                COALESCE(b.balance_minor, 0) AS balance_minor,
                (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id) AS payments_count
         FROM accounts a LEFT JOIN ledger_balances b ON b.account_id = a.id
         ORDER BY a.owner_name`,
      )
      .all(),
  );

  app.post('/accounts', async (req, reply) => {
    const { owner_name } = (req.body ?? {}) as { owner_name?: unknown };
    if (typeof owner_name !== 'string' || owner_name.trim() === '') {
      return reply.code(400).send({ error: 'invalid_owner_name' });
    }
    const id = `acc_${randomBytes(6).toString('hex')}`;
    db.prepare('INSERT INTO accounts (id, owner_name, created_at) VALUES (?, ?, ?)').run(
      id,
      owner_name.trim(),
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO ledger_balances (account_id, balance_minor) VALUES (?, 0)').run(id);
    return reply.code(201).send({ id, owner_name: owner_name.trim(), balance_minor: 0, payments_count: 0 });
  });

  app.get<{ Params: { id: string } }>('/accounts/:id/balance', async (req, reply) => {
    if (!accountExists.get(req.params.id)) return reply.code(404).send({ error: 'account_not_found' });
    const balance = getBalance(db, req.params.id);
    return { account_id: req.params.id, balance_minor: balance, balance: toSums(balance) };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/accounts/:id/payments',
    async (req, reply) => {
      if (!accountExists.get(req.params.id)) return reply.code(404).send({ error: 'account_not_found' });
      const q = req.query.q ?? '';
      return db
        .prepare(
          `SELECT * FROM payments
           WHERE account_id = ? AND (? = '' OR instr(id, ?) > 0 OR instr(COALESCE(provider_payment_id, ''), ?) > 0)
           ORDER BY created_at DESC, rowid DESC`,
        )
        .all(req.params.id, q, q, q);
    },
  );
}
