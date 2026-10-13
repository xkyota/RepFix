# Architecture and sources

RepFix has one skill and a small evidence helper. The host agent investigates and edits;
deterministic modules detect project metadata, capture commands, compare unchanged test
oracles, and assess evidence. No model API, agent framework, hooks, or extra runtime
dependencies are required. `src/` is the maintained TypeScript source;
`npm run build` emits portable helpers in `skills/repfix/scripts/`.

## Adaptive verification engine

`src/adaptive.ts` classifies once at `init` using bounded detection metadata, the task summary, pinned oracle paths, and declared regressions. It scores bug complexity, scope, technical risk, test availability, environment uncertainty, and regression impact with a small deterministic rule set. A clear local bug with a detected runner and pinned checks selects FAST; brief, ambiguous, or Cyrillic summaries select at least STANDARD; cross-component, concurrent, monorepo, security, or data-integrity work selects DEEP. Sensitive oracle paths can also select DEEP. These rules recognize only explicit patterns and still need host judgment. Reasons, confidence, and uncertainty are explicit. The optional `needsHostAssessment` flag asks the existing host agent to inspect evidence; it does not call a model API. A low confidence never lowers the profile.

Profiles guide test selection, not CLI permissions or report status. FAST runs a focused RED/GREEN and relevant regression; STANDARD adds adjacent component checks; DEEP adds the affected integration, security, and broader checks. The host selects reviewed commands and declares relevant regressions. The CLI cannot infer semantic coverage of arbitrary tests. Existing `auto`, `diagnose-only`, and `verify-only` restrictions continue unchanged.

The runner raises depth on incomplete reproduction, unexpected verification/regression failures, different exit codes for the same command and source state, multi-file source changes, and sensitive command context or paths. The host can record an unobservable discovery with `signal`; assumption/limitation and sensitive notes also raise depth. Events are retained with reason, time, command position, and old/new profile. `plan --regression NAME --reason TEXT` extends a session after a new affected component is found. Its append-only history records each declaration and the command position. A new check must pass after its declaration and verification; a material escalation also requires every declared regression to run again. Older version-1 manifests without history remain readable. The status assessor's original RED/GREEN, unchanged-oracle, causal-note, freshness, artifact-integrity, and declared-regression gates remain mandatory for VERIFIED at every profile.

Reports include local telemetry: profile selection and escalation, elapsed wall time, recorded child-command time per phase, `recordedCommandCount`, elapsed time outside recorded child commands, and outcomes. The remainder cannot be attributed to model reasoning; it includes CLI overhead, agent activity, idle time, and any other work between calls. The count excludes non-`run` CLI calls and host agent tools. The helper cannot observe host tool calls or token use. Detection uses the initial snapshot file list; command snapshots and artifact integrity checks remain necessary for evidence. No runtime dependency or external telemetry endpoint was added.

When causality is established at RED confirmation, `confirm --cause` records the causal note in the same manifest update, avoiding one CLI launch and duplicate manifest loading. The separate `note` action remains available when diagnosis takes longer. This is a workflow optimization only; the same evidence requirements apply.

## Focused research (2026-10-09)

The following public GitHub metadata was checked with the repository, contributor and
commit APIs. Counts change; push activity is distinct from a default-branch commit.

| Project | Adoption / activity snapshot | Evaluation and adopted idea |
| --- | --- | --- |
| [ECC](https://github.com/affaan-m/ECC) | 275,633 stars; pushed Oct 5; latest main commit [ef648e0](https://github.com/affaan-m/ECC/commit/ef648e01899ba3e8dc6371642deaaf64b4477775), Oct 2. Contributors include affaan-m (1,752 contributions), haelyra (200), pangerlkr (47). | Extensive installation, compatibility and workflow documentation. Adopt the separation of short skill instructions, on-demand references, deterministic scripts and CI. Avoid its broad agent/skill catalog, hooks and configuration layers. |
| [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) | 8,333 stars; pushed Oct 6; latest main commit [04d809c](https://github.com/SWE-agent/mini-swe-agent/commit/04d809ceab9df28f9adaed044884180159172930), Sep 3. Contributors include klieret (867), Chesars (17), closji (16); recent commits also include john-b-yang and a CI bot. | Documented tutorials, CLI and evaluation workflows, with research adoption reported by its maintainers. Adapt its small execution surface and inspectable linear history; retain the user's existing agent instead of embedding another model runtime. |

[SWE-agent](https://github.com/SWE-agent/SWE-agent) was considered but its README directs
new users toward mini-SWE-agent, where development is focused. This informed the choice
of the smaller reference. Stars and maintainer usage claims are discovery signals, not
independent reliability or security evidence. RepFix's own fixtures test the adopted design.

Both selected projects declare MIT licenses
([ECC license](https://github.com/affaan-m/ECC/blob/main/LICENSE),
[mini-SWE-agent license](https://github.com/SWE-agent/mini-swe-agent/blob/main/LICENSE.md)).
Only architectural ideas were adapted; no source code was copied or vendored.
RepFix keeps its existing MIT license. Future source reuse requires checking the exact
file/revision license and retaining applicable notices.

## Verification boundaries and next priorities

The CLI validates local evidence; the host agent must judge whether a failing assertion
matches the bug and whether the fix addresses the cause. Command approvals are recorded
attestations, not a sandbox. Detection is a bounded metadata heuristic and never executes
configuration. Unsupported projects can still use explicitly reviewed test commands.

Next priorities, based on these limits:

1. Add runner-specific executed-test checks when real Jest/Vitest/pytest cases justify them.
2. Complete the Claude Code side of the [agent pilot](pilot-adaptive.md) with clean copies
   of the same fixtures; the Codex pilot covers two small cases, not broader model behavior.
3. Add focused monorepo discovery and Windows process-tree cleanup when those environments
   are required. Keep each extension independently testable.
