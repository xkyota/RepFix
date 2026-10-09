import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detect } from '../skills/repfix/scripts/detect.js';
import { approveCommand, evidenceIssue } from '../skills/repfix/scripts/safety.js';
import { fixture, invoke, start, manifest } from './helpers.mjs';

test('detect identifies TypeScript, React/Next, Vitest and package manager without executing scripts', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'touch DETECTION_MUST_NOT_RUN' }, dependencies: { next: '*', react: '*' }, devDependencies: { typescript: '*', vitest: '*' } }));
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const d = JSON.parse(invoke(['detect', '--project', root]));
  assert.ok(d.languages.includes('TypeScript'));
  assert.deepEqual(d.frameworks, ['Next.js', 'React']);
  assert.ok(d.testRunners.includes('vitest'));
  assert.deepEqual(d.candidates[0].argv, ['pnpm', 'test']);
  await assert.rejects(readFile(join(root, 'DETECTION_MUST_NOT_RUN')));
  const session = start(root);
  assert.deepEqual((await manifest(session)).detection.testRunners, d.testRunners);
});

test('detect reads Python/Go/Rust metadata and reports mixed projects', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'pyproject.toml'), '[project]\ndependencies = ["fastapi", "pytest"]\n');
  await writeFile(join(root, 'go.mod'), 'module example.test/demo\ngo 1.22\n');
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n');
  const d = await detect(root);
  assert.deepEqual(d.languages, ['Go', 'JavaScript', 'Python', 'Rust']);
  assert.deepEqual(d.testRunners, ['cargo test', 'go test', 'node:test', 'pytest']);
  assert.ok(d.frameworks.includes('FastAPI'));
});

test('unknown projects, invalid manifests, and monorepos get actionable warnings', async t => {
  const parent = await fixture(t), root = join(parent, 'empty');
  await mkdir(root);
  assert.equal((await detect(root)).status, 'unsupported');
  await writeFile(join(root, 'package.json'), '{broken');
  assert.match((await detect(root)).warnings.join(' '), /invalid/);
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested/package.json'), '{}');
  assert.match((await detect(root)).warnings.join(' '), /affected package/);
  await assert.rejects(detect(join(root, 'missing')));
});

test('detector skips dependency trees and symlinked manifests', async t => {
  const parent = await fixture(t), root = join(parent, 'clean');
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await writeFile(join(root, 'node_modules/ignored.rs'), '');
  await symlink(join(parent, 'discount.mjs'), join(root, 'package.json'));
  const d = await detect(root);
  assert.equal(d.status, 'unsupported');
  assert.deepEqual(d.languages, []);
});

test('discovery bounds reads and warns when a reused file list is truncated', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), ' '.repeat(256 * 1024 + 1));
  const d = await detect(root);
  assert.match(d.warnings.join(' '), /Cannot safely read package.json/);
  assert.equal(d.status, 'incomplete');
  const limited = await detect(root, Array.from({ length: 2001 }, (_, i) => `source-${i}.js`));
  assert.match(limited.warnings.join(' '), /2,000 files/);
  const unsafe = await detect(root, ['../outside.test.js']);
  assert.match(unsafe.warnings.join(' '), /Cannot safely read/);
});

test('execution gate rejects direct destructive commands, shells and dependency setup', () => {
  for (const argv of [['rm', '-rf', '.'], ['git', '-C', '.', 'reset', '--hard'], ['bash', '-c', 'true'], ['npm', 'ci'], ['pip3', 'install', 'foo'], ['python3', '-m', 'pip', 'install', 'foo'], ['npx', 'vitest']]) {
    assert.throws(() => approveCommand(argv, 'approved'), /not accepted|Dependency setup/);
  }
  assert.throws(() => approveCommand(['node', '--test'], ''), /requires --approval/);
  assert.equal(approveCommand(['node', '--test'], 'Reviewed tests; user authorized them'), 'Reviewed tests; user authorized them');
});

test('empty and all-skipped runner summaries are not positive evidence', () => {
  for (const output of ['', '# tests 0\n# pass 0\n# fail 0\n', 'ℹ tests 3\nℹ pass 0\nℹ fail 0\nℹ skipped 3\n', 'Ran 0 tests in 0.000s\nOK', 'Ran 2 tests in 0.001s\nOK (skipped=2)', 'no tests ran in 0.1s', 'No tests found, exiting with code 0']) {
    assert.ok(evidenceIssue(output), output);
  }
  assert.equal(evidenceIssue('# tests 1\n# pass 1\n# fail 0\n'), undefined);
  assert.equal(evidenceIssue('Ran 2 tests in 0.01s\nOK'), undefined);
  assert.equal(evidenceIssue('PASS: explicit assertion reached'), undefined);
});
