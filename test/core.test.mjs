import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assess } from '../skills/repfix/scripts/report.js';
import { execute } from '../skills/repfix/scripts/runner.js';
import { cleanArgs, inside, redact } from '../skills/repfix/scripts/safety.js';
import { fixture } from './helpers.mjs';

function state() {
  const c = { name: 'original', argv: ['node', '--test', 'bug.test.mjs'], cwd: '.', fingerprint: 'same', startedAt: '2026-01-01', durationMs: 1, exitCode: 0, signal: null, timedOut: false, truncated: false, interrupted: false, before: 'fixed', after: 'fixed', oracles: { 'bug.test.mjs': 'same-test' }, log: 'a1' };
  return {
    version: 1, mode: 'auto', baseline: { files: { 'app.mjs': 'bug' }, digest: 'bug', git: false },
    oracles: ['bug.test.mjs'], regressions: ['unit'],
    commands: [
      { ...c, id: 'c1', phase: 'reproduce', before: 'bug', after: 'bug', exitCode: 1 },
      { ...c, id: 'c2', phase: 'verify' }, { ...c, id: 'c3', phase: 'regression', name: 'unit' },
    ], notes: [{ kind: 'root-cause', text: 'causal finding', evidence: ['c1'] }], artifacts: [], confirmations: [{ command: 'c1', reason: 'assertion matches the bug' }],
  };
}
const current = { files: { 'app.mjs': 'fix' }, digest: 'fixed', git: false };
const cases = [
  ['complete evidence', () => {}, 'VERIFIED'],
  ['unconfirmed failure', r => r.confirmations = [], 'PARTIALLY_VERIFIED'],
  ['no original failure', r => r.commands.shift(), 'PARTIALLY_VERIFIED'],
  ['flaky pass without a project fix', r => { r.commands[0].before = 'fixed'; r.commands[0].after = 'fixed'; }, 'PARTIALLY_VERIFIED'],
  ['passing original is not a failure', r => r.commands[0].exitCode = 0, 'PARTIALLY_VERIFIED'],
  ['failure recorded after verification', r => [r.commands[0], r.commands[1]] = [r.commands[1], r.commands[0]], 'PARTIALLY_VERIFIED'],
  ['no oracle', r => r.oracles = [], 'PARTIALLY_VERIFIED'],
  ['missing oracle', r => r.commands[0].oracles = { 'bug.test.mjs': 'MISSING' }, 'PARTIALLY_VERIFIED'],
  ['changed oracle', r => r.commands[1].oracles = { 'bug.test.mjs': 'weakened' }, 'PARTIALLY_VERIFIED'],
  ['no causal evidence', r => r.notes = [], 'PARTIALLY_VERIFIED'],
  ['no regression plan', r => r.regressions = [], 'PARTIALLY_VERIFIED'],
  ['missing declared regression', r => r.regressions.push('integration'), 'PARTIALLY_VERIFIED'],
  ['regression before verification', r => [r.commands[1], r.commands[2]] = [r.commands[2], r.commands[1]], 'PARTIALLY_VERIFIED'],
  ['stale regression', r => r.commands[2].after = 'old', 'PARTIALLY_VERIFIED'],
  ['truncated verification', r => r.commands[1].truncated = true, 'UNVERIFIED'],
  ['truncated reproduction', r => r.commands[0].truncated = true, 'PARTIALLY_VERIFIED'],
  ['verification changed source', r => r.commands[1].before = 'old', 'UNVERIFIED'],
  ['failed regression', r => r.commands[2].exitCode = 1, 'FAILED'],
  ['timed-out verification', r => { r.commands[1].timedOut = true; r.commands[1].exitCode = null; }, 'BLOCKED'],
  ['missing executable', r => r.commands[1].error = 'ENOENT', 'BLOCKED'],
  ['interrupted verification', r => r.commands[1].interrupted = true, 'BLOCKED'],
  ['unresolved limitation', r => r.notes.push({ kind: 'limitation', text: 'external service unavailable', evidence: [] }), 'PARTIALLY_VERIFIED'],
  ['no verification', r => r.commands = [r.commands[0]], 'UNVERIFIED'],
];
for (const [name, change, status] of cases) test(`status: ${name}`, () => {
  const run = state(); change(run); assert.equal(assess(run, current).status, status);
});

test('evidence integrity and explicit blocker override passing checks', () => {
  assert.equal(assess(state(), current, ['a1 missing']).status, 'BLOCKED');
  assert.equal(assess(state(), current, [], 'Permission unavailable').status, 'BLOCKED');
});
test('redaction handles common credentials and separate argument values', () => {
  const values = ['Bearer abc123secret', 'Basic Zm9vOmJhcg==', 'password="hello world"', 'API_KEY=abc123secret', 'https://user:password@example.test', 'ghp_abcdefghijklmnop', 'sk-abcdefghijklmnop', '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'];
  for (const value of values) assert.ok(redact(value, {}).includes('[REDACTED'), value);
  assert.equal(redact('a secret-value b', { CUSTOM_SECRET: 'secret-value' }), 'a [REDACTED] b');
  assert.deepEqual(cleanArgs(['app', '--api-key', 'not-in-env', '--password=value']), ['app', '--api-key', '[REDACTED]', '--password=[REDACTED]']);
});
test('path confinement rejects both traversal and absolute escapes', () => {
  assert.throws(() => inside('/repo', '../secrets'));
  assert.throws(() => inside('/repo', '/outside'));
  assert.equal(inside('/repo', 'a/../safe'), '/repo/safe');
});
test('runner treats shell metacharacters as literal arguments', async t => {
  const root = await fixture(t);
  const result = await execute([process.execPath, '-e', 'console.log(process.argv[1])', '$(echo unsafe); > stolen.txt'], root, 5000);
  assert.equal(result.exitCode, 0); assert.match(result.output, /\$\(echo unsafe\)/);
  await assert.rejects(readFile(join(root, 'stolen.txt')));
});
test('runner redacts a secret split across stdout chunks', async t => {
  const root = await fixture(t);
  const result = await execute([process.execPath, '-e', 'process.stdout.write("Bearer "); setTimeout(()=>process.stdout.write("sensitive-value"), 20)'], root, 5000);
  assert.match(result.output, /REDACTED/); assert.ok(!result.output.includes('sensitive-value'));
});
test('runner bounds noisy output and records truncation', async t => {
  const root = await fixture(t);
  const result = await execute([process.execPath, '-e', 'console.log("x".repeat(10000))'], root, 5000, 256);
  assert.equal(result.truncated, true); assert.ok(result.output.length < 300);
});
test('nested node:test runs actually execute and fail under a parent test harness', async t => {
  const root = await fixture(t);
  const result = await execute([process.execPath, '--test', 'discount.test.mjs'], root, 5000);
  assert.equal(result.exitCode, 1); assert.match(result.output, /zero discount/);
  assert.ok(!result.output.includes('skipping running files'));
});
test('timeout terminates a command process group', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'child.mjs'), 'import {writeFileSync} from "node:fs"; setTimeout(()=>writeFileSync("leak.txt", "leaked"), 700);');
  const result = await execute([process.execPath, '-e', 'require("child_process").spawn(process.execPath,["child.mjs"], {stdio:"inherit"}); setInterval(()=>{},1000)'], root, 100);
  assert.equal(result.timedOut, true);
  await new Promise(resolve => setTimeout(resolve, 850));
  await assert.rejects(readFile(join(root, 'leak.txt')));
});
