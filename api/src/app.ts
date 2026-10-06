import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { StandUnavailableError, type MockpayClient } from './mockpay.js';
import { accountsRoutes } from './routes/accounts.js';
import { paymentsRoutes } from './routes/payments.js';

export interface Receipts {
  send(input: { payment_id: string; amount: string }): Promise<void>;
}

export interface AppDeps {
  db: DatabaseSync;
  mockpay: MockpayClient;
  receipts: Receipts;
  webhookSecret: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof StandUnavailableError) {
      return reply.code(502).send({ error: 'stand_unavailable' });
    }
    if (typeof err === 'object' && err !== null && 'statusCode' in err && err.statusCode === 400) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  accountsRoutes(app, deps);
  paymentsRoutes(app, deps);
  return app;
}

/** Сервис запущен без .env.local: на любой запрос отвечаем 503. */
export function buildNotConnectedApp(): FastifyInstance {
  const app = Fastify();
  app.setNotFoundHandler((_req, reply) => reply.code(503).send({ error: 'not_connected' }));
  app.all('/*', (_req, reply) => reply.code(503).send({ error: 'not_connected' }));
  return app;
}
