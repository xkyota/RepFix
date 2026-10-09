# RepFix

**Reproduce the bug. Fix the cause. Prove the result.**

RepFix is an open-source debugging skill for **OpenAI Codex** and **Claude Code**. It guides the agent from a report, stack trace, failing test, or screenshot through reproduction, diagnosis, a minimal fix, and regression checks. Every claim is backed by local evidence.

The skill performs the reasoning and edits using your agent's tools. A small TypeScript/Node.js CLI records commands, logs, project fingerprints, findings, screenshots, traces, and Markdown/JSON reports. There is no separate model service, API key, telemetry, or runtime npm dependency.

## Install

Requires **Node.js 22+**, npm, and Codex or Claude Code. The MVP targets JavaScript/TypeScript projects on macOS and Linux; the workflow and command recorder are language-agnostic.

```sh
git clone https://github.com/xkyota/RepFix.git
cd RepFix
npm ci --ignore-scripts
npm run build

# Install a self-contained copy into both agents' project skill directories:
node skills/repfix/scripts/cli.js install --target both --project /path/to/your-project
```

| Host | Project install | Personal install |
| --- | --- | --- |
| Codex | `.agents/skills/repfix/` | `~/.agents/skills/repfix/` |
| Claude Code | `.claude/skills/repfix/` | `~/.claude/skills/repfix/` |

Use `--target codex` or `--target claude` for one host. Use `--scope user` for a personal install. Restart the agent session if the skill is not discovered. The installer refuses to overwrite an existing skill; review your customizations and move the old directory aside before upgrading. No agent settings or existing project files are rewritten.

Installed copies include compiled helpers, references, metadata, and the MIT license. They run without `node_modules` or the original clone. For manual installation, copy the complete **built** `skills/repfix/` directory to either path above. `npm pack` creates a distributable archive with the built skill and CLI; this repository does not assume an npm registry release exists.

## Use

In **Codex**:

```text
$repfix auto: A discount of zero produces $90 instead of $100. Reproduce and fix it.
$repfix diagnose-only: Investigate this stack trace. Do not edit project files.
$repfix verify-only: Check the current checkout's fix and relevant regressions.
```

In **Claude Code**:

```text
/repfix auto: Clicking Apply discount with zero changes $100 to $90.
/repfix diagnose-only: Investigate the attached screenshot and error log.
/repfix verify-only: Verify the existing fix without modifying files.
```

Attach the relevant screenshot, stack trace, or report and describe expected behavior. `auto` is the default. RepFix can also be selected automatically when a matching debugging task is requested. Your host's permissions and project instructions still apply.

## What happens

1. Inspect the report, relevant code, test setup, and existing user changes.
2. Run a minimal reproduction and save the original failure.
3. Confirm that the failure matches the bug; record a causal finding with evidence, separating facts from assumptions.
4. Apply a targeted source fix in `auto` mode.
5. Rerun the same scenario with its original assertions and environment.
6. Run the declared regressions on the final project state.
7. Generate a concise report with command results and linked evidence.

`diagnose-only` never authorizes project edits. `verify-only` checks an existing fix without edits and does not manufacture historical failure evidence. Observed project mutations in either restricted mode produce `FAILED`; RepFix preserves the files for review instead of reverting them.

## Evidence and statuses

Runs live in `.repfix/<timestamp-id>/`, with a local ignore rule to keep evidence out of Git by default. Each run contains:

- A versioned manifest with timestamps, durations, exit codes, command/environment fingerprints, and source/test hashes.
- Redacted command output, the initial Git status/diffs, reviewed attachments, and final diffs.
- Findings, assumptions, failure confirmations, test-change explanations, and limitations.
- `report.md` for people and `report.json` for tooling, with artifact SHA-256 hashes.

| Status | Meaning |
| --- | --- |
| `VERIFIED` | Confirmed original failure now passes under the same recorded scenario; oracles are unchanged, causal evidence exists, and all declared regressions pass on the final state. |
| `PARTIALLY_VERIFIED` | A check passes, but evidence, coverage, oracle stability, freshness, or causal findings are incomplete. Normal upper bound for a new `verify-only` run. |
| `UNVERIFIED` | No complete successful verification, or diagnosis without a fix. |
| `FAILED` | Verification/regression fails, or a restricted mode observes project changes. |
| `BLOCKED` | An execution prerequisite or trustworthy evidence is unavailable. |

The helper derives the status; there is no `--status VERIFIED` override. A passing smoke test cannot replace the failing scenario. Changed assertions, missing regression checks, truncated logs, stale results, missing artifacts, timeouts, or unresolved limitations prevent full verification. Failed attempts remain visible when a later retry succeeds.

The agent must still establish that the assertion exercises the reported bug. This is an evidence ledger with conservative rules, **not a signed proof or an autonomous standalone repair engine**.

## CLI and examples

```sh
node skills/repfix/scripts/cli.js --help
```

The [command reference](skills/repfix/references/commands.md) provides a complete failure-to-fix session, attachment commands, status exit codes, and limits. The [browser guide](skills/repfix/references/browser.md) covers Playwright reproduction, unchanged browser settings, screenshots, and trace privacy.

Two intentionally buggy examples are included:

- [`examples/node/`](examples/node/): zero discount falls through a JavaScript `||` default; Node test reproduction and adjacent regressions.
- [`examples/browser/`](examples/browser/): the same bug through a real Chromium interaction, screenshot, and trace.

Run examples in a temporary copy. Their tests are deliberately failing until the source is fixed. The automated integration tests do this safely and leave the originals unchanged.

## Development and validation

```sh
npm ci --ignore-scripts
npm run check                 # strict TypeScript + unit/integration/install tests
npx --no-install playwright install chromium
npm run test:browser          # real browser fail → fix → pass + regression
npm pack                     # verify the distributable archive
```

Core tests cover status gates, real Node reproduction, preservation of staged/unstaged work, restricted modes, test tampering, stale evidence, timeouts, process cleanup, redaction, literal argv execution, path confinement, and installation in both host directories (including CommonJS projects). The browser test uses synthetic local content and requires Chromium; it fails rather than silently skipping when the browser is unavailable.

The [CI template](ci/repfix.yml) runs the core suite on Node 22/24 and macOS/Linux, plus Chromium on Linux. To activate it, copy it to `.github/workflows/ci.yml` using a GitHub credential with workflow write permission. It is shipped as a template because the publishing credential cannot create Actions workflows.

```text
skills/repfix/       Portable SKILL.md, references, Codex UI metadata
  scripts/          Compiled, dependency-free helper (generated by build)
src/                TypeScript CLI, recorder, status/report, safety, installer
test/               Node test runner integration and browser tests
examples/           Minimal reproducible Node and browser bugs
```

Extend the skill through focused references and ordinary project test commands. Add adapters only when a project needs them; the core does not depend on a test runner or programming language. Contributions should include a reproduction and tests for the changed behavior. Run `npm run check` and, for browser-related changes, `npm run test:browser` before submitting a pull request.

## Safety and current limits

The helper uses argument arrays with `shell: false`, bounded logs, timeouts, private evidence file modes, locks, and artifact integrity checks. It never patches source files, rewrites tests, resets Git, or uploads evidence. The skill directs the agent to preserve user edits and explain intentional test changes. RTK is optional for exploration; original command output is captured without compression for evidence.

Commands still run with the caller's permissions. Read-only modes detect observed mutations; they are not a sandbox. Use trusted commands and local test services. On Unix, timed-out commands and their process groups are terminated; Windows child-tree cleanup is limited and Windows is not in the tested MVP platform matrix. Node's inherited internal `NODE_TEST_CONTEXT` is cleared so nested test runs execute instead of silently skipping.

Redaction is best-effort for common credentials and secret environment values. Review logs before sharing. Images and ZIP traces cannot be automatically scrubbed; importing them requires `--reviewed`. Git-ignored files, external state, files outside the selected project root, and transient edits between snapshots are not fully monitored. Tests/assertion files must be non-ignored and explicitly pinned. Fingerprints detect changes, not whether a user's intended work survived; review diffs.

No automated screenshot interpretation, semantic test-coverage proof, historical-session merging, or model API orchestration is included. Host discovery paths and self-contained helpers are tested; actual Codex/Claude Code model behavior depends on the installed host and its permissions.

## Format and license

RepFix uses the shared [Agent Skills specification](https://agentskills.io/specification), the documented [Codex skill format and discovery paths](https://developers.openai.com/codex/skills/), and [Claude Code skill conventions](https://code.claude.com/docs/en/skills). Host-specific Codex UI metadata is optional; the main instructions stay portable.

[MIT](LICENSE) © 2026 RepFix contributors.
