import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture, invoke, repo } from './helpers.mjs';

test('real Chromium interaction: failure + screenshot/trace → fix → identical scenario → VERIFIED', async t => {
  const root = await fixture(t, 'browser');
  await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const session = invoke(['init', '--project', root, '--summary', 'Browser applies 10% when discount is zero', '--oracle', 'repro.mjs', '--regression', 'browser']);
  const run = (phase, name, code) => JSON.parse(invoke(['run', '--session', session, '--phase', phase, '--name', name, '--context', 'chromium;1280x720;synthetic-static-fixture', '--', process.execPath, 'repro.mjs'], code));
  const reproduction = run('reproduce', 'zero-discount', 1);
  assert.equal(reproduction.id, 'c1');
  assert.match(await readFile(join(session, reproduction.log), 'utf8'), /An explicit zero discount must preserve the price/);
  const before = JSON.parse(invoke(['attach', '--session', session, '--file', join(root, '.repfix/browser-output/total.png'), '--reviewed']));
  invoke(['attach', '--session', session, '--file', join(root, '.repfix/browser-output/trace.zip'), '--reviewed']);
  invoke(['confirm', '--session', session, '--command', 'c1', '--reason', 'The clicked zero-discount scenario asserts $100 but receives $90']);
  invoke(['note', '--session', session, '--kind', 'root-cause', '--evidence', 'c1', '--evidence', before.id, '--text', 'index.html uses || 0.1, replacing numeric zero with the default']);
  const file = join(root, 'index.html');
  await writeFile(file, (await readFile(file, 'utf8')).replace(') || 0.1', ') ?? 0.1'));
  run('verify', 'zero-discount', 0);
  invoke(['note', '--session', session, '--kind', 'fix', '--evidence', 'c2', '--text', 'Replaced || with ?? in index.html so numeric zero is preserved']);
  invoke(['attach', '--session', session, '--file', join(root, '.repfix/browser-output/total.png'), '--reviewed']);
  invoke(['attach', '--session', session, '--file', join(root, '.repfix/browser-output/trace.zip'), '--reviewed']);
  // A separate regression checks nonzero input, using a script saved outside project fingerprints.
  const regression = (await readFile(join(root, 'repro.mjs'), 'utf8')).replace("fill('0')", "fill('0.2')").replace("assert.equal(total, '$100'", "assert.equal(total, '$80'").replace('PASS: zero discount preserves $100', 'PASS: positive discount produces $80');
  await writeFile(join(root, '.repfix/positive.mjs'), regression);
  invoke(['run', '--session', session, '--phase', 'regression', '--name', 'browser', '--', process.execPath, '.repfix/positive.mjs']);
  const result = JSON.parse(invoke(['report', '--session', session]));
  assert.equal(result.status, 'VERIFIED');
  assert.deepEqual(result.changedFiles, ['index.html']);
  // Optional export for a human-reviewable evidence bundle, outside normal source files.
  if (process.env.REPFIX_E2E_EXPORT) {
    const target = resolve(process.env.REPFIX_E2E_EXPORT);
    await mkdir(target, { recursive: true });
    await cp(session, join(target, 'browser-session'), { recursive: true, force: false });
    await cp(join(root, 'index.html'), join(target, 'fixed-index.html'), { force: false });
  }
});
