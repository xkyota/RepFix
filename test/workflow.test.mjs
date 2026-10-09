import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, invoke, start, command, confirm, cause, fix, complete, manifest } from './helpers.mjs';

test('real Node bug: fail, diagnose, minimal fix, same test, regressions, VERIFIED report', async t => {
  const root = await fixture(t);
  const session = start(root);
  await complete(root, session);
  const result = JSON.parse(invoke(['report', '--session', session]));
  assert.equal(result.status, 'VERIFIED');
  assert.deepEqual(result.changedFiles, ['discount.mjs']);
  const run = await manifest(session);
  assert.deepEqual(run.commands.map(c => c.exitCode), [1, 0, 0]);
  assert.match(await readFile(join(session, 'a2.log'), 'utf8'), /90 !== 100|90.*100/s);
  assert.match(await readFile(join(session, 'report.md'), 'utf8'), /c1.*reproduce/);
  assert.equal(JSON.parse(await readFile(join(session, 'report.json'))).status, 'VERIFIED');
});

test('a passing smoke test cannot replace the original reproduction', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1); confirm(session); cause(session);
  await fix(root);
  command(session, 'verify', 0, ['-e', 'console.log("smoke")']);
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  const result = JSON.parse(invoke(['report', '--session', session], 2));
  assert.equal(result.status, 'PARTIALLY_VERIFIED');
  assert.match(result.reasons.join(' '), /same command/);
});

test('changed assertion blocks VERIFIED even with a test-change explanation', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1); confirm(session); cause(session);
  const test = join(root, 'discount.test.mjs');
  await writeFile(test, (await readFile(test, 'utf8')).replace('), 100)', '), 90)'));
  invoke(['note', '--session', session, '--kind', 'test-change', '--text', 'Demonstrate an invalid weakening of the assertion']);
  command(session, 'verify');
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  const result = JSON.parse(invoke(['report', '--session', session], 2));
  assert.match(result.reasons.join(' '), /assertion files.*changed/);
});

test('missing regressions and later source edits prevent verification', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1); confirm(session); cause(session); await fix(root);
  command(session, 'verify');
  assert.match(invoke(['report', '--session', session], 2), /Regression unit/);
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  await writeFile(join(root, 'new-source.mjs'), 'export const changed = true;\n');
  assert.match(invoke(['report', '--session', session], 2), /Project changed after verification/);
});

test('latest failing verification is FAILED, and a successful retry can recover', async t => {
  const root = await fixture(t), session = start(root);
  await complete(root, session);
  await writeFile(join(root, 'discount.mjs'), 'export function price() { return 0; }\n');
  command(session, 'verify', 1);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 1)).status, 'FAILED');
  await writeFile(join(root, 'discount.mjs'), 'export function price(total, discount) {\n  return total * (1 - (discount ?? 0.1));\n}\n');
  command(session, 'verify');
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  assert.equal(JSON.parse(invoke(['report', '--session', session])).status, 'VERIFIED');
});

test('diagnose-only preserves project and reports UNVERIFIED', async t => {
  const root = await fixture(t), session = start(root, ['--mode', 'diagnose-only']);
  command(session, 'reproduce', 1); confirm(session); cause(session);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 2)).status, 'UNVERIFIED');
  command(session, 'verify', 3);
  await fix(root);
  assert.match(invoke(['report', '--session', session], 1), /read-only mode was violated/);
});

test('verify-only passes are PARTIALLY_VERIFIED and no reproduction is allowed', async t => {
  const root = await fixture(t); await fix(root);
  const session = start(root, ['--mode', 'verify-only']);
  command(session, 'reproduce', 3);
  command(session, 'verify');
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  assert.equal(JSON.parse(invoke(['report', '--session', session], 2)).status, 'PARTIALLY_VERIFIED');
});

test('changed environment and context cannot verify the same scenario', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1, undefined, undefined, ['--context', 'fixture-v1']); confirm(session); cause(session);
  await fix(root);
  command(session, 'verify', 0, undefined, undefined, ['--context', 'fixture-v2']);
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  assert.match(invoke(['report', '--session', session], 2), /same command, environment/);
});

test('spawn failures and timeouts are blockers, never confirmed reproductions', async t => {
  const root = await fixture(t), session = start(root);
  invoke(['run', '--session', session, '--phase', 'reproduce', '--name', 'missing', '--', 'repfix-command-that-does-not-exist'], 3);
  invoke(['confirm', '--session', session, '--command', 'c1', '--reason', 'not a bug'], 3);
  command(session, 'reproduce', 3, ['-e', 'setInterval(()=>{}, 1000)'], 'timeout', ['--timeout', '100']);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 3)).status, 'BLOCKED');
  assert.equal((await manifest(session)).commands[1].timedOut, true);
});

test('binary evidence requires explicit review; hashes detect missing or altered evidence', async t => {
  const root = await fixture(t), session = start(root);
  await complete(root, session);
  const png = join(root, '.repfix', 'synthetic.png');
  await writeFile(png, Buffer.from('synthetic non-private bytes'));
  invoke(['attach', '--session', session, '--file', png], 3);
  const artifact = JSON.parse(invoke(['attach', '--session', session, '--file', png, '--reviewed']));
  await writeFile(join(session, artifact.file), 'altered');
  assert.match(invoke(['report', '--session', session], 3), /hash mismatch/);
  await rm(join(session, artifact.file));
  assert.match(invoke(['report', '--session', session], 3), /missing or unsafe/);
});

test('existing staged and unstaged changes remain byte-for-byte intact', async t => {
  const root = await fixture(t);
  const git = args => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  git(['init', '-q']);
  await writeFile(join(root, 'user.mjs'), 'staged\n'); git(['add', 'user.mjs']);
  await writeFile(join(root, 'user.mjs'), 'unstaged user work\n');
  const stagedBefore = git(['diff', '--cached']);
  const session = start(root);
  await complete(root, session); invoke(['report', '--session', session]);
  assert.equal(git(['diff', '--cached']), stagedBefore);
  assert.equal(await readFile(join(root, 'user.mjs'), 'utf8'), 'unstaged user work\n');
  assert.ok(!(git(['status', '--short'])).includes('.repfix'));
});

test('locks, symlinks, cwd traversal, and malformed options are rejected', async t => {
  const root = await fixture(t), session = start(root);
  await writeFile(join(session, '.lock'), `${process.pid}\n`);
  assert.match(invoke(['report', '--session', session], 3), /^$/);
  await rm(join(session, '.lock'));
  command(session, 'reproduce', 3, ['-e', 'process.exit(0)'], 'unsafe', ['--cwd', '..']);
  await symlink(join(root, 'discount.mjs'), join(session, 'report.md'));
  invoke(['report', '--session', session], 3);
  assert.match(await readFile(join(root, 'discount.mjs'), 'utf8'), /discount \|\|/);
  invoke(['init', '--mode', 'bogus', '--summary', 'invalid'], 3);
  invoke(['init', '--summary', 'x', '--typo', 'x'], 3);
  invoke(['note', '--session', session, '--kind', 'fact', '--text', 'unsupported'], 3);
  invoke(['note', '--session', session, '--kind', 'fact', '--text', 'unknown', '--evidence', 'c999'], 3);
});

test('text reports redact secrets before writing attachments, logs, and reports', async t => {
  const root = await fixture(t), session = start(root);
  const file = join(root, '.repfix', 'stack.txt');
  await writeFile(file, 'Error: API_KEY=very-private-key\nAuthorization: Bearer private-token-value\n');
  const artifact = JSON.parse(invoke(['attach', '--session', session, '--file', file]));
  const saved = await readFile(join(session, artifact.file), 'utf8');
  assert.ok(!saved.includes('very-private-key')); assert.ok(!saved.includes('private-token-value'));
  assert.match(saved, /REDACTED/);
});

test('read-only mode catches a command that mutates project files', async t => {
  const root = await fixture(t), session = start(root, ['--mode', 'verify-only']);
  command(session, 'verify', 0, ['-e', 'require("fs").writeFileSync("changed.txt", "mutation")']);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 1)).status, 'FAILED');
  assert.equal(await readFile(join(root, 'changed.txt'), 'utf8'), 'mutation');
});

test('symlink evidence directory cannot redirect writes outside a project', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(root, '.repfix'));
  invoke(['init', '--project', root, '--summary', 'unsafe'], 3);
});

test('oracle symlinks pin the actual assertion content, including ./ paths', async t => {
  const root = await fixture(t);
  await symlink('discount.test.mjs', join(root, 'alias.mjs'));
  const session = invoke(['init', '--project', root, '--summary', 'Oracle canonicalization', '--oracle', './alias.mjs']);
  assert.deepEqual((await manifest(session)).oracles, ['discount.test.mjs']);
});

test('post-command snapshot failure preserves logs and produces a BLOCKED report', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'verify', 3, ['-e', 'console.log("before oversized output"); const fs=require("fs"); const fd=fs.openSync("large.bin", "w"); fs.ftruncateSync(fd, 33554433); fs.closeSync(fd)']);
  const run = await manifest(session);
  assert.match(await readFile(join(session, 'a2.log'), 'utf8'), /before oversized output/);
  assert.match(run.commands[0].error, /Post-command snapshot failed/);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 3)).status, 'BLOCKED');
  assert.match(await readFile(join(session, 'report.md'), 'utf8'), /changes could not be assessed/);
});
