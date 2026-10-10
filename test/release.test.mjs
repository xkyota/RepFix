import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReleasePackage } from '../scripts/check-release-package.mjs';
import { releaseMetadata } from '../scripts/verify-release.mjs';

const metadata = (requested = '1.2.3', overrides = {}) => releaseMetadata(
  { name: 'repfix', version: '1.2.3', ...overrides.pkg },
  overrides.lock ?? { version: '1.2.3', packages: { '': { version: '1.2.3' } } },
  overrides.manifest ?? { '.': '1.2.3' },
  overrides.changelog ?? '# Changelog\n\n## [1.2.3](https://example.com/compare) (2026-10-09)\n\n### Bug Fixes\n\n* Correct version\n\n## 1.2.2\n\nOlder notes\n', requested);

test('release metadata uses only the latest matching changelog section', () => {
  assert.deepEqual(metadata(), { version: '1.2.3', tag: 'v1.2.3', filename: 'repfix-1.2.3.tgz', notes: '### Bug Fixes\n\n* Correct version' });
  assert.equal(metadata('1.2.3', { changelog: '## 1.2.3\n\nPlain heading\n' }).notes, 'Plain heading');
});
test('release gate rejects invalid versions, mismatched metadata and stale or empty notes', () => {
  for (const version of ['v1.2.3', '01.2.3', '1.2.3-beta.1', '1.2.3+build', '1.2.3\n', '../1.2.3', '1.2.4']) {
    assert.throws(() => metadata(version));
  }
  for (const overrides of [
    { pkg: { version: '1.2.2' } }, { pkg: { name: 'another-package' } },
    { manifest: { '.': '1.2.2' } },
    { lock: { version: '1.2.3', packages: { '': { version: '1.2.2' } } } },
    { changelog: '## 1.2.4\n\nNewer\n\n## 1.2.3\n\nOlder\n' },
    { changelog: '# Changelog\n' }, { changelog: '## 1.2.3\n\n' },
  ]) assert.throws(() => metadata('1.2.3', overrides));
});

const artifact = { version: '1.2.3', tarball: '/tested/repfix-1.2.3.tgz', integrity: 'sha512-tested-bytes' };
const registryReply = (status, body) => async () => ({
  status, ok: status >= 200 && status < 300, json: async () => body,
});
const published = { name: 'repfix', version: artifact.version, dist: { integrity: artifact.integrity } };

test('an absent npm version dry-runs only the tested archive against the public registry', async () => {
  const calls = [];
  const state = await checkReleasePackage(artifact, {
    registryFetch: async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/repfix/1.2.3');
      assert.equal(options.cache, 'no-store');
      return { status: 404 };
    },
    runNpm: (...args) => calls.push(args),
  });
  assert.equal(state, 'absent');
  assert.deepEqual(calls, [[
    'npm', ['publish', artifact.tarball, '--dry-run', '--ignore-scripts', '--access', 'public',
      '--registry', 'https://registry.npmjs.org/'], { stdio: 'inherit' },
  ]]);
});

test('an already published archive with identical SHA-512 skips the dry run', async () => {
  const state = await checkReleasePackage(artifact, {
    registryFetch: registryReply(200, published),
    runNpm: () => assert.fail('npm publish must not run for an existing version'),
  });
  assert.equal(state, 'identical');
});

test('different or incomplete published metadata fails before a dry run', async () => {
  for (const body of [
    { ...published, dist: { integrity: 'sha512-different-bytes' } },
    { ...published, dist: {} },
    { ...published, name: 'other-package' },
    { ...published, version: '1.2.4' },
    null,
  ]) {
    await assert.rejects(checkReleasePackage(artifact, {
      registryFetch: registryReply(200, body),
      runNpm: () => assert.fail('npm publish must not run after a registry mismatch'),
    }));
  }
});

test('registry HTTP, network and JSON errors fail closed', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(checkReleasePackage(artifact, {
      registryFetch: registryReply(status),
      runNpm: () => assert.fail('npm publish must not run after a registry error'),
    }), /npm registry: HTTP/);
  }
  await assert.rejects(checkReleasePackage(artifact, {
    registryFetch: async () => { throw new Error('network down'); },
    runNpm: () => assert.fail('npm publish must not run after a network error'),
  }), /network down/);
  await assert.rejects(checkReleasePackage(artifact, {
    registryFetch: async () => ({
      status: 200, ok: true, json: async () => { throw new SyntaxError('invalid JSON'); },
    }),
    runNpm: () => assert.fail('npm publish must not run after invalid JSON'),
  }), /invalid JSON/);
});

test('a failed npm dry run fails the package gate', async () => {
  await assert.rejects(checkReleasePackage(artifact, {
    registryFetch: registryReply(404),
    runNpm: () => { throw new Error('npm dry run failed'); },
  }), /npm dry run failed/);
});
