import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { runListener } from '../listen.mjs';
import { json, startStub } from './stub-stand.mjs';

const stubs = [];
afterEach(async () => {
  while (stubs.length) await stubs.pop().close();
});

async function start(handler) {
  const s = await startStub(handler);
  stubs.push(s);
  return s;
}

const BODY = '{"type":"payment.succeeded","payment_id":"mp_1"}';
const delivery = (id, extra = {}) => ({ delivery_id: id, attempt: 1, body: BODY, signature: 'abc123', ...extra });

/** Стенд с очередью доставок; запоминает присланные результаты. */
async function queueStand(deliveries) {
  const results = [];
  let queue = [...deliveries];
  const stand = await start((req, res, body) => {
    if (req.method === 'GET' && req.url.startsWith('/s/CODE/mockpay/events')) {
      const events = queue;
      queue = [];
      if (events.length) return json(res, 200, { events });
      return setTimeout(() => json(res, 200, { events: [] }), 20);
    }
    const m = req.url.match(/^\/s\/CODE\/mockpay\/events\/(.+)\/result$/);
    if (req.method === 'POST' && m) {
      results.push({ id: decodeURIComponent(m[1]), ...JSON.parse(body) });
      return json(res, 200, { ok: true });
    }
    json(res, 403, {});
  });
  return { stand, results };
}

async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('условие не выполнено вовремя');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function runUntilResults(stand, results, n, opts = {}) {
  const controller = new AbortController();
  const lines = [];
  const done = runListener({
    env: { STAND_URL: stand.url, STAND_CODE: 'CODE' },
    wait: 1,
    signal: controller.signal,
    log: (l) => lines.push(l),
    ...opts,
  });
  return until(() => results.length >= n).then(() => {
    controller.abort();
    return done.then(() => lines);
  });
}

test('listener forwards body and signature untouched, reports 200', async () => {
  const { stand, results } = await queueStand([delivery('d1')]);
  const received = [];
  const target = await start((req, res, body) => {
    received.push({ body, signature: req.headers['x-signature'], type: req.headers['content-type'] });
    json(res, 200, { ok: true });
  });
  const lines = await runUntilResults(stand, results, 1, { target: `${target.url}/webhooks/mockpay` });
  assert.deepEqual(received, [{ body: BODY, signature: 'abc123', type: 'application/json' }]);
  assert.deepEqual(results, [{ id: 'd1', status: 200 }]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /payment\.succeeded/);
  assert.match(lines[0], /mp_1/);
});

test('listener reports "timeout" when target is slower than 2000 ms', async () => {
  const { stand, results } = await queueStand([delivery('d1')]);
  const target = await start((req, res) => setTimeout(() => json(res, 200, {}), 600));
  await runUntilResults(stand, results, 1, { target: target.url, timeoutMs: 100 });
  assert.deepEqual(results, [{ id: 'd1', status: 'timeout' }]);
});

test('listener reports "timeout" when the target is not running', async () => {
  const { stand, results } = await queueStand([delivery('d1')]);
  const dead = await startStub(() => {});
  const deadUrl = dead.url;
  await dead.close();
  await runUntilResults(stand, results, 1, { target: deadUrl });
  assert.deepEqual(results, [{ id: 'd1', status: 'timeout' }]);
});

test('listener reports target status when not 200', async () => {
  const { stand, results } = await queueStand([delivery('d1')]);
  const target = await start((req, res) => json(res, 500, { error: 'boom' }));
  await runUntilResults(stand, results, 1, { target: target.url });
  assert.deepEqual(results, [{ id: 'd1', status: 500 }]);
});

test('listener forwards deliveries concurrently', async () => {
  const { stand, results } = await queueStand([delivery('d1'), delivery('d2', { attempt: 2 })]);
  let active = 0;
  let maxActive = 0;
  const target = await start((req, res) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      active -= 1;
      json(res, 200, {});
    }, 150);
  });
  await runUntilResults(stand, results, 2, { target: target.url });
  assert.equal(maxActive, 2);
});

test('listener prints «Код истёк» once and stops on 403', async () => {
  const stand = await start((req, res) => json(res, 403, { detail: 'invalid or expired code' }));
  const lines = [];
  await runListener({
    env: { STAND_URL: stand.url, STAND_CODE: 'CODE' },
    wait: 1,
    log: (l) => lines.push(l),
  });
  assert.deepEqual(lines, ['Код истёк, вебхуки больше не приходят.']);
});

test('listener prints unreachable message once per outage and stops on abort', async () => {
  const dead = await startStub(() => {});
  const url = dead.url;
  await dead.close();
  const controller = new AbortController();
  const lines = [];
  const done = runListener({
    env: { STAND_URL: url, STAND_CODE: 'CODE' },
    wait: 1,
    signal: controller.signal,
    log: (l) => lines.push(l),
  });
  await until(() => lines.length >= 1);
  controller.abort();
  await done;
  assert.equal(lines.length, 1);
  assert.match(lines[0], /порт 8090/);
});
