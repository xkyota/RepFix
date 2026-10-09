import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price } from './discount.mjs';
test('an explicit zero discount preserves the price', () => {
  assert.equal(price(100, 0), 100);
});
