import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSeedIntoDb } from './lib/db.mjs';
import { DEFAULT_STAND_URL, runCli, standFetch, writeEnv } from './lib/stand.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));

/** Получает у стенда файлы задачи и данные, пишет .env.local и загружает данные в базу. */
export async function connect(code, { root = defaultRoot, standUrl = process.env.STAND_URL ?? DEFAULT_STAND_URL } = {}) {
  const env = { STAND_URL: standUrl.replace(/\/+$/, ''), STAND_CODE: code };
  const bundle = await (await standFetch(env, '/task')).json();

  const taskDir = join(root, 'task');
  mkdirSync(taskDir, { recursive: true });
  for (const [name, content] of Object.entries(bundle.files)) {
    // имя берём без каталогов: выйти за пределы task/ нельзя
    const safe = basename(name.replace(/\\/g, '/'));
    if (!safe || safe === '.' || safe === '..') continue;
    writeFileSync(join(taskDir, safe), content);
  }
  writeFileSync(join(taskDir, 'seed.json'), JSON.stringify(bundle.seed, null, 2));
  writeEnv(root, { ...env, WEBHOOK_SECRET: bundle.webhook_secret });
  loadSeedIntoDb(root, bundle.seed);
  return bundle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli(async () => {
    const code = process.argv[2];
    if (!code) throw new Error('Укажите код: npm run connect -- КОД');
    const bundle = await connect(code);
    console.log(`Загружено: счетов — ${bundle.seed.accounts.length}, платежей — ${bundle.seed.payments.length}.`);
    console.log('Задание лежит в task/TASK.md.');
    console.log(`Код действует до ${new Date(bundle.expires_at).toLocaleString('ru-RU')}.`);
    console.log('Запустите npm run dev (если он уже запущен — перезапустите)');
  });
}
