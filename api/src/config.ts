import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  standUrl: string;
  code: string;
  webhookSecret: string;
}

// Корень репозитория — на уровень выше api/
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

/** Читает .env.local; без файла или без STAND_CODE сервис не подключён к стенду. */
export function loadConfig(rootDir: string = repoRoot): Config | null {
  const file = join(rootDir, '.env.local');
  if (!existsSync(file)) return null;
  const env = parseEnv(readFileSync(file, 'utf8'));
  if (!env.STAND_CODE) return null;
  return {
    standUrl: (env.STAND_URL ?? '').replace(/\/+$/, ''),
    code: env.STAND_CODE,
    webhookSecret: env.WEBHOOK_SECRET ?? '',
  };
}
