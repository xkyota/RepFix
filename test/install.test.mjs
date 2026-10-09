import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, invoke } from './helpers.mjs';

test('self-contained skill installs and runs from both host directories, including CommonJS projects', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), '{"type":"commonjs"}');
  const result = JSON.parse(invoke(['install', '--target', 'both', '--scope', 'project', '--project', root]));
  assert.equal(result.installed.length, 2);
  for (const host of ['.agents', '.claude']) {
    const dir = join(root, host, 'skills', 'repfix');
    assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /^---\nname: repfix\n/);
    assert.ok((await readFile(join(dir, 'references/commands.md'))).length > 0);
    const check = spawnSync(process.execPath, [join(dir, 'scripts/cli.js'), '--help'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr); assert.match(check.stdout, /RepFix/);
    const run = spawnSync(process.execPath, [join(dir, 'scripts/cli.js'), 'init', '--project', root, '--summary', 'installed CLI works'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  }
});
test('install refuses to overwrite a customized skill or follow symlinks', async t => {
  const root = await fixture(t);
  invoke(['install', '--target', 'codex', '--project', root]);
  const file = join(root, '.agents/skills/repfix/SKILL.md');
  await writeFile(file, 'user-customized skill');
  invoke(['install', '--target', 'both', '--project', root], 3);
  assert.equal(await readFile(file, 'utf8'), 'user-customized skill');
  await mkdir(join(root, 'unsafe'));
  await symlink(join(root, 'unsafe'), join(root, '.claude'));
  invoke(['install', '--target', 'claude', '--project', root], 3);
});
