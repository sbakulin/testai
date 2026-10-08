import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp, buildNotConnectedApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate, openDb } from './db.js';
import { createMockpayClient } from './mockpay.js';
import { createReceipts } from './receipts.js';

const PORT = 3000;
const config = loadConfig();

let app;
if (!config) {
  console.warn('.env.local не найден или в нём нет STAND_CODE: сервис не подключён к стенду');
  app = buildNotConnectedApp();
} else {
  const dataDir = new URL('../data/', import.meta.url);
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(fileURLToPath(new URL('app.db', dataDir)));
  migrate(db);
  app = buildApp({
    db,
    mockpay: createMockpayClient(`${config.standUrl}/s/${config.code}/mockpay`),
    receipts: createReceipts(`${config.standUrl}/s/${config.code}`),
    webhookSecret: config.webhookSecret,
  });
}

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`api слушает http://127.0.0.1:${PORT}`);
