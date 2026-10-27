import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const HEAD_BYTES = 256 * 1024;
const HEAD_LINES = 30;

const looksLikeWindows = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');

function normalise(p) {
  const win = looksLikeWindows(p);
  let out = (win ? path.win32 : path).resolve(p).replace(/\\/g, '/');
  if (win) out = out.toLowerCase();
  return out.length > 1 ? out.replace(/\/+$/, '') : out;
}

/** true, если child совпадает с parent или лежит внутри него. Windows-пути сравниваются без учёта регистра. */
export function isInside(child, parent) {
  const c = normalise(child);
  const p = normalise(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/** Каталоги, где агенты хранят историю. */
export function agentDirs(homeDir = homedir()) {
  return {
    claude: path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homeDir, '.claude'), 'projects'),
    codex: path.join(homeDir, '.codex', 'sessions'),
  };
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function readHead(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function belongsTo(file, root) {
  const head = readHead(file);
  if (head === null) return false;
  for (const text of head.split('\n').slice(0, HEAD_LINES)) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      continue;
    }
    for (const cwd of [obj?.cwd, obj?.payload?.cwd]) {
      if (typeof cwd === 'string' && cwd && isInside(cwd, root)) return true;
    }
  }
  return false;
}

/** Файлы истории Claude Code и Codex, относящиеся к папке root. Абсолютные пути, отсортированные. */
export function findAgentSessions({ root, homeDir = homedir() }) {
  const dirs = agentDirs(homeDir);
  const found = new Set();
  for (const dir of [dirs.claude, dirs.codex]) {
    for (const file of walk(dir)) {
      if (belongsTo(file, root)) found.add(file);
    }
  }
  return [...found].sort();
}
