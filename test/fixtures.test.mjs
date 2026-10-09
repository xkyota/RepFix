import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, invoke, manifest, repo } from './helpers.mjs';

async function bugFixture(t, name) {
  const parent = await fixture(t), root = join(parent, name);
  await mkdir(root);
  await cp(join(repo, 'test/fixtures', name), root, { recursive: true });
  return root;
}
const cases = [
  { name: 'pagination', runner: 'node:test', oracle: 'regression.test.mjs', source: 'paginate.mjs',
    red: [process.execPath, '--test', 'regression.test.mjs'], suite: [process.execPath, '--test', 'existing.test.mjs', 'regression.test.mjs'],
    failure: /full page includes its final item/, cause: 'paginate.mjs:3 subtracts one from the exclusive slice end',
    fix: source => source.replace('start + size - 1', 'start + size') },
  { name: 'python-cart', runner: 'unittest', oracle: 'test_regression.py', source: 'cart.py',
    red: ['python3', '-B', '-m', 'unittest', 'test_regression'], suite: ['python3', '-B', '-m', 'unittest', 'discover'],
    failure: /new_customer_does_not_inherit_previous_cart/, cause: 'cart.py:1 reuses a mutable default list across customers',
    fix: source => source.replace('cart=[]', 'cart=None').replace('    cart.append', '    if cart is None:\n        cart = []\n    cart.append') },
];
for (const c of cases) test(`${c.name}: detect → RED → minimal fix → GREEN → existing tests → VERIFIED`, async t => {
  const root = await bugFixture(t, c.name);
  const d = JSON.parse(invoke(['detect', '--project', root]));
  assert.ok(d.testRunners.includes(c.runner));
  const session = invoke(['init', '--project', root, '--summary', c.name, '--oracle', c.oracle, '--regression', 'existing']);
  const run = (phase, name, argv, exit = 0) => JSON.parse(invoke(['run', '--session', session, '--phase', phase, '--name', name,
    '--approval', 'Reviewed deterministic fixture; repository tests authorized', '--', ...argv], exit));
  const red = run('reproduce', 'bug', c.red, 1);
  assert.match(await readFile(join(session, red.log), 'utf8'), c.failure);
  invoke(['confirm', '--session', session, '--command', red.id, '--reason', c.cause]);
  invoke(['note', '--session', session, '--kind', 'root-cause', '--text', c.cause, '--evidence', red.id]);
  const oracle = await readFile(join(root, c.oracle), 'utf8');
  await writeFile(join(root, c.source), c.fix(await readFile(join(root, c.source), 'utf8')));
  const green = run('verify', 'bug', c.red);
  invoke(['note', '--session', session, '--kind', 'fix', '--text', `Corrected ${c.source}: ${c.cause}`, '--evidence', green.id]);
  run('regression', 'existing', c.suite);
  const report = JSON.parse(invoke(['report', '--session', session]));
  assert.equal(report.status, 'VERIFIED');
  assert.deepEqual(report.changedFiles, [c.source]);
  assert.deepEqual((await manifest(session)).commands.map(c => c.exitCode), [1, 0, 0]);
  assert.equal(await readFile(join(root, c.oracle), 'utf8'), oracle);
});

test('missing private dependency preserves actual evidence and reports BLOCKED, never a fixed bug', async t => {
  const root = await bugFixture(t, 'missing-dependency');
  const session = invoke(['init', '--project', root, '--summary', 'Cannot reproduce without private database client', '--oracle', 'repro.mjs']);
  const red = JSON.parse(invoke(['run', '--session', session, '--phase', 'reproduce', '--name', 'environment',
    '--approval', 'Reviewed fixture attempts to import an unavailable module; tests authorized', '--', process.execPath, 'repro.mjs'], 1));
  assert.match(await readFile(join(session, red.log), 'utf8'), /ERR_MODULE_NOT_FOUND/);
  const report = JSON.parse(invoke(['report', '--session', session, '--blocked', 'Unverified: private database client unavailable; request access and approval before installing it'], 3));
  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(report.changedFiles, []);
  assert.deepEqual((await manifest(session)).confirmations, []);
});
