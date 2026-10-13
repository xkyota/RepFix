#!/usr/bin/env node
// Controlled recorder comparison. The fixes and independent checks are fixed
// fixtures, so this measures CLI workflow overhead rather than agent quality.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = resolve(import.meta.dirname, '..');
const node = process.execPath;
const [baselineCli, candidateCli, outputFile] = process.argv.slice(2);
if (!baselineCli || !candidateCli) throw new Error('Usage: node scripts/benchmark-adaptive.mjs BASELINE_CLI CANDIDATE_CLI [OUTPUT_JSON]');

const runProcess = (argv, cwd) => spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout: 120_000 });
const write = (root, path, content) => writeFile(join(root, path), content);
const patch = async (root, path, from, to) => write(root, path, (await readFile(join(root, path), 'utf8')).replace(from, to));
const copied = async (root, path) => cp(join(repo, path), root, { recursive: true });
const nodeTest = (...files) => [node, '--test', ...files];

const scenarios = [
  {
    name: 'trivial-javascript', summary: 'A zero discount changes a single isolated JavaScript price calculation', oracle: 'discount.test.mjs',
    setup: root => copied(root, 'examples/node'), red: nodeTest('discount.test.mjs'), regression: nodeTest('discount.test.mjs', 'default.test.mjs'),
    fix: root => patch(root, 'discount.mjs', 'discount ||', 'discount ??'), independent: [nodeTest('discount.test.mjs', 'default.test.mjs')],
  },
  {
    name: 'isolated-python', summary: 'A new Python cart incorrectly inherits an earlier customer item', oracle: 'test_regression.py',
    setup: root => copied(root, 'test/fixtures/python-cart'), red: ['python3', '-B', '-m', 'unittest', 'test_regression'], regression: ['python3', '-B', '-m', 'unittest', 'discover'],
    fix: async root => { await patch(root, 'cart.py', 'cart=[]', 'cart=None'); await patch(root, 'cart.py', '    cart.append', '    if cart is None:\n        cart = []\n    cart.append'); },
    independent: [['python3', '-B', '-m', 'unittest', 'discover']],
  },
  {
    name: 'multi-file-regression', summary: 'Two price components independently mishandle a zero discount', oracle: 'price.test.mjs',
    setup: async root => {
      for (const name of ['a', 'b']) await write(root, `${name}.mjs`, `export const price = (total, discount) => total * (1 - (discount || 0.1));\n`);
      await write(root, 'price.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { price as a } from './a.mjs'; import { price as b } from './b.mjs'; test('a preserves zero', () => assert.equal(a(100, 0), 100)); test('b preserves zero', () => assert.equal(b(100, 0), 100));\n`);
      await write(root, 'existing.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { price as a } from './a.mjs'; import { price as b } from './b.mjs'; test('defaults', () => { assert.equal(a(100), 90); assert.equal(b(100), 90); });\n`);
    }, red: nodeTest('price.test.mjs'), regression: nodeTest('price.test.mjs', 'existing.test.mjs'),
    fix: async root => { for (const name of ['a', 'b']) await patch(root, `${name}.mjs`, 'discount ||', 'discount ??'); },
    independent: [nodeTest('price.test.mjs', 'existing.test.mjs')],
  },
  {
    name: 'browser-interaction', summary: 'Browser Apply button gives the wrong price for a zero discount', oracle: 'repro.mjs',
    setup: async root => {
      await copied(root, 'examples/browser');
      await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
      const positive = (await readFile(join(root, 'repro.mjs'), 'utf8')).replace("fill('0')", "fill('0.2')").replace("assert.equal(total, '$100'", "assert.equal(total, '$80'").replace('PASS: zero discount preserves $100', 'PASS: positive discount produces $80');
      await write(root, 'positive.mjs', positive);
    }, red: [node, 'repro.mjs'], regression: [node, 'positive.mjs'],
    fix: root => patch(root, 'index.html', ') || 0.1', ') ?? 0.1'), independent: [[node, 'repro.mjs'], [node, 'positive.mjs']],
    context: 'chromium;1280x720;synthetic-static-fixture', browser: true,
  },
  {
    name: 'missing-dependencies', summary: 'A private dependency is unavailable in the local environment', oracle: 'repro.mjs',
    setup: root => copied(root, 'test/fixtures/missing-dependency'), red: [node, 'repro.mjs'], expected: 'BLOCKED',
    independent: [[node, 'repro.mjs']],
  },
  {
    name: 'flaky-tests', summary: 'An intermittent test alternates outcomes on unchanged source', oracle: 'flaky.test.mjs', expected: 'UNVERIFIED',
    setup: root => write(root, 'flaky.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; const file='.repfix/attempt'; let n=0; try { n=Number(fs.readFileSync(file,'utf8')); } catch {} fs.writeFileSync(file,String(n+1)); test('unstable', () => assert.equal(n % 2, 1));\n`),
    red: nodeTest('flaky.test.mjs'), independent: [nodeTest('flaky.test.mjs'), nodeTest('flaky.test.mjs')],
  },
  {
    name: 'security-sensitive', summary: 'Security authentication bug allows an untrusted token into a protected route', oracle: 'auth.test.mjs',
    setup: async root => {
      await write(root, 'auth.mjs', `export const allowed = token => Boolean(token);\n`);
      await write(root, 'auth.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { allowed } from './auth.mjs'; test('rejects attacker', () => assert.equal(allowed('attacker'), false)); test('accepts trusted', () => assert.equal(allowed('trusted'), true));\n`);
      await write(root, 'existing.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { allowed } from './auth.mjs'; test('anonymous denied', () => assert.equal(allowed(''), false));\n`);
    }, red: nodeTest('auth.test.mjs'), regression: nodeTest('auth.test.mjs', 'existing.test.mjs'),
    fix: root => patch(root, 'auth.mjs', 'Boolean(token)', "token === 'trusted'"), independent: [nodeTest('auth.test.mjs', 'existing.test.mjs')],
  },
  {
    name: 'monorepo', summary: 'Monorepo shared package price helper breaks the application zero-discount path', oracle: 'packages/app/price.test.mjs',
    setup: async root => {
      await mkdir(join(root, 'packages/lib'), { recursive: true }); await mkdir(join(root, 'packages/app'), { recursive: true });
      await write(root, 'packages/lib/package.json', '{"type":"module"}\n'); await write(root, 'packages/app/package.json', '{"type":"module"}\n');
      await write(root, 'packages/lib/index.mjs', `export const price = (total, discount) => total * (1 - (discount || 0.1));\n`);
      await write(root, 'packages/app/price.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { price } from '../lib/index.mjs'; test('zero preserved', () => assert.equal(price(100,0),100));\n`);
      await write(root, 'packages/app/existing.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { price } from '../lib/index.mjs'; test('default', () => assert.equal(price(100),90));\n`);
    }, red: nodeTest('packages/app/price.test.mjs'), regression: nodeTest('packages/app/price.test.mjs', 'packages/app/existing.test.mjs'),
    fix: root => patch(root, 'packages/lib/index.mjs', 'discount ||', 'discount ??'),
    independent: [nodeTest('packages/app/price.test.mjs', 'packages/app/existing.test.mjs')],
  },
];

async function executeScenario(scenario, cli, variant) {
  const root = await mkdtemp(join(tmpdir(), 'repfix-benchmark-'));
  let calls = 0;
  const invoke = (args, expected) => {
    calls++;
    const result = runProcess([node, cli, ...args], root);
    assert.equal(result.status, expected, `${scenario.name}: ${args[0]}: ${result.stderr}\n${result.stdout}`);
    return result.stdout.trim();
  };
  const run = (session, phase, name, argv, expected) => JSON.parse(invoke(['run', '--session', session, '--phase', phase, '--name', name,
    '--approval', 'Reviewed deterministic local benchmark fixture; test execution authorized', ...(scenario.context ? ['--context', scenario.context] : []), '--', ...argv], expected));
  try {
    await scenario.setup(root);
    const oracleBefore = await readFile(join(root, scenario.oracle));
    const started = performance.now();
    const session = invoke(['init', '--project', root, '--summary', scenario.summary, '--oracle', scenario.oracle,
      ...(scenario.expected ? [] : ['--regression', 'relevant'])], 0);
    const red = run(session, 'reproduce', 'original', scenario.red, 1);
    if (scenario.name === 'flaky-tests') run(session, 'reproduce', 'original', scenario.red, 0);
    if (!scenario.expected) {
      invoke(['confirm', '--session', session, '--command', red.id, '--reason', 'The pinned assertion fails on the reported original scenario',
        ...(variant === 'candidate' ? ['--cause', 'The source uses an incorrect conditional'] : [])], 0);
      if (variant === 'baseline') invoke(['note', '--session', session, '--kind', 'root-cause', '--evidence', red.id, '--text', 'The source uses an incorrect conditional'], 0);
      await scenario.fix(root);
      run(session, 'verify', 'original', scenario.red, 0);
      invoke(['note', '--session', session, '--kind', 'fix', '--evidence', 'c2', '--text', 'Changed the demonstrated source condition'], 0);
      run(session, 'regression', 'relevant', scenario.regression, 0);
    }
    const exit = scenario.expected === 'BLOCKED' ? 3 : scenario.expected === 'UNVERIFIED' ? 2 : 0;
    const report = JSON.parse(invoke(['report', '--session', session, ...(scenario.expected === 'BLOCKED' ? ['--blocked', 'Private dependency unavailable'] : [])], exit));
    const durationMs = Math.round(performance.now() - started);
    const oracleUnchanged = (await readFile(join(root, scenario.oracle))).equals(oracleBefore);
    const independentExits = scenario.independent.map(argv => runProcess(argv, root).status);
    const independentCorrect = scenario.name === 'missing-dependencies' ? independentExits[0] !== 0
      : scenario.name === 'flaky-tests' ? independentExits[0] !== independentExits[1]
        : independentExits.every(code => code === 0);
    return { scenario: scenario.name, expectedStatus: scenario.expected ?? 'VERIFIED', status: report.status,
      profile: report.profile ?? null, validFix: scenario.expected ? null : report.status === 'VERIFIED' && oracleUnchanged && independentCorrect,
      falseVerified: report.status === 'VERIFIED' && (scenario.expected || !oracleUnchanged || !independentCorrect),
      independentCorrect, oracleUnchanged, durationMs, toolCalls: calls, tokenUsage: null };
  } finally { await rm(root, { recursive: true, force: true }); }
}

const results = { baseline: [], candidate: [] };
for (const [index, scenario] of scenarios.entries()) {
  const order = index % 2 ? [['candidate', candidateCli], ['baseline', baselineCli]] : [['baseline', baselineCli], ['candidate', candidateCli]];
  for (const [variant, path] of order) {
    const result = await executeScenario(scenario, resolve(path), variant);
    results[variant].push(result);
    process.stderr.write(`${variant} ${scenario.name}: ${result.status}, ${result.durationMs}ms, ${result.toolCalls} calls\n`);
  }
}
const median = values => { const sorted = [...values].sort((a, b) => a - b); return (sorted[3] + sorted[4]) / 2; };
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const summarize = rows => ({ validFixRate: `${rows.filter(r => r.validFix).length}/${rows.filter(r => r.validFix !== null).length}`,
  falseVerifiedClaims: rows.filter(r => r.falseVerified).length, medianMs: median(rows.map(r => r.durationMs)),
  p95Ms: p95(rows.map(r => r.durationMs)), toolCalls: rows.reduce((sum, r) => sum + r.toolCalls, 0),
  failedRuns: rows.filter(r => r.status === 'FAILED').length, blockedRuns: rows.filter(r => r.status === 'BLOCKED').length,
  tokenUsage: null });
const output = { methodology: 'One controlled fixture run per scenario and variant; fixed edits and independent post-report checks. Candidate combines confirmation and root-cause note in one compatible call. This measures recorder workflow overhead, not autonomous agent fix quality. CLI invocations count as tool calls; model tokens unavailable.',
  node: process.version, platform: process.platform, baseline: summarize(results.baseline), candidate: summarize(results.candidate), runs: results };
if (outputFile) await writeFile(resolve(outputFile), `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
