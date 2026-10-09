# Architecture and sources

RepFix has one skill and a small evidence helper. The host agent investigates and edits;
deterministic modules detect project metadata, capture commands, compare unchanged test
oracles, and assess evidence. No model API, agent framework, hooks, or extra runtime
dependencies are required. `src/` is the maintained TypeScript source;
`npm run build` emits portable helpers in `skills/repfix/scripts/`.

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
2. Exercise both host agents on the fixtures; the current install tests validate discovery
   directories and standalone helpers, not model behavior.
3. Add focused monorepo discovery and Windows process-tree cleanup when those environments
   are required. Keep each extension independently testable.
