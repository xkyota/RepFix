import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './paginate.mjs';
test('empty results stay empty', () => assert.deepEqual(page([], 1, 10), []));
test('partial final pages do not pad missing items', () => assert.deepEqual(page(['a', 'b', 'c'], 2, 2), ['c']));
