import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, invoke, start, command, complete, manifest } from './helpers.mjs';

test('deterministic profile selection is separate from execution mode', async t => {
  const root = await fixture(t);
  const fast = start(root);
  const ordinary = invoke(['init', '--project', root, '--summary', 'Browser interaction changes the visible price', '--oracle', 'discount.test.mjs', '--regression', 'unit', '--mode', 'verify-only']);
  const deep = invoke(['init', '--project', root, '--summary', 'Security authentication regression across multiple services', '--oracle', 'discount.test.mjs', '--regression', 'unit']);
  assert.equal((await manifest(fast)).classification.selected, 'FAST');
  assert.equal((await manifest(ordinary)).classification.selected, 'STANDARD');
  assert.equal((await manifest(ordinary)).mode, 'verify-only');
  assert.equal((await manifest(deep)).classification.selected, 'DEEP');
  assert.ok((await manifest(deep)).classification.reasons.some(r => r.startsWith('risk:')));
});

test('confirm can record an evidence-linked cause in the same call', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1);
  const result = JSON.parse(invoke(['confirm', '--session', session, '--command', 'c1', '--reason', 'The zero discount assertion received 90', '--cause', 'The source replaces zero with a default through ||']));
  assert.equal(result.rootCauseNote, 1);
  assert.deepEqual((await manifest(session)).notes[0], { kind: 'root-cause', text: 'The source replaces zero with a default through ||', evidence: ['c1'] });
});

test('ambiguous reproduction and unexpected checks escalate without weakening VERIFIED', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 0, ['-e', 'console.log("smoke")']);
  let run = await manifest(session);
  assert.equal(run.classification.current, 'STANDARD');
  assert.equal(run.classification.escalations[0].event, 'ambiguous-reproduction');
  command(session, 'verify', 1);
  run = await manifest(session);
  assert.equal(run.classification.current, 'DEEP');
  assert.ok(run.classification.escalations.some(e => e.event === 'unexpected-test-failure'));
  const result = JSON.parse(invoke(['report', '--session', session], 1));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.telemetry.toolExecutionCount, 2);
  assert.ok(result.telemetry.totalDurationMs >= result.telemetry.phaseDurationsMs.reproduce);
});

test('flaky command outcomes on the same source state escalate to DEEP', async t => {
  const root = await fixture(t), session = start(root);
  const script = 'const fs=require("fs"); const f=".repfix/counter"; let n=0; try { n=Number(fs.readFileSync(f,"utf8")); } catch {} fs.writeFileSync(f,String(n+1)); console.log("attempt",n+1); process.exitCode=n?1:0';
  command(session, 'reproduce', 0, ['-e', script], 'flaky');
  command(session, 'reproduce', 1, ['-e', script], 'flaky');
  const state = (await manifest(session)).classification;
  assert.equal(state.current, 'DEEP');
  assert.ok(state.escalations.some(e => e.event === 'unstable-tests'));
  assert.equal(JSON.parse(invoke(['report', '--session', session], 2)).status, 'UNVERIFIED');
});

test('new component or security discovery requires regressions after escalation', async t => {
  const root = await fixture(t), session = start(root);
  await complete(root, session);
  assert.equal(JSON.parse(invoke(['report', '--session', session])).status, 'VERIFIED');
  invoke(['signal', '--session', session, '--event', 'security-or-data-integrity', '--reason', 'Review identified a sensitive price authorization boundary']);
  const held = JSON.parse(invoke(['report', '--session', session], 2));
  assert.equal(held.status, 'PARTIALLY_VERIFIED');
  assert.equal(held.profile, 'DEEP');
  assert.match(held.reasons.join(' '), /Regression unit/);
  command(session, 'regression', 0, ['--test', 'discount.test.mjs', 'default.test.mjs'], 'unit');
  assert.equal(JSON.parse(invoke(['report', '--session', session])).status, 'VERIFIED');
});

test('DEEP profile still rejects changed test oracles', async t => {
  const root = await fixture(t);
  const session = invoke(['init', '--project', root, '--summary', 'Security-sensitive price authorization across shared components', '--oracle', 'discount.test.mjs', '--regression', 'unit']);
  command(session, 'reproduce', 1);
  invoke(['confirm', '--session', session, '--command', 'c1', '--reason', 'The zero-discount assertion fails', '--cause', 'The source replaces zero with a default through ||']);
  const oracle = join(root, 'discount.test.mjs');
  await writeFile(oracle, (await readFile(oracle, 'utf8')).replace('), 100)', '), 90)'));
  command(session, 'verify');
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'unit');
  assert.equal((await manifest(session)).classification.current, 'DEEP');
  const report = JSON.parse(invoke(['report', '--session', session], 2));
  assert.equal(report.status, 'PARTIALLY_VERIFIED');
  assert.match(report.reasons.join(' '), /assertion files.*changed/);
});

test('changed source scope escalates automatically and old run manifests remain readable', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1);
  await writeFile(join(root, 'extra.mjs'), 'export const value = 1;\n');
  await writeFile(join(root, 'discount.mjs'), (await readFile(join(root, 'discount.mjs'), 'utf8')).replace('discount ||', 'discount ??'));
  command(session, 'verify');
  assert.ok((await manifest(session)).classification.escalations.some(e => e.event === 'additional-components'));
  const path = join(session, 'run.json');
  const old = await manifest(session);
  delete old.classification;
  await writeFile(path, JSON.stringify(old));
  assert.equal(JSON.parse(invoke(['report', '--session', session], 2)).profile, 'FAST');
});

test('missing dependency is blocked automatically and its failure cannot be confirmed', async t => {
  const root = await fixture(t), session = start(root);
  const failed = command(session, 'reproduce', 1, ['-e', 'require("repfix-absent-private-module")'], 'dependency');
  assert.match(failed.evidenceIssue, /required module is unavailable/);
  invoke(['confirm', '--session', session, '--command', failed.id, '--reason', 'not the bug'], 3);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 3)).status, 'BLOCKED');
});
