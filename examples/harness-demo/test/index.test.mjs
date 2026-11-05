import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTasks } from '../src/index.mjs';

test('counts completed tasks and remaining work', () => {
  assert.deepEqual(summarizeTasks([{ done: true }, { done: false }, {}]), { total: 3, done: 1, remaining: 2 });
});
test('an empty list has no remaining work', () => {
  assert.deepEqual(summarizeTasks([]), { total: 0, done: 0, remaining: 0 });
});
test('rejects a non-array input', () => { assert.throws(() => summarizeTasks(null), TypeError); });
