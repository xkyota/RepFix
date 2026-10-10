import assert from 'node:assert/strict';

// Only an explicit 404 means this version is available for the dry run or publication.
export async function npmPublicationState(meta, registryFetch = fetch) {
  const response = await registryFetch(`https://registry.npmjs.org/repfix/${meta.version}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (response.status === 404) return 'absent';
  assert.ok(response.ok, `npm registry: HTTP ${response.status}`);
  const published = await response.json();
  assert.equal(published?.name, 'repfix', 'npm registry returned a different package');
  assert.equal(published?.version, meta.version, 'npm registry returned a different version');
  assert.equal(published?.dist?.integrity, meta.integrity,
    'This npm version already contains different bytes; never overwrite or unpublish it');
  return 'identical';
}
