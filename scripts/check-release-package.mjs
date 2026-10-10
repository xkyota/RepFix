import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { npmPublicationState } from './npm-registry.mjs';
import { verifyRelease } from './verify-release.mjs';

export async function checkReleasePackage(meta, { registryFetch = fetch, runNpm = execFileSync } = {}) {
  const state = await npmPublicationState(meta, registryFetch);
  if (state === 'absent') {
    runNpm('npm', ['publish', meta.tarball, '--dry-run', '--ignore-scripts', '--access', 'public',
      '--registry', 'https://registry.npmjs.org/'], { stdio: 'inherit' });
  } else {
    console.log('The identical npm artifact is already published; dry run is unnecessary.');
  }
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const meta = await verifyRelease(process.argv[2], process.argv[3]);
  await checkReleasePackage(meta);
}
