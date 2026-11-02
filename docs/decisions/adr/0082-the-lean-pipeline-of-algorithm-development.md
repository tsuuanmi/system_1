# ADR-0082: The lean pipeline of algorithm-development

- **Status:** Accepted
- **Date:** 2026-11-01
- **Related:** T365 (part 1), T366 (part 2), T367 (part 3), D113, PROP-0022 change 3,
  T267, [ADR-0063](0063-a-runs-required-checks-run-on-its-exact-result.md),
  [ADR-0071](0071-a-changes-risk-tier-comes-from-the-policys-path-map.md),
  [ADR-0075](0075-a-review-finding-has-a-severity-and-only-a-verified-important-one-blocks.md),
  [INV-2](../../architecture/invariants.md#inv-2-fail-closed),
  [INV-5](../../architecture/invariants.md#inv-5-exact-subject-binding)

## Context

[PROP-0022](../../proposals/0022-lean-core.md) change 3 ("One attempt") makes an attempt of a board
task shorter: review-type steps are 59 % of all steps, and the author's self-review (`selfreview:1`,
T267) agrees with the independent review near chance (kappa 0.17;
[model routing](../../research/model-routing.md) 1.3). The change is built in three parts, each
behind the one switch `profile-software-development.pipeline`, so the operator can turn the lean
graph on, and off again, without a code change. This ADR is the decision of all three; each part
lands in its own task and fills in its section.

## Options

1. **Change the template for everyone.** One graph, no switch. A regression would take the whole
   pilot with it, and the lean graph could not be measured against today's.
2. **A second template** (`algorithm-development-lean`). The board, the lead's scripts, and the
   docs name the template; two names split every one of them.
3. **A switch in the profile's configuration that builds the template's graph** (chosen): the
   template keeps its name; the row says which graph it serves.

## Decision

Option 3. `profile-software-development.pipeline` is `full` or `lean`, default `full`.

### Part 1: no self-review (T365, built)

- **`full`** serves the graph as it was: `develop:1`, `selfreview:1`, `review:1`, byte for byte (a
  test pins the hash of the spec before the switch). A row that does not set the key is unchanged.
- **`lean`** has no `selfreview:1` and none of its grown steps (`selfreview:1:verify`, `:fix:<n>`,
  `:review:<n>`: the engine grows them from the node, so a graph without it never has them).
  `review:1` depends on `develop:1` alone and reads the change from its result. Everything else is as
  in `full`: the evidence gate, test-first, the review, its verification, the approval-gated fix and
  re-review (up to `maxReviewCycles`), the second-family review of a heavy change, the acceptance
  checks, the landing.
- **A run records which pipeline built its spec.** The two graphs have different spec hashes, and
  the engine stores the hash on the run and each node's resolved spec when the run is admitted
  (`workflow_runs.spec_hash`, `workflow.run.started`). A run started before the operator changes the
  key therefore finishes on the spec it started with: replacing the template never touches an
  admitted run. As a label, under `lean` the template's playbook version is the package's with
  `+lean`, which each step's brief records (`handbook` layer 4,
  `playbook:algorithm-development@<version>+lean:<hash>`); under `full` it is the package's version
  as before. A brief reads that version when it is built, so a run spanning a change of the key
  labels its later steps with the pipeline then in force; its spec hash and its graph stay the
  stored ones.
- **Fail closed (INV-2).** A value other than `full` or `lean` is refused at load and by
  `system check`.
- **The live profile is not changed by this part:** the operator turns `lean` on.

### Part 2: confirmation of a finding (T366, pending)

Pending. PROP-0022 change 3: the author's fix step is shown the important findings first and answers
each with `accept` or `dispute`; a finding the author accepts is confirmed by two parties and spends
no verifier, a disputed one is verified as today (ADR-0075). T366 fills in this section.

### Part 3: parallel checks and review (T367, pending)

Pending. PROP-0022 change 3: under `lean` the required checks and `review:1` run in parallel on one
exact tree, a fix makes a new tree and results bound to an older one are ignored (INV-5), and
acceptance needs both on the same tree. T367 fills in this section.

## Consequences

- With the key unset, nothing changes: the spec, its hash, and the briefs are as before.
- Under `lean`, an attempt has one review step fewer in its graph, and no author fix answers the
  author's own review; the independent review is the only review.
- Two pipelines are two graphs to keep until the operator retires one. The lean graph is measured
  against the full one on the pilot's tasks before `full` goes.
- Revisit when part 3 lands: `lean` then also changes the order of checks and review.
