import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { findAgentSessions, isInside } from '../lib/sessions.mjs';
import { StandError } from '../lib/stand.mjs';
import { buildSubmission, submit } from '../submit.mjs';
import { json, startStub } from './stub-stand.mjs';

let tmp;
let homeDir;
let savedConfigDir;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'submit-'));
  homeDir = join(tmp, 'home');
  mkdirSync(homeDir);
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  rmSync(tmp, { recursive: true, force: true });
});

function write(file, content) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

const line = (obj) => `${JSON.stringify(obj)}\n`;

function claudeSession(name, cwd, project = 'proj') {
  const file = join(homeDir, '.claude', 'projects', project, name);
  write(file, line({ type: 'summary' }) + line({ type: 'user', cwd, message: 'привет' }));
  return file;
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** Временный репозиторий: коммит, тег task-base, затем правки. */
function makeRepo() {
  const root = join(tmp, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(join(root, '.gitignore'), 'node_modules\ntask/\n.env.local\n');
  write(join(root, 'src.txt'), 'one\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'tag', 'task-base');
  write(join(root, 'src.txt'), 'one\ntwo\n');
  write(join(root, 'new.txt'), 'brand new\n');
  write(join(root, 'node_modules', 'x'), 'ignored');
  write(join(root, 'task', 'TASK.md'), 'ignored');
  return root;
}

test('finds sessions by cwd, including nested dirs and paths with spaces and Cyrillic', () => {
  const root = join(tmp, 'Мои проекты', 'test ai');
  mkdirSync(root, { recursive: true });
  const a = claudeSession('a.jsonl', root);
  const b = claudeSession('b.jsonl', join(root, 'web'));
  claudeSession('c.jsonl', join(tmp, 'Мои проекты', 'другая папка'));
  claudeSession('d.jsonl', `${root}-sibling`);
  const found = findAgentSessions({ root, homeDir });
  assert.deepEqual(found, [a, b].sort());
});

test('finds nested sub-session files and honours CLAUDE_CONFIG_DIR', () => {
  const root = join(tmp, 'repo');
  const cfg = join(tmp, 'cfg');
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const nested = join(cfg, 'projects', 'p', 'sess', 'subagents', 'agent.jsonl');
  write(nested, line({ cwd: root }));
  claudeSession('ignored.jsonl', root); // лежит в ~/.claude, а не в CLAUDE_CONFIG_DIR
  assert.deepEqual(findAgentSessions({ root, homeDir }), [nested]);
});

test('skips non-JSON lines and unrelated files silently', () => {
  const root = join(tmp, 'repo');
  const file = join(homeDir, '.claude', 'projects', 'p', 'a.jsonl');
  write(file, `не json\n{broken\n${line({ cwd: root })}`);
  write(join(homeDir, '.claude', 'projects', 'p', 'note.txt'), line({ cwd: root }));
  assert.deepEqual(findAgentSessions({ root, homeDir }), [file]);
});

test('matches Windows-style cwd case-insensitively', () => {
  assert.equal(isInside('C:\\Users\\Me\\Proj\\web', 'c:/users/me/proj'), true);
  assert.equal(isInside('c:\\users\\me\\proj', 'C:\\Users\\Me\\Proj\\'), true);
  assert.equal(isInside('C:\\Users\\Me\\Proj2', 'C:\\Users\\Me\\Proj'), false);
  assert.equal(isInside('D:\\Users\\Me\\Proj', 'C:\\Users\\Me\\Proj'), false);
  // на POSIX регистр значим
  assert.equal(isInside('/home/Me/proj/web', '/home/Me/proj'), true);
  assert.equal(isInside('/home/me/proj', '/home/Me/proj'), false);
});

test('codex session with payload.cwd is found', () => {
  const root = join(tmp, 'repo');
  const hit = join(homeDir, '.codex', 'sessions', '2026', '01', '02', 'rollout-1.jsonl');
  const miss = join(homeDir, '.codex', 'sessions', '2026', '01', '02', 'rollout-2.jsonl');
  write(hit, line({ type: 'session_meta', payload: { cwd: join(root, 'api') } }));
  write(miss, line({ type: 'session_meta', payload: { cwd: join(tmp, 'other') } }));
  assert.deepEqual(findAgentSessions({ root, homeDir }), [hit]);
});

test('submission has diff.patch, untracked file, git-log.txt, meta.json; no node_modules, no task/', async () => {
  const root = makeRepo();
  const claude = claudeSession('a.jsonl', root, '-repo');
  const codex = join(homeDir, '.codex', 'sessions', '2026', 'r.jsonl');
  write(codex, line({ payload: { cwd: root } }));
  const { files, zip, warnings } = await buildSubmission({ root, homeDir });
  const entries = unzipSync(zip);
  const names = Object.keys(entries).sort();
  assert.deepEqual(names, [
    'diff.patch',
    'git-log.txt',
    'meta.json',
    'sessions/claude/-repo/a.jsonl',
    'sessions/codex/2026/r.jsonl',
    'untracked/new.txt',
  ]);
  assert.deepEqual(files.map((f) => f.name).sort(), names);
  assert.match(strFromU8(entries['diff.patch']), /\+two/);
  assert.equal(strFromU8(entries['untracked/new.txt']), 'brand new\n');
  assert.match(strFromU8(entries['git-log.txt']), /\?\? new\.txt/);
  const meta = JSON.parse(strFromU8(entries['meta.json']));
  assert.equal(meta.node, process.version);
  assert.equal(meta.platform, process.platform);
  assert.equal(meta.sessions, 2);
  assert.ok(!Number.isNaN(Date.parse(meta.created_at)));
  assert.deepEqual(warnings, []);
  assert.ok(claude && codex);
});

test('git-log.txt lists commits made after task-base', async () => {
  const root = makeRepo();
  git(root, 'add', 'src.txt');
  git(root, 'commit', '-q', '-m', 'my change');
  const { zip } = await buildSubmission({ root, homeDir });
  assert.match(strFromU8(unzipSync(zip)['git-log.txt']), /my change/);
  assert.match(strFromU8(unzipSync(zip)['diff.patch']), /\+two/);
});

test('missing task-base tag → clear error', async () => {
  const root = makeRepo();
  git(root, 'tag', '-d', 'task-base');
  await assert.rejects(buildSubmission({ root, homeDir }), /Не найден тег task-base: склонируйте репозиторий заново с тегами \(git fetch --tags\)/);
});

test('no sessions → warning present, zip still built', async () => {
  const root = makeRepo();
  const { warnings, zip } = await buildSubmission({ root, homeDir });
  assert.deepEqual(warnings, ['История сессий агента не найдена']);
  assert.ok(zip.length > 0);
});

test('over 50 MB → throws with the three largest files listed', async () => {
  const root = makeRepo();
  write(join(root, 'big1.bin'), 'a'.repeat(3000));
  write(join(root, 'big2.bin'), 'b'.repeat(2000));
  write(join(root, 'big3.bin'), 'c'.repeat(1000));
  await assert.rejects(buildSubmission({ root, homeDir, maxBytes: 1 }), (err) => {
    assert.match(err.message, /50 МБ/);
    const i1 = err.message.indexOf('untracked/big1.bin');
    const i2 = err.message.indexOf('untracked/big2.bin');
    const i3 = err.message.indexOf('untracked/big3.bin');
    assert.ok(i1 !== -1 && i1 < i2 && i2 < i3);
    assert.doesNotMatch(err.message, /new\.txt/);
    return true;
  });
});

async function standWithSubmit(handler) {
  return startStub(handler);
}

function writeEnvFile(root, url) {
  writeFileSync(join(root, '.env.local'), `STAND_URL=${url}\nSTAND_CODE=CODE\nWEBHOOK_SECRET=s\n`);
}

function capture() {
  const output = new PassThrough();
  let text = '';
  output.on('data', (c) => { text += c; });
  return { output, text: () => text };
}

test('submit uploads the zip after confirmation and prints the final line', async () => {
  const root = makeRepo();
  claudeSession('a.jsonl', root, '-repo');
  let received;
  const stand = await standWithSubmit((req, res, body) => {
    received = { url: req.url, method: req.method, type: req.headers['content-type'], body };
    json(res, 200, { ok: true, received: 99, bytes: body.length });
  });
  try {
    writeEnvFile(root, stand.url);
    const input = new PassThrough();
    input.end('y\n');
    const out = capture();
    await submit({ root, homeDir, input, output: out.output });
    assert.equal(received.url, '/s/CODE/submit');
    assert.equal(received.method, 'POST');
    assert.equal(received.type, 'application/zip');
    assert.ok(received.body.length > 0);
    assert.match(out.text(), /diff\.patch/);
    assert.match(out.text(), /Отправить\? \[y\/N\]/);
    assert.match(out.text(), /Сдано: 5 файлов, история сессии получена/);
    assert.doesNotMatch(out.text(), /99/);
  } finally {
    await stand.close();
  }
});

test('submit prints the manual-export line when no sessions were found', async () => {
  const root = makeRepo();
  const stand = await standWithSubmit((req, res) => json(res, 200, { ok: true, received: 99, bytes: 1 }));
  try {
    writeEnvFile(root, stand.url);
    const out = capture();
    await submit({ root, homeDir, yes: true, output: out.output });
    assert.match(out.text(), /История сессий агента не найдена/);
    assert.match(out.text(), /Сдано: 4 файлов, история сессии НЕ найдена — экспортируйте вручную \(\/export\) и пришлите интервьюеру/);
  } finally {
    await stand.close();
  }
});

test('submit: anything but y cancels and sends nothing', async () => {
  const root = makeRepo();
  let hits = 0;
  const stand = await standWithSubmit((req, res) => { hits += 1; json(res, 200, { ok: true, received: 1 }); });
  try {
    writeEnvFile(root, stand.url);
    const input = new PassThrough();
    input.end('n\n');
    const out = capture();
    await submit({ root, homeDir, input, output: out.output });
    assert.match(out.text(), /Отменено/);
    assert.equal(hits, 0);
  } finally {
    await stand.close();
  }
});

test('submit: no .env.local → «Нет кода»', async () => {
  const root = makeRepo();
  await assert.rejects(submit({ root, homeDir, yes: true, output: capture().output }), /Нет кода: npm run connect -- КОД/);
});

test('expired code → message «Код не подходит или истёк»', async () => {
  const root = makeRepo();
  const stand = await standWithSubmit((req, res) => json(res, 403, { detail: 'invalid or expired code' }));
  try {
    writeEnvFile(root, stand.url);
    await assert.rejects(submit({ root, homeDir, yes: true, output: capture().output, saveDir: tmp }), (err) => {
      assert.ok(err instanceof StandError);
      assert.match(err.message, /Код не подходит или истёк/);
      return true;
    });
  } finally {
    await stand.close();
  }
});

/** Путь из строки «Архив сохранён: …» и проверка, что это тот самый архив, что ушёл бы на стенд. */
function savedArchive(err, saveDir) {
  const m = err.message.match(/\nАрхив сохранён: (.+) — передайте его интервьюеру другим способом\.$/);
  assert.ok(m, err.message);
  const file = m[1];
  assert.ok(file.startsWith(saveDir), file);
  assert.match(file, /payments-submission-\d{8}-\d{6}\.zip$/);
  assert.ok(existsSync(file));
  assert.equal(err.savedArchive, file);
  return readFileSync(file);
}

test('rejected upload (403) → archive saved with the same bytes, path printed', async () => {
  const root = makeRepo();
  const saveDir = join(tmp, 'saved');
  mkdirSync(saveDir);
  let body;
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { body = Buffer.concat(chunks); json(res, 403, { detail: 'invalid or expired code' }); });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    writeEnvFile(root, `http://127.0.0.1:${server.address().port}`);
    await assert.rejects(submit({ root, homeDir, yes: true, output: capture().output, saveDir }), (err) => {
      assert.ok(err instanceof StandError);
      assert.match(err.message, /^Код не подходит или истёк/);
      const saved = savedArchive(err, saveDir);
      assert.ok(body.length > 0);
      assert.ok(saved.equals(body));
      return true;
    });
  } finally {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
});

test('unreachable stand → archive saved, path printed after the error', async () => {
  const root = makeRepo();
  const saveDir = join(tmp, 'saved');
  mkdirSync(saveDir);
  // свободный порт, на котором никто не слушает
  const probe = createServer();
  await new Promise((ok) => probe.listen(0, '127.0.0.1', ok));
  const port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  writeEnvFile(root, `http://127.0.0.1:${port}`);
  const { zip } = await buildSubmission({ root, homeDir });
  await assert.rejects(submit({ root, homeDir, yes: true, output: capture().output, saveDir }), (err) => {
    assert.ok(err instanceof StandError);
    assert.match(err.message, /^Стенд недоступен/);
    const saved = savedArchive(err, saveDir);
    // meta.json содержит время сборки, поэтому сверяем побайтно все остальные файлы архива
    const got = unzipSync(saved);
    const want = unzipSync(zip);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
    for (const name of Object.keys(want)) {
      if (name !== 'meta.json') assert.ok(Buffer.from(got[name]).equals(Buffer.from(want[name])), name);
    }
    return true;
  });
});

test('never packs .env.local, task/, api/data/, node_modules/, dist/ even if .gitignore misses them', async () => {
  const root = makeRepo();
  write(join(root, '.gitignore'), '');
  for (const f of ['.env.local', 'task/TASK.md', 'api/data/app.db', 'node_modules/x', 'dist/a.js', 'web/dist/b.js', 'web/node_modules/y']) {
    write(join(root, f), 'secret');
  }
  write(join(root, 'api', 'src', 'ok.txt'), 'fine');
  const { files } = await buildSubmission({ root, homeDir });
  const untracked = files.map((f) => f.name).filter((n) => n.startsWith('untracked/')).sort();
  assert.deepEqual(untracked, ['untracked/api/src/ok.txt', 'untracked/new.txt'].sort());
});

test('untracked symlinks are not followed', async () => {
  const root = makeRepo();
  const outside = join(tmp, 'outside.txt');
  write(outside, 'private');
  symlinkSync(outside, join(root, 'link.txt'));
  const { files } = await buildSubmission({ root, homeDir });
  assert.ok(!files.some((f) => f.name === 'untracked/link.txt'));
});

test('raw size over the limit throws even when the zip would fit', async () => {
  const root = makeRepo();
  write(join(root, 'big1.bin'), 'a'.repeat(30000));
  write(join(root, 'big2.bin'), 'b'.repeat(20000));
  write(join(root, 'big3.bin'), 'c'.repeat(10000));
  await assert.rejects(buildSubmission({ root, homeDir, maxBytes: 20000 }), (err) => {
    assert.match(err.message, /превышает 50 МБ/);
    assert.ok(err.message.indexOf('big1.bin') < err.message.indexOf('big2.bin'));
    return true;
  });
});

test('finds sessions whose cwd is the real path of a symlinked root', () => {
  const real = join(tmp, 'real');
  mkdirSync(real);
  const link = join(tmp, 'link');
  symlinkSync(real, link);
  const file = claudeSession('a.jsonl', realpathSync(real));
  assert.deepEqual(findAgentSessions({ root: link, homeDir }), [file]);
});
