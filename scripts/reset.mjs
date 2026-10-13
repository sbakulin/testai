import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSeedIntoDb } from './lib/db.mjs';
import { runCli } from './lib/stand.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));

/** Заново загружает task/seed.json в базу. */
export async function reset({ root = defaultRoot } = {}) {
  const file = join(root, 'task', 'seed.json');
  if (!existsSync(file)) throw new Error('Нет данных: сначала npm run connect -- КОД');
  loadSeedIntoDb(root, JSON.parse(readFileSync(file, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli(async () => {
    await reset();
    console.log('Данные сброшены к исходным.');
  });
}
