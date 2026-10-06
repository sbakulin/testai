import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMinor, toSums } from '../src/money.js';

test('toMinor parses sums without float', () => {
  assert.equal(toMinor('150000.00'), 15000000);
  assert.equal(toMinor('1.15'), 115);
  assert.equal(toMinor('-500.00'), -50000);
  assert.equal(toSums(15000000), '150000.00');
});

test('toMinor accepts whole and one-decimal amounts', () => {
  assert.equal(toMinor('7'), 700);
  assert.equal(toMinor('0.5'), 50);
  assert.equal(toMinor('0.07'), 7);
});

test('toSums formats small and negative amounts', () => {
  assert.equal(toSums(5), '0.05');
  assert.equal(toSums(-50000), '-500.00');
  assert.equal(toSums(0), '0.00');
});

test('toMinor rejects malformed input', () => {
  for (const bad of ['abc', '1.005', '', '1,5', '1.', '.5', ' 1.00', '--1']) {
    assert.throws(() => toMinor(bad), `expected "${bad}" to throw`);
  }
});
