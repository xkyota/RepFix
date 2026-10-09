import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

export const repo = resolve(import.meta.dirname, '..');
export const cli = join(repo, 'skills/repfix/scripts/cli.js');
export async function fixture(t, kind = 'node') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'repfix-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(repo, 'examples', kind), root, { recursive: true });
  return root;
}
export function invoke(args, expected = 0, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, ...options });
  assert.equal(result.status, expected, `Command ${args[0]}: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
export const manifest = async dir => JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'));
export function start(root, extra = []) {
  return invoke(['init', '--project', root, '--summary', 'Zero discount produces 90 instead of 100', '--oracle', 'discount.test.mjs', '--regression', 'unit', ...extra]);
}
export function command(session, phase, expected = 0, args = ['--test', 'discount.test.mjs'], name = 'original', extra = []) {
  const output = invoke(['run', '--session', session, '--phase', phase, '--name', name, ...extra, '--', process.execPath, ...args], expected);
  return output ? JSON.parse(output) : undefined;
}
export function confirm(session, id = 'c1') {
  invoke(['confirm', '--session', session, '--command', id, '--reason', 'The zero-discount assertion expected 100 and received 90']);
}
export function cause(session) {
  invoke(['note', '--session', session, '--kind', 'root-cause', '--evidence', 'c1', '--text', 'discount.mjs:2 replaces a valid zero with the fallback through ||']);
}
export async function fix(root) {
  const path = join(root, 'discount.mjs');
  await writeFile(path, (await readFile(path, 'utf8')).replace('discount ||', 'discount ??'));
}
export async function complete(root, session) {
  command(session, 'reproduce', 1);
  confirm(session); cause(session);
  await fix(root);
  command(session, 'verify');
  invoke(['note', '--session', session, '--kind', 'fix', '--evidence', 'c2', '--text', 'Use ?? instead of || to preserve an explicit zero discount']);
  command(session, 'regression', 0, ['--test', 'discount.test.mjs', 'default.test.mjs'], 'unit');
}
