import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { agentDirs, findAgentSessions } from './lib/sessions.mjs';
import { readEnv, runCli, standFetch } from './lib/stand.mjs';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const BASE_TAG = 'task-base';
const MAX_BYTES = 50 * 1024 * 1024;

const toPosix = (p) => p.split(path.sep).join('/');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 1024 ** 3, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function hasBaseTag(root) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${BASE_TAG}`]);
    return true;
  } catch {
    return false;
  }
}

/** Собирает архив: изменения относительно task-base, неотслеживаемые файлы, история агентов. */
const EXCLUDED = ['task', 'api/data', 'node_modules', 'dist', '.git'];

/** Файлы, которые никогда не уходят в архив, что бы ни говорил .gitignore. */
function isExcluded(rel) {
  const parts = toPosix(rel).split('/');
  if (parts.length === 1 && parts[0] === '.env.local') return true;
  const posix = parts.join('/');
  if (EXCLUDED.some((dir) => posix === dir || posix.startsWith(`${dir}/`))) return true;
  return parts.some((p) => p === 'node_modules' || p === 'dist' || p === '.git');
}

function tooBig(entries, total, maxBytes) {
  const largest = [...entries].sort((a, b) => b.size - a.size).slice(0, 3);
  const list = largest.map((f) => `${f.name} (${formatSize(f.size)})`).join(', ');
  return new Error(`Архив превышает 50 МБ (${formatSize(total)}). Самые большие файлы: ${list}`);
}

/** Собирает архив: изменения относительно task-base, неотслеживаемые файлы, история агентов. */
export async function buildSubmission({ root, homeDir = homedir(), maxBytes = MAX_BYTES }) {
  if (!hasBaseTag(root)) {
    throw new Error(`Не найден тег ${BASE_TAG}: склонируйте репозиторий заново с тегами (git fetch --tags)`);
  }
  // записи читаются лениво, чтобы проверить размер до загрузки файлов в память
  const entries = [];
  const addBytes = (name, bytes) => {
    const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
    entries.push({ name, size: buf.length, read: () => buf });
  };
  const addFile = (name, file) => {
    try {
      const st = lstatSync(file);
      if (!st.isFile()) return; // ссылки, каталоги вложенных репозиториев
      entries.push({ name, size: st.size, read: () => readFileSync(file) });
    } catch {
      // нет доступа — пропускаем
    }
  };

  addBytes('diff.patch', git(root, ['diff', '--binary', BASE_TAG]));

  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const rel of untracked) {
    if (!isExcluded(rel)) addFile(`untracked/${toPosix(rel)}`, path.join(root, rel));
  }

  const log = git(root, ['log', '--oneline', `${BASE_TAG}..HEAD`]).toString('utf8');
  const status = git(root, ['-c', 'core.quotepath=false', 'status', '--short']).toString('utf8');
  addBytes('git-log.txt', `# git log --oneline ${BASE_TAG}..HEAD\n${log}\n# git status --short\n${status}`);

  const sessions = findAgentSessions({ root, homeDir });
  const dirs = agentDirs(homeDir);
  for (const file of sessions) {
    const kind = file.startsWith(dirs.claude + path.sep) ? 'claude' : 'codex';
    addFile(`sessions/${kind}/${toPosix(path.relative(dirs[kind], file))}`, file);
  }

  addBytes('meta.json', JSON.stringify({
    node: process.version,
    platform: process.platform,
    created_at: new Date().toISOString(),
    sessions: sessions.length,
  }, null, 2));

  const rawTotal = entries.reduce((sum, e) => sum + e.size, 0);
  if (rawTotal > maxBytes) throw tooBig(entries, rawTotal, maxBytes);

  const zip = zipSync(Object.fromEntries(entries.map((e) => [e.name, e.read()])));
  if (zip.length > maxBytes) throw tooBig(entries, zip.length, maxBytes);
  return {
    files: entries.map((e) => ({ name: e.name, bytes: e.size })),
    zip,
    warnings: sessions.length ? [] : ['История сессий агента не найдена'],
    sessions: sessions.length,
  };
}

function ask(question, input, output) {
  const rl = createInterface({ input, output, terminal: false });
  return new Promise((resolve) => {
    let answered = false;
    rl.once('close', () => { if (!answered) resolve(''); });
    output.write(question);
    rl.once('line', (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

/** Сохраняет архив во временный каталог; имя с локальными датой и временем. */
function saveZip(zip, dir, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const file = path.resolve(dir, `payments-submission-${stamp}.zip`);
  writeFileSync(file, zip);
  return file;
}

/** Собирает архив, показывает состав, после подтверждения отправляет на стенд. */
export async function submit({ root = defaultRoot, homeDir = homedir(), yes = false, input = process.stdin, output = process.stdout, saveDir = tmpdir() } = {}) {
  const env = readEnv(root);
  if (!env?.STAND_CODE || !env?.STAND_URL) throw new Error('Нет кода: npm run connect -- КОД');

  const { files, zip, warnings, sessions } = await buildSubmission({ root, homeDir });
  for (const f of files) output.write(`${f.name}  ${formatSize(f.bytes)}\n`);
  output.write(`Всего: ${files.length} файлов, архив ${formatSize(zip.length)}\n`);
  for (const w of warnings) output.write(`Внимание: ${w}\n`);

  if (!yes) {
    const answer = (await ask('Отправить? [y/N] ', input, output)).trim();
    if (!['y', 'Y', 'д', 'Д'].includes(answer)) {
      output.write('Отменено\n');
      return { sent: false };
    }
  }

  try {
    const res = await standFetch(env, '/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip,
      timeoutMs: 120_000,
    });
    await res.arrayBuffer();
  } catch (err) {
    // архив не должен пропасть вместе с неудачной отправкой
    let file;
    try {
      file = saveZip(zip, saveDir);
    } catch {
      throw err;
    }
    const note = `Архив сохранён: ${file} — передайте его интервьюеру другим способом.`;
    if (err instanceof Error) {
      err.message = `${err.message}\n${note}`;
      err.savedArchive = file;
      throw err;
    }
    throw new Error(`${String(err)}\n${note}`);
  }
  const count = files.length;
  output.write(sessions
    ? `Сдано: ${count} файлов, история сессии получена\n`
    : `Сдано: ${count} файлов, история сессии НЕ найдена — экспортируйте вручную (/export) и пришлите интервьюеру\n`);
  return { sent: true, files: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli(async () => {
    await submit({ yes: process.argv.includes('--yes') });
  });
}
