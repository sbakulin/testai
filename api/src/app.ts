import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { StandUnavailableError, type MockpayClient } from './mockpay.js';
import { accountsRoutes } from './routes/accounts.js';
import { paymentsRoutes } from './routes/payments.js';
import { refundsRoutes } from './routes/refunds.js';
import { webhooksRoutes } from './routes/webhooks.js';

export interface Receipts {
  send(input: { payment_id: string; amount: string }): Promise<void>;
}

export interface AppDeps {
  db: DatabaseSync;
  mockpay: MockpayClient;
  receipts: Receipts;
  webhookSecret: string;
}

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof StandUnavailableError) {
      return reply.code(502).send({ error: 'stand_unavailable' });
    }
    // Клиентские ошибки самого Fastify (битый JSON, слишком большое тело, неверный content-type)
    const status = typeof err === 'object' && err !== null && 'statusCode' in err ? err.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: CLIENT_ERROR_CODES[status] ?? 'bad_request' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  accountsRoutes(app, deps);
  paymentsRoutes(app, deps);
  refundsRoutes(app, deps);
  webhooksRoutes(app, deps);
  return app;
}

/** Сервис запущен без .env.local: на любой запрос отвечаем 503. */
export function buildNotConnectedApp(): FastifyInstance {
  const app = Fastify();
  app.setNotFoundHandler((_req, reply) => reply.code(503).send({ error: 'not_connected' }));
  app.all('/*', (_req, reply) => reply.code(503).send({ error: 'not_connected' }));
  return app;
}
