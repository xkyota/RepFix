import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, invoke, start, command, confirm, cause, manifest } from './helpers.mjs';

test('an unapproved command is rejected before it executes', async t => {
  const root = await fixture(t), session = start(root);
  invoke(['run', '--session', session, '--phase', 'reproduce', '--name', 'unapproved', '--',
    process.execPath, '-e', 'require("fs").writeFileSync("executed.txt", "unsafe")'], 3);
  await assert.rejects(readFile(join(root, 'executed.txt')));
  assert.equal((await manifest(session)).commands.length, 0);
});

test('all-skipped tests cannot turn a confirmed bug into VERIFIED', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'state.mjs'), 'export const skip = false;\n');
  await writeFile(join(root, 'discount.test.mjs'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skip } from './state.mjs';
test('reported bug', { skip }, () => assert.fail('reported bug still exists'));\n`);
  const session = start(root);
  command(session, 'reproduce', 1); confirm(session); cause(session);
  await writeFile(join(root, 'state.mjs'), 'export const skip = true;\n');
  command(session, 'verify');
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  const result = JSON.parse(invoke(['report', '--session', session], 2));
  assert.equal(result.status, 'UNVERIFIED');
});
