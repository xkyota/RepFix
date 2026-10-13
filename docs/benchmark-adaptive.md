# Adaptive verification benchmark

Run on 2026-10-13 with Node.js 24.16.0 on macOS. The baseline is commit `8750835` (the main branch before PR #15); the candidate is this branch. The harness is [`scripts/benchmark-adaptive.mjs`](../scripts/benchmark-adaptive.mjs). [`benchmark-adaptive-results.json`](benchmark-adaptive-results.json) retains every run, order position, timing, status, independent check, and paired difference.

Each of eight fixtures ran three times for each variant, rotating variant order by fixture and round. The baseline and `candidate_no_cause` use a separate root-cause `note`; `candidate_with_cause` records it in `confirm --cause`. This separates the confirmation shortcut from the rest of the candidate CLI, including profile selection. A separate 10-batch microbenchmark measures the classifier function alone. The fixture harness applies the same predetermined source edits in each variant, then runs independent tests and compares the pinned oracle byte for byte. It measures recorder workflow cost and status behavior, not autonomous agent debugging time.

| Measure, 24 runs per variant | Baseline | Candidate, separate note | Candidate, `confirm --cause` |
| --- | ---: | ---: | ---: |
| Independently valid fixes | 18/18 | 18/18 | 18/18 |
| False VERIFIED claims | 0 | 0 | 0 |
| Completion median | 538 ms | 536.5 ms | 516 ms |
| Completion range | 176–1,589 ms | 179–1,667 ms | 180–1,825 ms |
| Observed p95 | 1,545 ms | 1,579 ms | 1,561 ms |
| Standard deviation | 389.3 ms | 399.6 ms | 416.3 ms |
| `init` median | 50 ms | 51 ms | 51 ms |
| Total CLI calls | 165 | 165 | 147 |
| Blocked / failed reports | 3 / 0 | 3 / 0 | 3 / 0 |

The candidate without `--cause` had a paired median completion difference of about +4 ms against the baseline across the 24 fixture/round pairs. That comparison includes all candidate changes, not just the classifier. Direct calls to the deterministic classifier took a median 1.047 µs per call across 10 batches of 10,000 calls, with batch measurements spanning 1.026–1.695 µs per call. This CPU measurement excludes CLI startup, snapshotting, and agent work.

Within the same candidate, `confirm --cause` saved one CLI call in each of the 18 fixable runs. Its paired median difference was about −27 ms across all 24 fixture/round pairs. Non-fixable cases used the same call sequence. Timing varied substantially, especially for Chromium, and the observed p95 values do not establish a reliable p95 improvement. The benchmark cannot measure model tokens or host tool calls. The separate [agent pilot](pilot-adaptive.md) assesses actual agent behavior where a host was available.

The fixtures cover isolated JavaScript and Python bugs, a multi-file regression, a real Chromium interaction, a missing dependency, alternating flaky tests, a security-sensitive change, and a monorepo. All three variants reported the missing dependency BLOCKED and the flaky case UNVERIFIED in every round. Chromium needed a test process outside this environment's process sandbox because macOS denied its Mach port registration (`bootstrap_check_in ... Permission denied (1100)`); the browser test and benchmark completed with that access.

To repeat, build the baseline and candidate CLI at the recorded revisions, then run:

```sh
node scripts/benchmark-adaptive.mjs /absolute/path/to/baseline/skills/repfix/scripts/cli.js /absolute/path/to/candidate/skills/repfix/scripts/cli.js docs/benchmark-adaptive-results.json 3
```
