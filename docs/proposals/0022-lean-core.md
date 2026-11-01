---
id: PROP-0022
type: proposal
status: draft
owners: [operator]
created: 2026-11-01
summary: No new features. System is made small and fast around what it is for: route work to the right Worker, durable runs that survive a restart, independent review, checks before landing, and quota and usage accounting. A Worker's command no longer ends its run while it waits for an approval (a quarter of all agent runs today); the ledger stops counting a resumed session's spend again (3.9 times too high); one attempt is develop, then checks and one independent review in parallel, then at most two fix rounds, then landing; each step's tier is set by what the step is, not by the change's risk; the operator decides merges in a batch and a light change lands on its own; little-used parts are turned off and frozen. Target: a small task landed in 20 to 30 minutes (median 1.6 hours today) at no loss of quality, each change switched and measured.
evidence: [operator request 2026-11-01, docs/research/lean-core-2026-11-01.md, docs/research/model-routing.md, System runs run_e0e7591e03d02a95, run_fe9811153a832a00, run_1502579e9af30240, run_eec67360b1246709]
related: [PROP-0016, PROP-0018, PROP-0021, ADR-0038, ADR-0039, ADR-0060, ADR-0067, ADR-0071, ADR-0073, ADR-0075, ADR-0078, INV-2, INV-5, INV-9, INV-12, INV-13, INV-15]
implementation: []
---

# Proposal: Lean core, a small System that runs smoothly

## Problem

The operator's words on 2026-11-01: no new features are needed; System feels heavy and does not
run smoothly, with many parts it does not need; a task's time must come down so the feedback loop
is continuous.

The measurements ([lean core research](../research/lean-core-2026-11-01.md)) agree:

- a task takes a median of 1.6 hours from creation to done (p90 6.2), and 2.47 attempts per
  accepted result;
- a quarter of all agent runs end because a command waits for the operator's approval, and the
  session is resumed by a new run;
- review-type steps are 59 % of all steps, fix steps take 70 % as many agent hours as develop, and
  the frontier tier is half the cost, chosen by the change's risk rather than by the step;
- the operator makes about 116 decisions a day (the L3 line is 10), and 6.5 % of tasks finish
  unattended;
- the ledger counts every resumed session's spend again, so every cost figure is about 3.9 times
  too high;
- website Workers, the reason System exists, carry 3 % of the work;
- parts with almost no recorded use stay mounted and maintained: about 3,200 lines of feedback
  code with no runtime use, two gateways with 16 conversations ever, two agent runtimes with no
  run, a scheduled review whose 6 runs all failed, five templates with 1 to 4 runs each.

## Goals

1. A small task (one independently testable behaviour) lands in 20 to 30 minutes from ready, at
   the median.
2. No agent run ends because of a wait for an approval.
3. Usage and cost figures are right.
4. The operator's decisions fall to at most 10 a day for the `system` project.
5. Quality does not regress: escaped defects, reverts, and failed required checks after landing
   stay at or below the week of 2026-10-25.
6. Parts with no measured use are off and frozen, and removed after 30 days unused.

## Non-goals

- New features, seams, protocols, or templates.
- Changing the security boundary: the read confinement and the SDK sandbox
  ([ADR-0038](../decisions/adr/0038-confined-commands-for-claude-code-workers.md)), egress
  (INV-12), credentials (INV-8), exact-subject binding (INV-5), and serialized landing
  ([ADR-0077](../decisions/adr/0077-landings-queue-per-target-branch-one-at-a-time.md)) stay.
- A model classifier in place of the operator for asked calls. Its published miss rate (17 % on
  real overeager actions) is too high to replace a gate; it can be measured later.
- Line-level clean-up, which [PROP-0018](0018-lean-code.md) covers.

## Evidence and research

[Lean core research](../research/lean-core-2026-11-01.md) holds the measurements, the code facts,
the cited external evidence, and the four live System runs (three brainstorms and one research)
that chose the options below. The research run's verdict applies to all of them: the mechanisms
are documented, but no study proves the whole pipeline. Every change is therefore switched,
measured against the baseline week, and kept only if goal 5 holds.

## Proposed design

Six changes, in the order they land. Each names its switch, what it measures, and the ADR it needs.

### 1. A command does not end its run (approvals)

**Now.** The gate is a PreToolUse hook; on `ask` it returns `defer`, the SDK ends the turn, the run
fails as `config_error`, and the engine resumes the session in a new run after the approval
([a deferred tool call](../design/workflow-engine.md#a-deferred-tool-call)). The studio policy
holds no `commandRules`, so the project's rules (T326) are not in force.

**Change.**

1. **Put the command rules in force (configuration, first).** A `policy-change` approval adds the
   project's `commandRules` to the studio policy, and the T326 option rules go from `warn` to `on`.
   No code.
2. **Trust the sandbox for what stays inside it.** In a `workspace-write` run whose sandbox the
   probe proved (writes to the worktree only, no network, no unsandboxed escape), a Bash call is
   allowed by the gate as `sandboxed`. The gate still asks for everything that leaves the sandbox:
   an excluded command, a write outside the worktree, any network, `git push`, and every non-Bash
   tool the policy asks for today. Each allowed call is recorded as an autonomy decision (INV-13),
   as today.
3. **An asked call waits in the live query.** The hook answers `ask`, and the runtime's
   `canUseTool` callback holds the call open while the request is pending, for at most
   `approvalWaitMinutes` (default 10, the same bound as `deferredCommandMinutes`). An approval runs
   the call in the same query; a rejection returns the denial to the model, which continues. Only a
   wait past the bound, or a host stop, falls back to `defer` and today's resume. The `workers`
   seam's waiting status that ADR-0039 named to revisit is not needed: the run stays `running`, and
   its liveness shows the pending request.
4. **Codex** keeps `approvalPolicy: never` in its sandbox: a blocked command fails back to the
   model, never to a resume.

**Switch.** `agent-workers.enforce.sandboxedBash` (`off`, `warn`, `on`) for item 2 and
`approvalWaitMinutes: 0` for item 3 (0 keeps `defer`).

**ADR.** A new ADR supersedes ADR-0039's "a run deferred on an approval ends as a failure" with
"an asked call waits in the run, bounded, then defers", and amends ADR-0038 with the `sandboxed`
verdict. A supervised check on the pinned SDK first proves that a pending `canUseTool` holds the
query, survives a 10-minute wait, and is reached after the hook's `ask`.

**Measure.** Agent runs that end on an approval (target under 2 %), command approvals a week,
attempt wall time.

### 2. The ledger counts each session's spend once (resources)

**Change.** For an agent run that resumed a session, the runtime records the difference between
its result and the session's previous result (tokens, cost, turns); the first run of a session
records its result as is. A migration recomputes the stored records the same way and marks them
`recomputed`. Caps, budgets, the report, and `metrics` then read right values.

**Switch.** None: a wrong count is a defect, not a mode.

**ADR.** None; the `usage-record` semantics in the [reference](../reference/schemas.md) gain one
sentence (a record is the run's own spend).

**Measure.** The week's recomputed totals against the session maxima (they must match), and the
conformance case of a resumed session.

### 3. One attempt: develop, then checks and one review, then land (workflow, profile)

**Now.** develop, self-review, verification of each finding, fix, re-review, review, verification,
an approval-gated fix, re-review (up to 3 cycles), a second-family review on a heavy change, checks,
digest, merge approval, rebase and recheck, land.

**Change.** `algorithm-development` becomes:

```text
develop:1 ──► checks (exact tree) ─┐
          └─► review:1 (other family, read-only) ─┤─► at most 2 fix rounds ─► land
                                                   (heavy: + review:1:second, another family)
```

- The required checks and the review run in parallel on the same exact tree; a fix invalidates
  both, and both run again on the fixed tree (INV-5).
- Self-review is off. Its agreement with the review is near chance (kappa 0.17) and the literature
  finds self-review weak; the switch keeps it for an A/B if the operator wants one.
- Verification runs only when the author disputes an important finding in its fix step, not on
  every finding. An undisputed important finding goes straight to the fix.
- A fix runs inside the attempt with no approval of its own (remediation approvals go; the merge
  approval or auto-land of change 5 is the gate).
- `maxReviewCycles` default becomes 2.
- The task digest leaves the critical path: it is written after landing, on economy, and only for
  a task the lead marks (or on request).

**Switch.** `profile-software-development.selfReview` (`off` by default), `workflow.verify`
(`disputed` by default, `every` for today's), `workflow.maxReviewCycles`.

**ADR.** A new ADR amends ADR-0075 (verification only on a disputed finding) and records the
pipeline; T267's self-review step is reversed by it.

**Measure.** Attempt wall time, fix rounds per attempt, escaped defects and reverts (goal 5),
review findings that the checks also caught.

### 4. A step's tier is set by the step (routing)

**Change.** Each template step names its own minimum tier, and `tierByRisk` raises only `develop`
and the first `review`:

| Step | Tier |
|---|---|
| develop | standard; frontier on a heavy change or on the task's second attempt |
| review:1 | standard; frontier on a heavy change |
| fix | standard (it no longer takes the tier of the step it fixes) |
| re-review, verify, review:1:second | standard |
| digest, tally, triage | economy |

A failed required check, or a second fix round, raises the next step one tier, recorded as an
escalation decision as today.

**Sessions.** A fix continues the develop session within the attempt. A new attempt starts a fresh
session from a handoff (the diff, the checks' output, the open findings, the task's dossier),
never the previous attempt's transcript.

**Switch.** The policy's `tierByRisk` and a template `tiers` map in the profile's `Config`.

**ADR.** An amendment to ADR-0073 (tiers per step); the session rule amends the resume rule of
[board tasks](../design/workflow-engine.md#board-tasks).

**Measure.** Frontier share of steps and of cost per accepted result, acceptance by tier, the
largest session's cache reads.

### 5. The operator decides what only the operator can (approvals, dispatch, landing)

**Change.**

- `dispatch` is `auto` for ready tasks of an active project with a charter (the policy's own
  switch).
- A light-tier change (by the policy's path map, [ADR-0071](../decisions/adr/0071-a-changes-risk-tier-comes-from-the-policys-path-map.md))
  lands on its own when its required checks pass on the exact tree and its review is clean, through
  the same serialized, rebased, and rechecked landing.
- A normal-tier change lands on one `merge` approval the operator gives in a batch; a heavy one
  keeps its own.
- Remediation approvals go (change 3).

**Switch.** The policy (`dispatch`, `merge` per risk tier), changed through the approval queue.

**ADR.** An amendment to ADR-0060 (auto-land for the light tier, on the conditions above).

**Measure.** Operator decisions a day (goal 4), unattended completion, escaped defects of
auto-landed results.

### 6. Park what is not used (bundle)

Each part is turned off in the bundle and frozen: no change except a security fix, its tests still
run. After 30 days with no use, a separate change deletes it. Three changes, by risk:

| Change | Parts | Evidence |
|---|---|---|
| 6a | `feedback-core` experiments, evaluations, statistics; `gateway-anthropic`, `gateway-responses`; `runtime-antigravity-cli`, `runtime-acp`; the dispatch advisor; templates `panel`, `panel-led`, `study`, `investigate`, `develop` | no runtime use, 16 gateway conversations ever, rows already off, 0 advice, 1 to 4 runs each |
| 6b | `scheduled-review`; `digest-extractive` | 6 runs all failed; a second provider of one seam |
| 6c | session handoffs, board breakers, board escapes; `enforce` switches whose mechanism is on and never toggled | 0 rows; switches with one value in practice |

**ADR.** None for a row turned off ([ADR-0078](../decisions/adr/0078-a-plugin-or-a-mechanism-is-turned-off-at-runtime.md));
a deletion after 30 days supersedes the ADR that introduced the part.

### What stays

The store, leases, event log, and reconciliation (INV-4); the workflow engine's task, attempt,
step, and result; the Claude Code and Codex runtimes, worktrees, both confinements; the board; the
approval queue for merges and calls that leave the sandbox; the required checks and serialized
landing; the resource ledger; the website Workers and `turns` for `ask`, `research`, and
`brainstorm`; the MCP server, CLI, and `/ui`.

### Task sizing

A board task is one independently testable behaviour with criteria a command can check. A task
whose develop step runs past 15 minutes, or whose criteria need more than one test file of new
behaviour, is split by the lead before it is ready. This is a heuristic to measure, not a gate:
the evidence does not support a line-count limit.

## Alternatives considered

- **Keep the pipeline and cap cycles only** (brainstorm option B1): leaves 59 % review-type steps.
- **No review on the light tier** (B4): drops the one independent check a light change has; the
  review is short (median 0.9 minutes) and the checks miss what a reader sees.
- **A self-review A/B first** (B3): the research run favoured it; the brainstorm chose to switch it
  off and keep the switch. The A/B stays possible through `selfReview`.
- **A model classifier before the operator** (A4): miss rate too high for a gate (non-goals).
- **Delete unused parts now** (F3): not reversible if a use appears; 30 days of zero use first.
- **Fresh sessions for every step** (D3): loses the develop context a fix needs.

## Validation plan

- Each change ships with its switch off or at its current behaviour on the test profile first,
  then on the live install, one change at a time.
- The baseline is the week of 2026-10-25 to 2026-11-01 (the research's numbers, ledger recomputed
  after change 2). After each change, one week (or 30 finished tasks) is read with `system
  metrics` and `system report`.
- Kept only if goal 5 holds: escaped defects and reverts per 100 landed, required checks failed
  after landing, and review findings confirmed after landing do not rise.
- The crash suite covers change 1 (a host stop while a call waits in the query falls back to
  `defer` and resumes) and change 3 (a host stop between the parallel checks and review).
- Conformance: the `workers` suite gains a resumed session's usage case (change 2) and an asked
  call that waits (change 1).

## Rollout and rollback

Order: 1.1 (configuration, today), 2, 1.2 and 1.3, 3, 4, 5, then 6a, 6b, 6c. Each is reversed by
its switch; a parked row is turned back on with `system plugin`. Change 2's migration keeps the
original figures in each record's `record` column, so it can be recomputed again.

## Observability and operations

`system metrics` gains no metric; the existing ones measure every goal. Health shows a run whose
call waits in the query (its liveness names the request). The runbooks for
[a deferred tool call](../operations/runbooks.md) and accepting a review change with changes 1, 3,
and 5.

## Security and privacy

Change 1.2 allows, without the operator, only what the proven sandbox already confines: writes to
the run's worktree and no network. Everything that leaves it asks, as today. If the probe cannot
prove the sandbox, the run reports `executes: false` and no Bash runs (INV-2). Change 5 lets a
light change land without a person: only on green required checks on the exact tree and a clean
independent review, through the same landing; the light tier is the policy's path map, changed only
through the approval queue.

## Compatibility and migration

Change 2 migrates `resource_usage` (recompute, originals kept). Change 3 changes the
`algorithm-development` nodes: a run started before it finishes on its old spec (the spec hash is
stored with the run). Old runs of parked templates stay explainable. No client contract changes.

## Decision

Pending the operator.

## Implementation

Not started.
