import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err } from '../src/result.mjs';

test('ok wraps value', () => {
  assert.deepEqual(ok(5), { ok: true, value: 5 });
});
test('err wraps message', () => {
  assert.deepEqual(err('boom'), { ok: false, error: 'boom' });
});
