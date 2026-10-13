import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_STAND_URL = 'http://62.83.97.104:8090';

const MESSAGES = {
  unreachable: 'Стенд недоступен. Проверьте интернет и VPN: нужен исходящий доступ на порт 8090.',
  expired: 'Код не подходит или истёк. Возьмите код у интервьюера.',
};

export class StandError extends Error {
  constructor(kind) {
    super(MESSAGES[kind]);
    this.name = 'StandError';
    this.kind = kind;
  }
}

/** Разбирает .env.local; без файла возвращает null. */
export function readEnv(root) {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return null;
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

export function writeEnv(root, { STAND_URL, STAND_CODE, WEBHOOK_SECRET }) {
  const text = `STAND_URL=${STAND_URL}\nSTAND_CODE=${STAND_CODE}\nWEBHOOK_SECRET=${WEBHOOK_SECRET}\n`;
  writeFileSync(join(root, '.env.local'), text);
}

/** Запрос к стенду: сетевые ошибки и таймаут — unreachable, 403 — expired, прочие не-2xx — обычная ошибка. */
export async function standFetch(env, path, init = {}) {
  const { timeoutMs = 10_000, signal, ...rest } = init;
  const url = `${env.STAND_URL.replace(/\/+$/, '')}/s/${encodeURIComponent(env.STAND_CODE)}${path}`;
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  let res;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.any(signals) });
  } catch (err) {
    // остановку слушателя не маскируем под недоступность стенда
    if (signal?.aborted) throw err;
    throw new StandError('unreachable');
  }
  if (res.status === 403) throw new StandError('expired');
  if (!res.ok) throw new Error(`Стенд ответил HTTP ${res.status}`);
  return res;
}

/** Общая обёртка для запуска скрипта из командной строки. */
export async function runCli(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
