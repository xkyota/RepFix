import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releaseMetadata(pkg, lock, manifest, changelog, requested) {
  assert.match(requested, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a stable SemVer version without a v prefix');
  assert.equal(pkg.name, 'repfix');
  for (const version of [pkg.version, lock.version, lock.packages[''].version, manifest['.']]) {
    assert.equal(version, requested, 'Requested version, package, lockfile and release manifest must agree');
  }
  const entries = changelog.split(/^## /m).slice(1);
  assert.ok(entries.length > 0, 'Missing changelog entry');
  const version = entries[0].match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|\(|$)/)?.[1];
  assert.equal(version, requested, 'The latest changelog entry must describe this version');
  const notes = entries[0].slice(entries[0].indexOf('\n') + 1).trim();
  assert.ok(notes, 'Release notes must not be empty');
  return { version, tag: `v${version}`, filename: `repfix-${version}.tgz`, notes };
}

export async function verifyRelease(requested, directory) {
  const json = async name => JSON.parse(await readFile(name, 'utf8'));
  const meta = releaseMetadata(await json('package.json'), await json('package-lock.json'),
    await json('.release-please-manifest.json'), await readFile('CHANGELOG.md', 'utf8'), requested);
  const tarball = resolve(directory, meta.filename);
  const packed = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(packed.name, 'repfix');
  assert.equal(packed.version, requested, 'Artifact version differs from the validated commit');
  const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`;
  await writeFile(join(directory, 'release-notes.md'), `${meta.notes}\n`);
  return { ...meta, tarball, integrity };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const meta = await verifyRelease(process.argv[2], process.argv[3]);
  console.log(`Verified ${meta.tag}: ${meta.integrity}`);
}
