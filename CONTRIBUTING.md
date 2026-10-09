# Contributing to RepFix

Thanks for improving RepFix. Please open an issue for a substantial change so the scope can be discussed before implementation. Small fixes can go straight to a pull request.

## Development

Use Node.js 22 or 24, npm, and Python 3 for the Python fixture. Start from the current `main` branch and create a focused topic branch.

```sh
npm ci --ignore-scripts
npm run check
```

For browser behavior, install Playwright Chromium only after reviewing the download and then run `npm run test:browser`. Run `npm pack --dry-run` when changing the packaged skill or CLI. The examples contain intentional bugs; do not fix those fixtures as part of unrelated work.

## Pull requests

Describe the problem, the smallest reproduction, the change, and the checks you ran. For bug fixes, show the failing scenario before the fix and the passing result afterward. Keep assertions and fixtures honest. Include documentation updates when changing installation, CLI behavior, evidence formats, or safety rules. Do not commit `.repfix/` evidence, screenshots, traces, credentials, or private project content.

CI runs TypeScript checks and core tests on Node.js 22/24 across Linux and macOS, plus a Chromium integration test on Linux. A maintainer reviews and merges passing pull requests.

## Releases

Maintainers create a GitHub release manually after checking CI on `main`, reviewing the packaged contents with `npm pack --dry-run`, and writing release notes. A release tag does not imply an npm publish; no registry publishing is automated.

## Security

Please follow [SECURITY.md](SECURITY.md) for vulnerabilities. Do not disclose them in a public issue or pull request.
