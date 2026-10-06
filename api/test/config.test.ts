import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('loadConfig returns null without .env.local', () => {
  assert.equal(loadConfig(mkdtempSync(join(tmpdir(), 'cfg-'))), null);
});

test('loadConfig returns null without STAND_CODE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, '.env.local'), 'STAND_URL=https://stand.example\n');
  assert.equal(loadConfig(dir), null);
});

test('loadConfig reads KEY=VALUE lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(
    join(dir, '.env.local'),
    '# комментарий\nSTAND_URL=https://stand.example/\nSTAND_CODE=abc123\nWEBHOOK_SECRET="s3cret"\n',
  );
  assert.deepEqual(loadConfig(dir), {
    standUrl: 'https://stand.example',
    code: 'abc123',
    webhookSecret: 's3cret',
  });
});
