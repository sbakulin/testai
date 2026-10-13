import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnv, StandError, standFetch } from './lib/stand.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const POLL_WAIT_S = 25;
const RETRY_DELAY_MS = 2000;

function sleep(ms, signal) {
  return new Promise((done) => {
    if (signal?.aborted) return done();
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true });
  });
}

function describe(body) {
  try {
    const event = JSON.parse(body);
    const type = event.type ?? event.event ?? 'событие';
    const paymentId = event.payment_id ?? event.data?.payment_id ?? event.data?.id ?? event.payment?.id ?? '-';
    return { type, paymentId };
  } catch {
    return { type: 'событие', paymentId: '-' };
  }
}

/** Пересылает доставку локальному сервису; возвращает HTTP-статус или 'timeout'. */
async function forward(delivery, target, timeoutMs) {
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': delivery.signature },
      body: delivery.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer();
    return res.status;
  } catch {
    return 'timeout';
  }
}

/** Опрашивает стенд и пересылает вебхуки в локальный сервис, пока не истечёт код или не сработает signal. */
export async function runListener({
  env,
  target = 'http://localhost:3000/webhooks/mockpay',
  timeoutMs = 2000,
  signal,
  wait = POLL_WAIT_S,
  log = console.log,
}) {
  const inflight = new Set();
  let down = false;

  const handle = async (delivery) => {
    const status = await forward(delivery, target, timeoutMs);
    const { type, paymentId } = describe(delivery.body);
    const time = new Date().toLocaleTimeString('ru-RU');
    log(`${time} ${type} ${paymentId} попытка ${delivery.attempt}: ${status === 'timeout' ? 'нет ответа' : status}`);
    try {
      await standFetch(env, `/mockpay/events/${encodeURIComponent(delivery.delivery_id)}/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
        signal,
      });
    } catch {
      // результат не дошёл — стенд повторит доставку сам
    }
  };

  while (!signal?.aborted) {
    let events;
    try {
      const res = await standFetch(env, `/mockpay/events?wait=${wait}`, { timeoutMs: (wait + 10) * 1000, signal });
      ({ events } = await res.json());
      down = false;
    } catch (err) {
      if (signal?.aborted) break;
      if (err instanceof StandError && err.kind === 'expired') {
        log('Код истёк, вебхуки больше не приходят.');
        break;
      }
      if (!down) log(err instanceof StandError ? err.message : `Ошибка опроса стенда: ${err.message}`);
      down = true;
      await sleep(RETRY_DELAY_MS, signal);
      continue;
    }
    for (const delivery of events) {
      const task = handle(delivery).finally(() => inflight.delete(task));
      inflight.add(task);
    }
  }
  await Promise.allSettled(inflight);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = readEnv(defaultRoot);
  if (!env?.STAND_CODE) {
    // не роняем остальные процессы dev
    console.log('Нет кода: npm run connect -- КОД');
    process.exit(0);
  }
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => controller.abort());
  try {
    await runListener({ env, signal: controller.signal });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
