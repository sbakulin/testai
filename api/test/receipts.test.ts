import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { createReceipts } from '../src/receipts.js';

const received: { method?: string; url?: string; body: string }[] = [];
let delayMs = 0;

const server: Server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, body });
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    }, delayMs);
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/s/abc`;

after(() => {
  server.closeAllConnections();
  server.close();
});

test('send posts the receipt as JSON to /receipts', async () => {
  delayMs = 0;
  received.length = 0;
  await createReceipts(baseUrl).send({ payment_id: 'pay_1', amount: '150000.00' });
  assert.equal(received.length, 1);
  assert.equal(received[0]?.method, 'POST');
  assert.equal(received[0]?.url, '/s/abc/receipts');
  assert.deepEqual(JSON.parse(received[0]?.body ?? ''), { payment_id: 'pay_1', amount: '150000.00' });
});

test('send rejects when the server is slower than timeoutMs', async () => {
  delayMs = 300;
  await assert.rejects(createReceipts(baseUrl, { timeoutMs: 50 }).send({ payment_id: 'pay_1', amount: '1.00' }));
});
