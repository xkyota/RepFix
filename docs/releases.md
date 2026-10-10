# Releasing RepFix

## Preparation and versioning

`Prepare release PR` uses release-please to open/update a PR containing `package.json`, `package-lock.json`, `.release-please-manifest.json` and `CHANGELOG.md`. It never creates a tag or GitHub Release. Conventional Commit squash titles determine the next version: `fix:` → patch, `feat:` → minor, `!`/`BREAKING CHANGE:` → major. Review the proposed version before merging. The initial 0.1.0 manifest is an unpublished baseline, not a claim that an npm release exists.

The generated CLI metadata reads the root package version during build, so npm, `repfix --version`, and installed skill copies agree. No runtime dependencies are added.

GitHub must allow Actions to create pull requests (Settings → Actions → General). The preparation workflow uses the ephemeral `GITHUB_TOKEN` with explicit permissions. No PAT is needed. GitHub places workflows from token-created/updated PRs in an approval-required state. After inspecting the generated version/changelog diff, a maintainer selects **Approve workflows to run** in the PR merge box. This approves test execution only, not the PR or publication. The normal `pull_request` CI must pass before merging. `workflow_dispatch` checks do not satisfy required PR checks, so a green release dry run is not a substitute. `CI passed` and the existing core checks are required by the repository ruleset.

## One-time publishing setup

1. Create the GitHub environment **release**. Require the repository owner as reviewer, restrict deployments to the `main` branch, and disable administrator bypass. For a sole maintainer, allow that reviewer to approve their own manually started run; approval must still be explicit. Do not remove the required reviewer rule.
2. The `repfix` npm package must exist and be owned by the publisher. Its first publication (`0.1.1`) was manual and required the owner's explicit permission, interactive npm login/2FA, and the exact CI-tested tarball from a merged release PR. The procedure is to run the validation below, download its `npm-package-<run id>` artifact, and publish that tarball with `npm publish ./repfix-VERSION.tgz --access public --ignore-scripts`. Do not store login credentials in Git or Actions. Do not publish the initial 0.1.0 baseline just to reserve the name.
3. In npm package Settings → Trusted publishing, configure GitHub Actions with owner **xkyota**, repository **RepFix**, workflow filename **publish.yml**, environment **release**, and allow direct `npm publish`. Configure this when ready to use it: an unused new trusted publisher expires after two days. GitHub-hosted runners and npm ≥11.5.1 are required. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is used. The package repository URL must remain the canonical GitHub URL.
4. Ensure labels `autorelease: pending` and `autorelease: tagged` exist (release-please normally manages them). Keep Dependabot security updates enabled in repository settings.

## Validate without publishing

From Actions → **Validate or publish release**, choose a release PR branch or `main`, enter the exact package version without `v`, and leave **publish** unchecked. Alternatively:

```sh
gh workflow run publish.yml --ref RELEASE_BRANCH -f version=VERSION -f publish=false
```

This runs the full Node 22/24/26 × Ubuntu/macOS core and Chromium matrix, builds and installs real npm archives, and verifies all version files and the newest changelog entry. The package job queries the public npm registry for the exact version. A 404 runs `npm publish --dry-run --ignore-scripts` on the tested archive. An existing version passes only when the registry's SHA-512 integrity equals the tested archive; it skips the dry run because npm rejects a dry run of an already published version. Any other registry response, invalid metadata or integrity mismatch fails the job. With **publish** unchecked, the protected publication job is not entered, no OIDC token is requested, and no tag or release is created. Check the completed workflow and inspect its artifact before authorizing publication.

## Publish after explicit owner approval

1. Review the release PR, approve its CI workflow execution when GitHub requests it, and merge only after the required PR checks pass. Publish from that exact main commit before merging other changes; the publication gate requires a merged release-please PR at the run's commit.
2. Manually run **Validate or publish release** on `main`, enter the version, and check **publish**. This repeats the full validation matrix. Starting it is a separate authorization from merging the version PR.
3. Inspect the run's commit, version, package artifact and successful checks, then approve the **release** environment deployment. The workflow publishes the already tested tarball using npm OIDC and provenance, then creates the matching GitHub tag/Release and attaches the tarball. GitHub notes use the reviewed changelog entry. Release and publication use the run's immutable SHA, even if `main` subsequently advances.

Only the approved job has `id-token: write` and release write permissions. It installs no dependencies, executes no package lifecycle hooks and uses no dependency cache. The CI workflow is shared with ordinary PR validation, so release checks cannot silently drift away from CI.

## Failure and recovery

No automated rollback, unpublish, tag overwrite or force push is performed. If npm publishing fails, no GitHub Release is created. Fix the npm trust/ownership configuration and re-run the failed job from the same workflow run so it uses the same tested artifact and commit. Artifacts are retained for seven days.

If npm succeeded but GitHub release creation or labeling failed, re-run the failed job on the same run. The workflow accepts an existing npm version only when its SHA-512 integrity exactly equals the tested tarball, and accepts an existing tag only when it resolves to the run's SHA. It then completes GitHub release creation/labeling. If the bytes differ, stop and investigate; use a new version for changed content. An already successful GitHub release is not overwritten.

After the first manual publication of `repfix@0.1.1`, run **Validate or publish release** for version `0.1.1` at the exact `main` commit that merged its release-please PR, with **publish** checked. The package job must report that the registry artifact is identical; a mismatch or registry error is a hard stop. Review the successful validation and tested artifact, then approve the **release** environment. The approved job checks the merged release PR and immutable run SHA again, skips npm publication for matching bytes, and completes the tag, GitHub Release and PR label. If a prior run already reached the protected job and failed after npm publication, re-run that failed job instead. Do not change the existing npm version or tag to make recovery pass. This path requires the fixed workflow to be present at that merge commit: a later `main` commit cannot pass the exact release-PR SHA gate for `0.1.1`, and re-running an older workflow run does not change its workflow code.

After the release is complete, the next normal push (or a manual run of `Prepare release PR`) starts the next release proposal. No release PR is automatically merged.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [release-please action](https://github.com/googleapis/release-please-action), [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference), [bot PR workflow approval](https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/), [required PR checks](https://docs.github.com/en/pull-requests/how-tos/merge-pull-requests/troubleshooting-required-status-checks).
