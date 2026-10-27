import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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
export async function buildSubmission({ root, homeDir = homedir(), maxBytes = MAX_BYTES }) {
  if (!hasBaseTag(root)) {
    throw new Error(`Не найден тег ${BASE_TAG}: склонируйте репозиторий заново с тегами (git fetch --tags)`);
  }
  const files = [];
  const add = (name, bytes) => files.push({ name, bytes: typeof bytes === 'string' ? Buffer.from(bytes) : bytes });

  add('diff.patch', git(root, ['diff', '--binary', BASE_TAG]));

  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const rel of untracked) {
    try {
      add(`untracked/${toPosix(rel)}`, readFileSync(path.join(root, rel)));
    } catch {
      // каталог (вложенный репозиторий), битая ссылка или нет доступа
    }
  }

  const log = git(root, ['log', '--oneline', `${BASE_TAG}..HEAD`]).toString('utf8');
  const status = git(root, ['-c', 'core.quotepath=false', 'status', '--short']).toString('utf8');
  add('git-log.txt', `# git log --oneline ${BASE_TAG}..HEAD\n${log}\n# git status --short\n${status}`);

  const sessions = findAgentSessions({ root, homeDir });
  const dirs = agentDirs(homeDir);
  for (const file of sessions) {
    const kind = file.startsWith(dirs.claude + path.sep) ? 'claude' : 'codex';
    add(`sessions/${kind}/${toPosix(path.relative(dirs[kind], file))}`, readFileSync(file));
  }

  add('meta.json', JSON.stringify({
    node: process.version,
    platform: process.platform,
    created_at: new Date().toISOString(),
    sessions: sessions.length,
  }, null, 2));

  const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])));
  if (zip.length > maxBytes) {
    const largest = [...files].sort((a, b) => b.bytes.length - a.bytes.length).slice(0, 3);
    const list = largest.map((f) => `${f.name} (${formatSize(f.bytes.length)})`).join(', ');
    throw new Error(`Архив превышает 50 МБ (${formatSize(zip.length)}). Самые большие файлы: ${list}`);
  }
  return {
    files: files.map((f) => ({ name: f.name, bytes: f.bytes.length })),
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

/** Собирает архив, показывает состав, после подтверждения отправляет на стенд. */
export async function submit({ root = defaultRoot, homeDir = homedir(), yes = false, input = process.stdin, output = process.stdout } = {}) {
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

  const res = await standFetch(env, '/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: zip,
    timeoutMs: 120_000,
  });
  const reply = await res.json().catch(() => ({}));
  const count = reply.received ?? files.length;
  output.write(sessions
    ? `Сдано: ${count} файлов, история сессии получена\n`
    : `Сдано: ${count} файлов, история сессии НЕ найдена — экспортируйте вручную (/export) и пришлите интервьюеру\n`);
  return { sent: true, received: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli(async () => {
    await submit({ yes: process.argv.includes('--yes') });
  });
}
