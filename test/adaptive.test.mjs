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

test('uncertain, Russian, and sensitive-path summaries avoid FAST deterministically', async t => {
  const root = await fixture(t);
  const cases = [
    ['Цена неверна при нулевой скидке', 'STANDARD'],
    ['Ошибка', 'STANDARD'],
    ['Sometimes the price seems wrong after clicking Apply', 'DEEP'],
    ['The price might be incorrect after clicking Apply', 'STANDARD'],
    ['Ошибка авторизации при открытии заказа', 'DEEP'],
  ];
  for (const [summary, expected] of cases) {
    const session = invoke(['init', '--project', root, '--summary', summary, '--oracle', 'discount.test.mjs', '--regression', 'unit']);
    const state = (await manifest(session)).classification;
    assert.equal(state.selected, expected, summary);
    assert.equal(state.selected, state.current);
    assert.ok(state.reasons.length);
    if (expected === 'STANDARD') assert.ok(state.uncertainty.length);
  }
  const sensitive = invoke(['init', '--project', root, '--summary', 'A zero price falls back to the default', '--oracle', 'payments.test.mjs', '--regression', 'unit'], 3);
  assert.equal(sensitive, '');
  await writeFile(join(root, 'payments.test.mjs'), 'export const assertion = true;\n');
  const pathSession = invoke(['init', '--project', root, '--summary', 'A zero price falls back to the default', '--oracle', 'payments.test.mjs', '--regression', 'unit']);
  assert.equal((await manifest(pathSession)).classification.selected, 'DEEP');
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
  assert.equal(result.telemetry.recordedCommandCount, 2);
  assert.equal(result.telemetry.elapsedOutsideRecordedCommandsMs >= 0, true);
  assert.equal(Object.hasOwn(result.telemetry, 'toolExecutionCount'), false);
  assert.equal(Object.hasOwn(result.telemetry.phaseDurationsMs, 'other'), false);
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

test('late plan extension records history and requires each new check after escalation', async t => {
  const root = await fixture(t), session = start(root);
  await complete(root, session);
  invoke(['signal', '--session', session, '--event', 'additional-components', '--reason', 'The default price path also uses this helper']);
  invoke(['plan', '--session', session, '--regression', 'adjacent', '--reason', 'Cover the newly found default price component']);
  const history = (await manifest(session)).regressionPlanHistory;
  assert.deepEqual(history.map(item => [item.action, item.name]), [['initial', 'unit'], ['declare', 'adjacent']]);
  assert.equal(history[1].afterCommand, 3);
  assert.match(history[1].reason, /newly found/);
  assert.equal(JSON.parse(invoke(['report', '--session', session], 2)).status, 'PARTIALLY_VERIFIED');
  command(session, 'regression', 0, ['--test', 'default.test.mjs'], 'adjacent');
  assert.match(JSON.parse(invoke(['report', '--session', session], 2)).reasons.join(' '), /Regression unit/);
  command(session, 'regression', 0, ['--test', 'discount.test.mjs', 'default.test.mjs'], 'unit');
  const report = JSON.parse(invoke(['report', '--session', session]));
  assert.equal(report.status, 'VERIFIED');
  assert.equal((await readFile(join(session, 'report.json'), 'utf8')).includes('newly found default price'), true);
  invoke(['plan', '--session', session, '--regression', 'adjacent', '--reason', 'Duplicate'], 3);
});

test('older manifests without a plan history can extend their plan', async t => {
  const root = await fixture(t), session = start(root);
  const old = await manifest(session);
  delete old.regressionPlanHistory;
  await writeFile(join(session, 'run.json'), JSON.stringify(old));
  invoke(['plan', '--session', session, '--regression', 'adjacent', '--reason', 'Newly discovered component']);
  const updated = await manifest(session);
  assert.deepEqual(updated.regressions, ['unit', 'adjacent']);
  assert.deepEqual(updated.regressionPlanHistory.map(item => item.name), ['adjacent']);
});

test('sensitive source path escalation catches plural and camel-case names', async t => {
  const root = await fixture(t), session = start(root);
  command(session, 'reproduce', 1);
  await writeFile(join(root, 'paymentsHandler.mjs'), 'export const charge = () => false;\n');
  command(session, 'reproduce', 1);
  assert.ok((await manifest(session)).classification.escalations.some(e => e.event === 'security-or-data-integrity'));
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
