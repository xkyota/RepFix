# Evidence helper

Requires Node.js 22+. The installed skill includes compiled JavaScript and needs no runtime npm dependencies. Resolve `REPFIX` to the CLI beside the loaded skill; all example shell variables are local conveniences. The helper prints short results; read the saved logs only as needed.

```sh
REPFIX=/absolute/path/to/repfix/scripts/cli.js
node "$REPFIX" detect --project .
# Review the report, test command, hooks and local test setup. Record existing
# authorization below; ask first if the command is untrusted or needs setup.
APPROVAL="Reviewed local unit tests; user authorized this repair and its tests"
SESSION=$(node "$REPFIX" init --project . --mode auto \
  --summary "Discount of zero is treated as missing" \
  --oracle test/discount.test.mjs --regression unit)

node "$REPFIX" run --session "$SESSION" --phase reproduce --name original --approval "$APPROVAL" \
  -- node --test test/discount.test.mjs
# Expected nonzero exit: inspect the log identified in the JSON output.
# Do not use shell `set -e` around an expected failing reproduction.
node "$REPFIX" confirm --session "$SESSION" --command c1 \
  --reason "The zero-discount assertion expected 100 but received 90"
node "$REPFIX" note --session "$SESSION" --kind root-cause --evidence c1 \
  --text "discount.mjs:2 uses ||, replacing valid zero with the fallback"

# Agent applies the minimal source fix, preserving the original assertion.
node "$REPFIX" run --session "$SESSION" --phase verify --name original --approval "$APPROVAL" \
  -- node --test test/discount.test.mjs
node "$REPFIX" run --session "$SESSION" --phase regression --name unit --approval "$APPROVAL" \
  -- node --test test/discount.test.mjs test/default.test.mjs
node "$REPFIX" note --session "$SESSION" --kind fix --evidence c2 \
  --text "Changed the discount fallback from || to ?? to preserve zero"
node "$REPFIX" report --session "$SESSION"
```

These are argument arrays. Shell expansion, pipes, redirects, and inline environment assignments are not interpreted. For npm scripts, use `-- npm test -- --runInBand` as appropriate for the actual test runner. The runner rejects shell wrappers, common destructive commands, and package installation commands. Use direct executable paths on Windows; `.cmd` shims are not supported. `--approval` is a review/authorization record, not a permission bypass or a security boundary. Review project scripts and hooks, and obtain explicit user approval for untrusted commands or dependency installation; perform approved setup separately with host tools. Commands inherit the current environment; secret values and common token patterns are redacted from saved logs and command displays. The fingerprint hashes the original arguments and inherited environment (excluding volatile shell bookkeeping) so redaction does not affect scenario matching. Keep terminal/runtime environment stable across reproduction and verification.

`detect` reads bounded metadata for JavaScript/TypeScript (Node, Vitest, Jest, Mocha, Playwright), Python (pytest/unittest), Go and Rust. Framework hints include React, Next.js, Vue, Svelte, Express, NestJS, Django, FastAPI and Flask. It reads no more than 2,000 directory entries at four levels and 256 KiB per inspected file; it ignores dependency trees and symlinks. It never runs inferred commands. Candidates require review and may require dependencies. `init` saves detection using its existing snapshot file list; unknown environments still support manual command selection. Detection is heuristic, not a configuration parser or a monorepo planner.

`--cwd` is relative to the project and cannot escape it. `--timeout` defaults to 120000 ms (allowed: 100–3600000). Use the same timeout for before/after. `--context` records a fingerprint of extra scenario information such as fixture revision, browser, viewport, or service version; pass exactly the same context on the rerun. Arguments or context should not contain credentials. RTK is optional for exploration and never required by the helper.

Text, stack traces, screenshots, and browser evidence:

```sh
node "$REPFIX" attach --session "$SESSION" --file bug-report.txt
node "$REPFIX" attach --session "$SESSION" --file stack-trace.log
# Inspect and scrub private content first; image/zip contents cannot be redacted automatically.
node "$REPFIX" attach --session "$SESSION" --file screenshot.png --reviewed
node "$REPFIX" attach --session "$SESSION" --file trace.zip --reviewed
node "$REPFIX" note --session "$SESSION" --kind fact --evidence a2 \
  --text "The supplied stack trace points to discount.mjs:2"
node "$REPFIX" note --session "$SESSION" --kind assumption \
  --text "Only zero discounts appear affected; negative values are not yet checked"
node "$REPFIX" note --session "$SESSION" --kind limitation \
  --text "The production-only data condition could not be exercised locally"
node "$REPFIX" report --session "$SESSION" --blocked "Test database unavailable; start the local test service"
```

IDs are session-local and returned by each operation. Do not assume `a2` or `c1` identifies an artifact until the helper returns it. `fact` and `root-cause` require existing evidence IDs. `test-change` records why a test was intentionally changed; it never bypasses oracle stability. Limitations are retained for the life of a session; start a fresh session after resolving them if needed. All attempts stay in the report; the latest attempt for each phase/name determines current failure/blocker state. Reuse a stable name when retrying the same scenario.

## Output and exit codes

`init` prints an absolute session path. Other operations print compact JSON. `detect` exits zero even for an unsupported project; inspect its status and warnings. `run` returns the child's exit code, or 3 for timeout/spawn/signal failures. An `evidenceIssue` prevents successful verification even when the child exits zero. Empty output, Node/TAP zero passes, unittest zero/all-skipped tests, and common no-tests messages are rejected; other summaries still need human/agent inspection. `report` returns 0 for `VERIFIED`, 2 for `PARTIALLY_VERIFIED`/`UNVERIFIED`, 1 for `FAILED`, and 3 for `BLOCKED`. Invalid options and unsafe paths exit 3 with an error. Errors before a session exists cannot create a report; explain them in the final response.

Each `.repfix/<timestamp-id>/` contains a versioned `run.json`, redacted logs and attachments with SHA-256 hashes, `report.md`, `report.json`, and a final Git diff. The initial Git diff is an artifact. Artifacts are append-only; reports are refreshable. The manifest is a local audit record, not a tamper-proof attestation. Missing/modified attachments block verification. A per-session lock prevents concurrent updates. After a crash, check the PID in `.lock` and remove that file only if the process is no longer running. Never delete a live lock.

Logs retain at most 1 MiB per command; truncation disqualifies that command as complete verification. Attachments allow 32 MiB. Snapshots allow 20,000 files, 32 MiB per file, and 256 MiB total. Git projects fingerprint tracked and non-ignored untracked files; non-Git directories omit `.git`, `.repfix`, dependencies, and common test output directories. Submodules require a separate focused run. Ignored code, external services, files outside the selected root, in-flight changes that are reverted before capture, and runtime state are not fully monitored. Pin non-ignored assertion/harness files and select the appropriate root. Review all changes yourself; the helper does not restore or overwrite source files.

Read-only modes constrain the agent, and fingerprints detect observed violations; they do not sandbox subprocesses. On Unix, timeouts terminate the command's process group; on Windows, child-tree cleanup is limited to the direct process. Do not start persistent services through `run`; manage their lifecycle separately.
