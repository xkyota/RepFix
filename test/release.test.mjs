import { test } from 'node:test';
import assert from 'node:assert/strict';
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
