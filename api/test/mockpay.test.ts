import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { createMockpayClient, MockpayError, StandUnavailableError } from '../src/mockpay.js';

const received: { method?: string; url?: string; body: string }[] = [];
let nextStatus = 201;

const server: Server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, body });
    res.statusCode = nextStatus;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'mp_1', status: 'pending' }));
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/s/abc/mockpay`;

after(() => {
  server.closeAllConnections();
  server.close();
});

test('createPayment builds the URL and sends the body with currency', async () => {
  nextStatus = 201;
  received.length = 0;
  const payment = await createMockpayClient(baseUrl).createPayment({ merchant_reference: 'pay_1', amount: '10.00' });
  assert.deepEqual(payment, { id: 'mp_1', status: 'pending' });
  assert.equal(received[0]?.method, 'POST');
  assert.equal(received[0]?.url, '/s/abc/mockpay/payments');
  assert.deepEqual(JSON.parse(received[0]?.body ?? ''), { merchant_reference: 'pay_1', amount: '10.00', currency: 'UZS' });
});

test('getPayment and createRefund use their own paths', async () => {
  nextStatus = 201;
  received.length = 0;
  const client = createMockpayClient(baseUrl);
  await client.getPayment('mp 1');
  await client.createRefund({ payment_id: 'mp_1', amount: '5.00', idempotency_key: 'ref_1' });
  assert.deepEqual(
    received.map((r) => `${r.method} ${r.url}`),
    ['GET /s/abc/mockpay/payments/mp%201', 'POST /s/abc/mockpay/refunds'],
  );
  assert.deepEqual(JSON.parse(received[1]?.body ?? ''), { payment_id: 'mp_1', amount: '5.00', idempotency_key: 'ref_1' });
});

test('403 → StandUnavailableError', async () => {
  nextStatus = 403;
  await assert.rejects(createMockpayClient(baseUrl).getPayment('mp_1'), StandUnavailableError);
});

test('500 → MockpayError with the status', async () => {
  nextStatus = 500;
  await assert.rejects(createMockpayClient(baseUrl).getPayment('mp_1'), (err: unknown) => {
    assert.ok(err instanceof MockpayError);
    assert.equal(err.status, 500);
    return true;
  });
});

test('connection refused → StandUnavailableError', async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(
    createMockpayClient(`http://127.0.0.1:${port}/mockpay`).getPayment('mp_1'),
    StandUnavailableError,
  );
});
