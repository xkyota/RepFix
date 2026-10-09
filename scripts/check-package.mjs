import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'repfix-pack-'));
const npm = args => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd: root, encoding: 'utf8', timeout: 120_000,
});
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const result = JSON.parse(npm(['pack', '--json', '--pack-destination', temp]));
  // npm <=11 returns an array; npm 12 keys the result by package name.
  const packed = Array.isArray(result) ? result[0] : result[pkg.name];
  assert.ok(packed, 'npm pack returned no package');
  const files = packed.files.map(file => file.path);
  for (const required of ['package.json', 'LICENSE', 'README.md', 'skills/repfix/SKILL.md',
    'skills/repfix/scripts/cli.js', 'skills/repfix/scripts/package.json', 'skills/repfix/scripts/LICENSE']) {
    assert.ok(files.includes(required), `Missing package file: ${required}`);
  }
  assert.ok(files.every(file => /^(package\.json|LICENSE|README\.md|docs\/design\.md|skills\/repfix\/.+)$/.test(file)), 'Unexpected packaged source, tests or credentials');
  assert.equal(packed.version, pkg.version);
  const tarball = join(temp, packed.filename);
  const consumer = join(temp, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"commonjs"}\n');
  npm(['install', '--prefix', consumer, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-package-lock', tarball]);
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/repfix/package.json'), 'utf8'));
  assert.equal(installed.version, pkg.version);
  assert.equal(Object.keys(installed.dependencies ?? {}).length, 0, 'The CLI must remain dependency-free');
  const bin = join(consumer, 'node_modules/.bin/repfix');
  const run = (executable, args) => execFileSync(executable, args, { cwd: consumer, encoding: 'utf8', timeout: 30_000 }).trim();
  assert.equal(run(bin, ['--version']), pkg.version);
  assert.match(run(bin, ['--help']), /RepFix/);
  run(bin, ['install', '--target', 'both', '--project', consumer]);
  for (const host of ['.agents', '.claude']) {
    assert.equal(run(process.execPath, [join(consumer, host, 'skills/repfix/scripts/cli.js'), '--version']), pkg.version);
  }
  if (process.env.REPFIX_PACK_OUTPUT) {
    const output = resolve(process.env.REPFIX_PACK_OUTPUT);
    await mkdir(output, { recursive: true });
    await copyFile(tarball, join(output, packed.filename));
  }
  console.log(`Verified ${packed.filename}: ${files.length} files, executable npm bin and both standalone installations; ${packed.integrity}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
