---
id: PROP-0023
type: proposal
status: accepted
owners: [operator]
created: 2026-11-02
summary: Each kind of Worker does the work it is for, so Claude's tokens go to building only. Claude (standard tier by default) writes code; Codex and Antigravity review, write tests and documentation, and run the checks; website Workers ask, research, brainstorm, and review a change when the review packet fits. A session stops growing past a ceiling, every task carries a token budget, and a decompose template splits a goal into small tasks that run in parallel.
evidence: [operator request 2026-11-02, docs/research/token-use-2026-11-02.md, docs/research/lean-core-2026-11-01.md, System run run_fab7b75f346d6d2d]
related: [PROP-0004, PROP-0016, PROP-0022, ADR-0049, ADR-0057, ADR-0063, ADR-0070, ADR-0073, ADR-0075, INV-2, INV-5, INV-11, INV-13]
implementation: [ADR-0083, packages/plugins/board, packages/plugins/profile-software-development, packages/plugins/workflow, packages/plugins/resources]
---

# Proposal: Worker roles and a token budget

## Problem

On 2026-11-02 the operator said System uses too many tokens and a task's lifecycle is too long. System
exists to save tokens ([purpose](../requirements/purpose.md)), yet the measurements
([token use research](../research/token-use-2026-11-02.md)) show:

- Claude agent runs drew about 4,600 USD API-equivalent in 7 days, about 52 USD per accepted result,
  counting each session's growth once;
- 98 % of input is cache reads: the cost is context size times turns. Resumed sessions re-read their whole
  transcript every turn (about 1 M tokens a turn for a frontier develop run);
- the steps after develop (self-review, review, fixes, verification) cost more than develop, mostly on Claude,
  often at frontier;
- website Workers carry about 3 % of the work, while two of three Claude accounts were at 90 % of their
  five-hour window and Codex had headroom.

[PROP-0022](0022-lean-core.md) takes out the waits, self-review, and frontier-by-risk. This proposal says who
does each kind of work, bounds a session's size, and gives a task a budget, on the seams PROP-0022 keeps.

## Owner decisions (2026-11-02)

1. System keeps building itself through its own pipeline; that self-build is the proof it works.
2. Clear roles. Claude **builds** (standard tier, the Sonnet-class model, by default). Codex and Antigravity
   **review, test, and update documentation**. Website Workers **ask, research, brainstorm, and review where
   they can**.
3. Website Workers are used much more; other website providers come later.
4. The operator can add Gemini API Workers, and up to three Antigravity Workers.
5. A task's lifecycle must be shorter: work runs in parallel, and a goal is decomposed into tasks.

Decision 2 reverses, for documentation and tests, the operator's rule of 2026-10-25 that Claude makes every
change to the codebase. Decision 4 needs PROP-0022 change 6a amended: the `runtime-antigravity-cli` row is not
parked.

## Goals

1. Claude usage per accepted result falls to at most 5 USD API-equivalent (52 today), counted over every
   attempt, by the ledger's per-session growth.
2. Claude runs only `code` steps (develop and its fixes). Review, `tests`, `docs`, and `validation` steps run on
   other families; `ask`, `research`, and `brainstorm` run on website and model Workers whenever one is admitted.
3. Website Workers take at least 30 % of the steps of `algorithm-development` and of the core templates together
   (3 % today).
4. Created-to-landed time of a decomposed task falls to a median of 45 minutes (1.6 hours today).
5. Quality does not regress, as in [PROP-0022 goal 5](0022-lean-core.md#goals).

## Non-goals

- New seams, protocols, or record kinds. Roles are the existing `kinds` of
  [ADR-0057](../decisions/adr/0057-route-work-by-kind.md); budgets are the board task's existing `budget`; a
  decomposition files tasks through `ctx.board`.
- A tool, model, or vendor named in routing, template, or profile code
  ([INV-11](../architecture/invariants.md#inv-11-no-tool-lock-in)). Which Worker plays which role is the
  operator's configuration.
- Website Workers running code. They read; checks run locally.

## Proposed design

Six changes, in the order they land. Each names its switch and what it measures.

### 1. Roles are configuration (no code)

| Role | Kinds of work | Workers (operator configuration) | Tier |
|---|---|---|---|
| build | `code` | Claude accounts, `workspace-write` | standard; frontier only by escalation (change 4) |
| tests and docs | `tests`, `docs` | Codex and Antigravity, `workspace-write` | standard |
| checks | `validation` | Codex and Antigravity | economy |
| code review | review steps | website first (change 2); else Codex or Antigravity, read-only | standard |
| ask, research, brainstorm | team members | ChatGPT Web; Gemini API until another website provider is added | per template |

- The Claude `develop` Workers keep only `code`; `docs` and `tests` move to the Codex and Antigravity writers.
  A step's kind already routes it ([route work by kind](../operations/runbooks.md#route-work-by-kind)).
- **Code gap.** A board task carried no variant, so dispatch started every task's `develop:1` as `code`. A board
  task now names an optional `variant` (`board-task@1.5`, `mcp-board` 1.7), which dispatch routes by.
- The Claude `review` and `review-2` roles are removed from the operator's patch: a Claude build is never
  reviewed by Claude. The Claude `research` role stays only as the last fallback of `research`.
- Antigravity: the `runtime-antigravity-cli` row is on again, up to three accounts, running only the verified
  `agy` 1.4.6 ([ADR-0043](../decisions/adr/0043-antigravity-cli-workers-gated-on-a-version-verified-live.md)).
  It takes review and `validation` until a live check shows it can write.
- More Gemini API Workers add capacity, not diversity: they are one family (`gemini-web`).

**Switch.** The operator's patch (`agent-workers` roles and `kinds`; the bundle row). **Measure.** Steps by family
and kind; the Claude share of steps (goal 2).

### 2. A website Worker reviews a code change when the packet fits

Today `review:1` needs `local-data`, so only an agent Worker takes it. The deterministic source step of the review
procedure already renders a subject for website members ([teams: sources](../design/teams.md#sources)).

**Change.** `review:1` of `algorithm-development` takes a **review packet**, built by a deterministic step on the
exact tree `T` with no Worker:

- the task's goal and criteria, the exact diff, each changed hunk with its surrounding lines, the required checks'
  recorded output on `T`, and the review guides of the touched areas;
- fenced as data, and checked by `ctx.egress` at the packet's classification;
- bound to `T` (INV-5). A fix makes a new tree and a new packet.

The packet fits when it is within the Worker's configured input bound (per Worker source, replacing the single
`maxSourceChars`). `review:1` then routes **website first**, then to a read-only agent Worker of another family than
the author.

An agent reviewer is required, recorded as a routing decision (INV-13), when the packet does not fit, when the change's
risk tier is `heavy` ([ADR-0071](../decisions/adr/0071-a-changes-risk-tier-comes-from-the-policys-path-map.md)), or
when the website review reports that the packet lacks what it needs.

A website reviewer never claims a check ran ([ADR-0063](../decisions/adr/0063-a-runs-required-checks-run-on-its-exact-result.md)).
A finding whose quote is not found in the packet is a `nit`
([ADR-0075](../decisions/adr/0075-a-review-finding-has-a-severity-and-only-a-verified-important-one-blocks.md)).

**ADR.** A new ADR: a code review may be served from a packet by a Worker with no local access. It amends ADR-0063's
routing of `review:1`.

**Switch.** `profile-software-development.review.packet` (`off` today, `on`). **Measure.** Website share of
`review:1`; findings per review and their confirmation rate by family; escaped defects of packet-reviewed changes
against agent-reviewed ones.

### 3. A session stops growing; a task has a budget

- **Session ceiling.** A step continues a session only while its last context is below
  `workflow.sessionContextCeiling` (tokens; first value 50 k, the team's pilot value). Above it, the fix starts a fresh
  session from the brief and the task's dossier ([ADR-0070](../decisions/adr/0070-workers-that-share-no-session-work-through-a-tasks-dossier.md)):
  the diff, the open findings, the checks' output. The choice is a `routing` decision naming the size.
  - An agent Worker resumes a session's native conversation whenever one exists (`agent-workers` `turnOf`), so leaving
    `resume` off the brief is not enough. The fix moves to a new session through the existing session move
    (`workflow/src/session-moves.ts`, a `workflow.session-move` decision).
  - The ceiling reads the session's latest run: its input (uncached, cache read, and cache written) divided by its turns.
    A usage record holds a run's totals, not its last context.
- **Turn caps by step**, in the operator's patch (`maxTurns` per role and tier): build 16, fix 8, review 12 (the team's
  pilot values; build averages 28 today). A run that reaches its cap ends, and its result says so.
- **A default task budget.** The board task's `budget` is enforced by reservation before each step
  ([a task's budget](../design/workflow-engine.md#a-tasks-budget)). A budget line capped one pool, and each Claude account
  is its own pool (`<template>/<account>`), so no line could cap a task whichever account served it. A line on a template's
  id now counts every account's pool ([ADR-0083](../decisions/adr/0083-a-budget-line-on-a-template-counts-every-accounts-pool.md)).
  The board's `defaultBudget` gives a task with no budget its lines (empty by default; first value
  `{pool: claude-code.agents, unit: usd, amount: 6}`). A spent budget ends the attempt; the lead decides to rescope,
  escalate, or defer.

A fresh run starts small (about 10 k tokens plus its prompt, [research §4](../research/token-use-2026-11-02.md#4-prompt-sizes)).
The large contexts are resumed sessions, so the ceiling, not a prompt diet, bounds them.

**Switches.** `workflow.sessionContextCeiling`; the charter's `defaultBudget`; the roles' `maxTurns`. **Measure.** The
largest session per step; cost per accepted result (goal 1); attempts ended by a budget or a cap.

### 4. Build is standard; frontier only by escalation

This change removes `tierByRisk`'s raise of `develop`: a heavy change gets a deeper review (change 2's agent reviewer),
not a stronger builder. The raise is configuration today (`system.policy` v6 holds
`tierByRisk: { heavy: { develop: frontier, review: frontier } }`). Dropping `develop` from `heavy`, through a
`policy-change` approval, needs no code change; `review` stays at frontier.

`develop` moves to frontier only by an escalation decision: on a task's second attempt after a failed check or a
confirmed finding, or by the lead's recorded reason. An escalation starts a fresh session. Where it helps, the escalation
is a short frontier **plan** step, read by a standard builder.

**ADR.** An amendment to ADR-0073. **Measure.** Frontier share of Claude cost; acceptance by tier.

### 5. A goal is decomposed into small tasks

**Change.** Two parts, with no new engine step. The planner advises and the lead files
([ADR-0028](../decisions/adr/0028-local-lead-final-authority.md)).

- **`decompose`**, a template of `profile-software-development`: one step, `plan:1`, needing only `reason`, so a website
  Worker takes it first ([nodes](../reference/workflow-templates.md#decompose)). It answers with tasks that each have a key,
  a title, a goal, criteria a check names, and `dependsOn` by key. Each task is one independently testable behaviour
  ([PROP-0022 task sizing](0022-lean-core.md#task-sizing)); a docs task depends on its code task.
- **`board_propose_plan`** (`mcp-board` 1.6) files the plan: every task or none, in one transaction
  ([a plan of tasks](../design/board.md#a-plan-of-tasks)). It is refused before anything is stored for a cycle, a key named
  twice, an unknown dependency, or two tasks writing one subject. Each task is `proposed` and becomes ready once its
  dependencies are done, so independent tasks run at once.

**Switch.** The profile's row; the tool is the board's. **Measure.** Tasks per goal, their sizes, attempts per accepted
result (2.47 today), created-to-landed time (goal 4).

### 6. More work runs at once

Claude now takes only `code`, so its slots build instead of reviewing. Dispatch's bounds (`maxRunning`, per project, per
account) rise with the Workers the operator adds. Write conflicts are already prevented by `writes`
([board](../design/board.md)). Within one attempt, the required checks and the review run in parallel on `T`
([PROP-0022 change 3](0022-lean-core.md#3-one-attempt-develop-then-checks-and-one-review-then-land-workflow-profile)).

**Switch.** The operator's `dispatch` configuration. **Measure.** Tasks running at once; Worker idle time while work is ready.

## Rollout

1. Change 1 (configuration): the roles, Antigravity on (review and `validation`), more Gemini API Workers. Live check of
   Antigravity as a writer.
2. Change 3: the ceiling, turn caps, and default budget.
3. Change 4 with PROP-0022 change 4.
4. Change 2 behind its switch: on for `light` and `standard` risk first, beside an agent review for one week (both run; only
   the agent review gates). Then on alone.
5. Change 5, then change 6 as Workers are added.

Each step is measured over a week of self-build before the next.

## Risks

- **Website review misses what an agent reviewer finds.** Step 4 runs both in parallel first. Heavy changes always get an
  agent reviewer. Escaped defects are compared by reviewer family.
- **A packet leaks what should stay local.** It is classified and egress-checked like every website input; a
  `local-private` subject never goes to a website Worker.
- **Fresh sessions lose context the transcript held.** The dossier and the brief carry the diff, findings, and checks.
- **Budgets end good work.** The values are pilot values, read weekly.
- **Antigravity as a writer is unproven.** It reviews and validates until a live check shows it writes within its sandbox.
- **One website account is a bottleneck.** Routing falls back to agent reviewers.

## Alternatives considered

- **Claude reviews at the standard tier only.** Cheaper, but it keeps the build and its review in one family, and still
  spends Claude quota.
- **The Lead writes the code and System only reviews and researches.** Fewer tokens, but System would no longer build
  itself (owner decision 1).
- **Raise prompt caching and keep the pipeline.** Cache reads are already 98 % of input; the cost is the volume re-read,
  not the rate.

## Decision

Accepted by the operator on 2026-11-03. The open questions were answered as follows:

1. **Yes.** The System repository is public, so its diffs may go to website Workers as `operator-shared`.
2. **One approval covers the whole plan.** A plan filed with `board_propose_plan` waits for one verdict, not one per task.
   This is not built yet: today each of a plan's tasks waits for the policy's verdict as any proposal does.
3. **The pilot values are the starting points:** a 50 k context ceiling, 6 USD an attempt, and turn caps of 16 (build), 8
   (fix) and 12 (review), read weekly. The live patch caps a Claude build at 30 turns for now, since build averages 28 today.
