# Contributing to RepFix

Thanks for improving RepFix. Please open an issue for a substantial change so the scope can be discussed before implementation. Small fixes can go straight to a pull request.

## Development

Use Node.js 22, 24 or 26, npm, and Python 3 for the Python fixture. Start from the current `main` branch and create a focused topic branch. Keep Node 22 compatibility and use the 22.x Node type declarations even when developing on a newer runtime.

```sh
npm ci --ignore-scripts
npm run check
```

For browser behavior, install Playwright Chromium only after reviewing the download and then run `npm run test:browser`. Run `npm run test:pack` when changing the packaged skill or CLI; it builds a real archive and verifies offline installation and standalone copies. The examples contain intentional bugs; do not fix those fixtures as part of unrelated work.

## Pull requests

Describe the problem, the smallest reproduction, the change, and the checks you ran. For bug fixes, show the failing scenario before the fix and the passing result afterward. Keep assertions and fixtures honest. Include documentation updates when changing installation, CLI behavior, evidence formats, or safety rules. Do not commit `.repfix/` evidence, screenshots, traces, credentials, or private project content.

CI runs TypeScript checks, core tests, package installation and Chromium on Node.js 22/24/26 across Linux and macOS. A maintainer reviews and merges passing pull requests. Use Conventional Commit PR titles for squash merges: `fix:` for patches, `feat:` for minor releases, and `feat!:` or a `BREAKING CHANGE:` footer for major releases. Breaking changes require deliberate review, including during 0.x development.

## Releases

The [release guide](docs/releases.md) describes version PRs, dry runs, manual approval, npm OIDC setup and recovery. Merging a release PR only updates the version and changelog. Never run publication without the repository owner's explicit approval.

Dependabot groups minor/patch npm updates and keeps major Playwright/Actions updates separate. Routine TypeScript and `@types/node` major updates require a planned migration; the `allow.update-types` restrictions apply only to version updates, leaving security updates enabled. When adding a development dependency, add it to the npm `allow` list. Major security fixes must be reviewed individually for Node 22 compatibility; a green CI run alone is not permission to replace the baseline types with a newer Node major.

## Security

Please follow [SECURITY.md](SECURITY.md) for vulnerabilities. Do not disclose them in a public issue or pull request.
