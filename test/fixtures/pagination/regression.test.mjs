import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './paginate.mjs';
test('a full page includes its final item', () => {
  assert.deepEqual(page(['a', 'b', 'c', 'd'], 1, 2), ['a', 'b']);
});
