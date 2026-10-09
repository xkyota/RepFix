import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price } from './discount.mjs';
test('missing discount defaults to ten percent', () => assert.equal(price(100), 90));
test('positive discount remains supported', () => assert.equal(price(100, 0.2), 80));
