# Reproducible fixtures

The integration suite copies fixtures to temporary directories, captures the failing
assertion, changes only production source, reruns the same test and existing tests, and
checks the final report. Intentionally buggy originals stay unchanged.

| Fixture | Reported problem | Root cause / expected fix |
| --- | --- | --- |
| `../../examples/node` | Explicit zero discount reduces a price | `||` treats zero as absent; use `??`. |
| `pagination` | A full result page loses its last item | Exclusive slice end is decremented; remove the subtraction. |
| `python-cart` | A new customer inherits another cart | Shared mutable default; allocate a new list for `None`. |
| `../../examples/browser` | Clicking Apply with zero changes the total | Same defaulting bug exercised through a real Chromium interaction. |
| `missing-dependency` | Private database client is unavailable | Environment failure, not RED; report `BLOCKED`/unverified without installation. |

Core: `npm test` (Node.js 22+, Python 3, existing development dependencies).
Browser: `npm run test:browser` (existing Playwright and Chromium).
Never install missing tooling without explicit user approval.
