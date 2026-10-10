// Only invoked by publish.yml after full CI and approval of the release environment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { npmPublicationState } from './npm-registry.mjs';
import { verifyRelease } from './verify-release.mjs';

assert.equal(process.env.REPFIX_PUBLISH_APPROVED, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REPOSITORY, 'xkyota/RepFix');
const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
assert.match(sha, /^[a-f0-9]{40}$/);
const meta = await verifyRelease(process.env.RELEASE_VERSION, process.env.ARTIFACT_DIR);
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (response.status === 404) return null;
  assert.ok(response.ok, `GitHub ${path}: HTTP ${response.status}`);
  return response.json();
}

// Publish only a reviewed, merged release PR at this exact commit, never an arbitrary main build.
const prs = await github(`commits/${sha}/pulls`);
const candidates = prs.filter(pr => pr.merged_at && pr.merge_commit_sha === sha && pr.base.ref === 'main'
  && pr.head.ref.startsWith('release-please--')
  && pr.labels.some(label => ['autorelease: pending', 'autorelease: tagged'].includes(label.name)));
assert.equal(candidates.length, 1, 'Select the main commit that merged exactly one release-please PR');
const pr = candidates[0];
const tag = await github(`git/ref/tags/${meta.tag}`);
if (tag) {
  let object = tag.object;
  while (object.type === 'tag') object = (await github(`git/tags/${object.sha}`)).object;
  assert.equal(object.type, 'commit');
  assert.equal(object.sha, sha, 'An existing release tag points to a different commit');
}
const release = await github(`releases/tags/${meta.tag}`);
if (release) assert.ok(tag && !release.draft && !release.prerelease, 'Existing release must be a published stable release');

const publicationState = await npmPublicationState(meta);
if (publicationState === 'absent') {
  // OIDC is provided by the approved job. No token fallback or package lifecycle scripts.
  execFileSync('npm', ['publish', meta.tarball, '--access', 'public', '--provenance', '--ignore-scripts', '--registry', 'https://registry.npmjs.org/'], { stdio: 'inherit' });
} else {
  console.log('The identical npm artifact is already published; finishing GitHub release bookkeeping.');
}
if (!release) {
  gh(['release', 'create', meta.tag, meta.tarball, '--repo', repo, '--target', sha,
    '--title', meta.tag, '--notes-file', join(process.env.ARTIFACT_DIR, 'release-notes.md')]);
}
gh(['pr', 'edit', String(pr.number), '--repo', repo, '--remove-label', 'autorelease: pending', '--add-label', 'autorelease: tagged']);
