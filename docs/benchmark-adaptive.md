# Adaptive verification benchmark

Run on 2026-10-13 with Node.js 24.16.0 on macOS. The baseline is `origin/main` at 8750835 (RepFix 0.1.3); the candidate is this branch. The reproducible harness is [`scripts/benchmark-adaptive.mjs`](../scripts/benchmark-adaptive.mjs), and the individual results are in [`benchmark-adaptive-results.json`](benchmark-adaptive-results.json).

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Independently valid fixes | 6/6 | 6/6 |
| False VERIFIED claims | 0 | 0 |
| Median completion time | 472 ms | 457.5 ms |
| p95 completion time | 1,390 ms | 1,583 ms |
| CLI calls across eight cases | 55 | 49 |
| Failed / blocked runs | 0 / 1 | 0 / 1 |
| Token usage | unavailable | unavailable |

The eight cases are trivial JavaScript, isolated Python, a multi-file regression, a real Chromium interaction, a missing dependency, alternating flaky tests, a security-sensitive change, and a monorepo. The six fixable cases use the same predetermined edits in each variant. An independent post-report test command checks each fix and the original oracle file is compared byte for byte. The missing-dependency case must be BLOCKED; the flaky case must remain UNVERIFIED. Both variants produced those outcomes. Candidate profiles at report time were FAST for the isolated JavaScript/Python cases, STANDARD for the browser case, and DEEP for the remaining cases.

The candidate can save one CLI call per fixable case by recording an established root cause with `confirm --cause` instead of a separate `note` call. The median improved by 14.5 ms in this single sample. Browser process timing dominated the p95 and was 193 ms slower for the candidate. The benchmark does not demonstrate a reliable end-to-end speedup or token reduction by an autonomous host agent: no model ran, token use was unavailable, and there was one run per case. It measures the evidence-helper workflow and checks that the adaptive additions preserve outcomes. Chromium required an unsandboxed local test process on this macOS host; the ordinary core suite ran in the sandbox.

To repeat, build the baseline and candidate CLI from the intended revisions, then run:

```sh
node scripts/benchmark-adaptive.mjs /absolute/path/to/baseline/skills/repfix/scripts/cli.js /absolute/path/to/candidate/skills/repfix/scripts/cli.js docs/benchmark-adaptive-results.json
```
