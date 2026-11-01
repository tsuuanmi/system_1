---
id: PROP-0022
type: proposal
status: accepted
owners: [operator]
created: 2026-11-01
summary: No new features. System is made small and fast around what it is for: route work to the right Worker, durable runs that survive a restart, independent review, checks before landing, and quota and usage accounting. The command rules the project already wrote are put in force, and the policy allows a sandboxed Bash call it does not forbid or ask for, so a command rarely waits on the operator (a quarter of all agent runs end on such a wait today); a call that still asks waits inside the live query for a bounded time; the ledger counts a resumed session's spend once (3.9 times too high today); an attempt is develop, then the required checks and one independent review in parallel on one exact tree, at most two fix rounds, then landing; a step's tier is set by the step; the operator decides merges in a batch, and, if the operator reverses D56, a light change lands on its own; little-used parts are turned off and frozen. Target: a small task accepted in 20 to 30 minutes from ready (median 1.6 hours to done today), with quality held, each change switched and measured.
evidence: [operator request 2026-11-01, docs/research/lean-core-2026-11-01.md, docs/research/model-routing.md, System runs run_e0e7591e03d02a95, run_fe9811153a832a00, run_1502579e9af30240, run_eec67360b1246709, review runs run_523389e965124793, run_c2f305b07b4ec54b, run_a93019aaa87dfabe, run_50df07bbe48476f0]
related: [PROP-0016, PROP-0018, PROP-0021, ADR-0038, ADR-0039, ADR-0060, ADR-0067, ADR-0070, ADR-0071, ADR-0073, ADR-0075, ADR-0077, ADR-0078, INV-2, INV-4, INV-5, INV-8, INV-9, INV-12, INV-13, INV-15]
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
  session is resumed by a new run; the project's command rules for tests and read-only checks are
  not in force, because the studio policy holds none;
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

1. A small task (one independently testable behaviour) is accepted for landing within 20 to 30
   minutes of ready, at the median; a light-tier task, if change 5b is decided, lands within that
   time.
2. Under 2 % of agent runs end on a wait for an approval (25 % today); a wait within the bound of
   change 1 ends none.
3. Usage and cost figures are right.
4. The operator's decisions fall to at most 10 a day for the `system` project.
5. Quality does not regress: escaped defects, reverts, and failed required checks after landing
   stay at or below the week of 2026-10-25.
6. Parts with no measured use are off and frozen, and removed after 30 days unused by a separate,
   decided change.

### Where the 20 to 30 minutes come from

From the baseline week (per agent run, so a step of several runs takes longer): develop median 3.9
minutes (p90 16.6), review 0.9 (p90 2.0), fix 5.3 (p90 15.9). A run's wall time today is 37 minutes
at the median, of which an agent is busy 26; the gap is approval waits and serial steps. Removing
the approval-ended runs, self-review, per-finding verification, and the serial order of checks and
review leaves develop, one review beside the checks, and at most one fix round at the median. The
required checks' own duration is not in the store's records and is measured in the first week. The
target is an estimate to be measured, not a promise.

## Non-goals

- New seams, protocols, record kinds, or templates. Changes reuse what exists (command rules, the
  approval queue's batches, the brief and the task's dossier, `tierByRisk`, enforce switches) and
  add a switch or configuration key only where a behaviour changes, so it can be reversed.
- A model classifier in place of the operator for asked calls. Its published miss rate (17 % on
  real overeager actions) is too high to replace a gate.
- Line-level clean-up, which [PROP-0018](0018-lean-code.md) covers.

## Evidence and research

[Lean core research](../research/lean-core-2026-11-01.md) holds the measurements, the code facts,
the cited external evidence, and the four live System runs (three brainstorms and one research)
that chose the options below. The research run's verdict applies to all of them: the mechanisms
are documented, but no study proves the whole pipeline. A team review of the first draft
(`run_523389e965124793`, ChatGPT and Claude) found seven blocking issues: the sandbox and the
policy's precedence, the wait's fallback, merges that always ask, the review cycle count, and
parked parts that kept parts need. Its re-review (`run_c2f305b07b4ec54b`) confirmed all of them
resolved and found three more, also addressed here: one writer for a verdict that races the wait's
bound, the author's acceptance kept apart from the fix's verification, and the review's subject
across a rebase. A last check (`run_a93019aaa87dfabe`) asked for the compare-and-set to be stated
and for a moved target to be read again before an automatic landing; a final check
(`run_50df07bbe48476f0`) asked for a binding left `decided` by a host stop, which fails closed. All
are stated here.

## Proposed design

Six changes, in the order they land. Each names its switch, what it measures, and the ADR it needs.

### 1. A command rarely waits, and a wait does not end the run (approvals)

**Now.** The gate is a PreToolUse hook on every tool call. On `ask` it returns `defer`, the SDK
ends the turn, the run fails as `config_error`, and the engine resumes the session in a new run
after the approval ([a deferred tool call](../design/workflow-engine.md#a-deferred-tool-call)). The
studio policy holds no `commandRules`, so the project's rules for tests and read-only checks
([command rules](../design/approvals.md#command-rules), T326) are not in force.

**1a. Put the command rules in force (configuration, first).** A `policy-change` approval adds the
project's `commandRules` to the studio policy, and the T326 option rules go from `warn` to `on`. No
code. This alone removes the asks for the project's tests, type checks, and read-only git.

**1b. The policy allows a sandboxed Bash call it does not forbid or ask for.** The policy, not the
sandbox, decides ([ADR-0038](../decisions/adr/0038-confined-commands-for-claude-code-workers.md):
"the sandbox confines where it can act, the policy decides whether it should"). The autonomy policy
gains one rule for the `command` class: in a `workspace-write` run whose two confinements the probe
proved (the host's read confinement, which hides every agent's credentials and the paths of
ADR-0024's list; and the SDK sandbox, which allows writes to the worktree only, no network, and
`allowUnsandboxedCommands: false`), a Bash call that no
`forbid` or `ask` rule matches is `auto`. The order is the policy's own: `forbid`, then `ask`
(for example `git push`, `curl`, `ssh`, a package manager's network commands, anything naming a path
outside the worktree), then this rule, then the class default. A call the sandbox would refuse
(a write outside the worktree, a connection) is not asked for: it fails inside the sandbox and the
model sees the failure, as today. A call that asks to run unsandboxed is never allowed. Each
allowed call is an autonomy decision (INV-13), as today. This changes the policy's defaults, not the
sandbox, and so it is a change to the trust boundary, decided by the operator through the queue.

**1c. An asked call waits inside the live query, bounded.** The hook returns `ask` at once, so its
own timeout (600 s) never runs out; the wait is in the runtime's `canUseTool` callback, which holds
the call while its request is pending, for at most `approvalWaitMinutes`. An approval runs exactly
the call the request names (INV-5); a rejection returns the denial to the model, which continues.
When the bound passes first, the callback denies with `interrupt`: the query ends, the run ends as
today's deferred run naming the request, and an approval later resumes the session through
today's path, where the hook finds the bound request and lets the exact call run once.

One writer decides which path a verdict takes (INV-15). A verdict is written only to its request,
in the queue, as today; it never moves the run. The request is bound to the waiting run in the
store, as a deferred request is today, and only two writers move that binding, each by a
compare-and-set from `waiting`, so exactly one succeeds:

- the live callback, when it reads a verdict on the request: `waiting` to `decided`; on an
  approval it runs the exact call, once, and on a rejection it returns the denial to the model at
  once;
- the bound's timer, the query's end for any other reason, or reconciliation after a host stop:
  `waiting` to `deferred`, with the reason (`bound`, `ended`, `host-stop`) in the deferral event.

A `deferred` binding is consumed only by today's deferred path, which reads the request's verdict,
whenever it was written, and resumes the session only after the run's agent process is known gone
(the liveness verdict, ADR-0056), so an old and a new invocation never both hold the session
(INV-4). That path lets the exact call run once, as today (INV-5).

A binding left `decided` by a host stop is never replayed (INV-4): whether the approved call ran is
not known, so reconciliation fails the run closed, as it does any started agent run it cannot
account for, the approval is spent, and the call, if the model makes it again, asks again (INV-2).

A wait's bound is the lesser of `approvalWaitMinutes` and the run's remaining time (INV-9); either
way its end is recorded as `bound`. A run that waits is
`running`; its liveness shows the pending request, so the stall check does not count the wait as
silence. These are the existing binding, liveness, and reconciliation records, and the existing
deferral event gains its reason; no new record. The `workers` contract does not change: a run still
ends with a result or a failure, and goal 2 counts the deferral events whose reason is `bound`.

The bound matters only for what 1a and 1b leave asking (pushes, network, the unusual), which is rare
by design; those requests are sent to the operator at once (`notify`), not held for a batch.

**Codex** keeps `approvalPolicy: never` inside its sandbox: a blocked command fails back to the
model, never to a resume; the Codex SDK has no channel to answer an approval inside a turn.

**Switches.** 1a is the policy (reverted by another policy change). 1b is the rule in the policy
plus `agent-workers.enforce.sandboxedCommands` (`off`, `warn`, `on`; ships `warn`, which records
what it would allow and still asks, so the operator sees the calls it would allow before deciding
the policy change). 1c is `approvalWaitMinutes` (ships `0`, which keeps `defer`).

**ADR.** One new ADR records 1b as a policy rule under ADR-0038 and supersedes ADR-0039's
"a run deferred on an approval ends as a failure" with 1c. Before 1c is switched on, a supervised
check on the pinned SDK proves four things: the hook's `ask` reaches `canUseTool`; a pending
callback holds the query for the bound; `deny` with `interrupt` ends it cleanly; and the resumed
session's re-issued call matches the approved request.

**Measure.** Agent runs that end on an approval (goal 2), command requests a week, the asks 1b
would have removed (its `warn` records), attempt wall time.

### 2. The ledger counts each session's spend once (resources)

**Change.** The runtime reads a resumed session's result as a running total, which the SDK
documents ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)). A run's own
spend is its result minus the session's latest result already recorded in the ledger:

- the first result of a session is recorded as it is;
- a run that ended with no result leaves its spend in the next result's difference; that record
  says so (`includesUnrecorded`), and the earlier run stays a `usage.unknown` fact, as today;
- a difference that is negative in any counter (a reset, or a session the ledger saw only in part)
  is recorded as the full result, flagged `notDifferenced`, never as a negative or a zero (INV-2);
- one session is resumed by one run at a time (INV-15), so there is no fork to divide.

A migration recomputes stored records the same way, from the original figures, which stay in each
record's `record` column; it is idempotent (it recomputes from the originals, never from its own
output).

**Switch.** None for the counting: a double count is a defect. The migration can be re-run.

**ADR.** None; the `usage-record` semantics in the [reference](../reference/schemas.md) gain the
rule above.

**Measure.** The week's recomputed totals equal each session's latest result summed over sessions;
the `workers` conformance suite gains a resumed session's case under its existing contract.

### 3. One attempt: develop, then checks and one review, then land (workflow, profile)

**Now.** develop, self-review, verification of each finding, fix, re-review, review, verification,
an approval-gated fix, re-review (up to 3 reviews), a second-family review on a heavy change,
checks, digest, merge approval, rebase and recheck, land.

**Change.** The `algorithm-development` template, when the profile's configuration says
`pipeline: lean` (one key, `profile-software-development.pipeline`; the template keeps its name):

```text
develop:1 ─► tree T ─┬─► required checks on T ─────────────┐
                     └─► review:1 on T (other family) ──────┴─► both pass on T ─► land
                          (heavy: + review:1:second)         └─► a fix ─► tree T' ─► both again on T'
```

- **One subject.** The required checks and the review run in parallel on one exact tree `T`. A fix
  makes a new tree; every result bound to an older tree is stale and ignored (INV-5, as the
  exact-subject gate does today). Acceptance needs both results on the same tree. Landing then
  follows [ADR-0068](../decisions/adr/0068-an-accepted-result-is-rebased-onto-its-target-and-checked-again-before-it-lands.md)
  unchanged: the accepted change is rebased onto its target and the rebased tree is checked again,
  not reviewed again; a conflict's resolution is the author's, recorded, and the merge request says
  so.
- **Self-review off.** Its agreement with the independent review is near chance (kappa 0.17) and
  self-review is weak in the literature.
- **A finding blocks only when confirmed** ([ADR-0075](../decisions/adr/0075-a-review-finding-has-a-severity-and-only-a-verified-important-one-blocks.md)).
  Two questions are kept apart: is the finding real, and does the fix resolve it. The author's fix
  step is shown the important findings first and answers each one: `accept` or `dispute` with
  evidence. A finding the reviewer raised and the author accepts is confirmed as real, by two
  parties, so no third read is spent on it. A disputed finding is verified by a second reviewer, as
  today, before the fix goes on. A finding the author answers with neither is confirmed (INV-2).
  Whether the fix resolves a confirmed finding is never the author's word: the re-review on the
  fixed tree `T'` and the required checks on `T'` decide it, as they do today.
- **At most two fix rounds.** `maxReviewCycles` counts reviews, the first included; it stays 3,
  which allows two fix rounds. A review that still has a confirmed important finding after the last
  round ends the attempt as `changes`, as today: the task's next attempt starts fresh (change 4) or
  the lead decides.
- **No remediation approval.** A fix is part of the attempt; the merge decision (change 5) remains
  the operator's gate on what lands.
- **Digest after landing.** The task's digest leaves the critical path: `workflow.digestsPerHour: 0`
  (it bounds only the digests of task results), and a digest on request.

**Switches.** `profile-software-development.pipeline` (`full`, today's graph; `lean`); the policy's
`remediation` class (`ask` today, `auto` under `lean`); `workflow.digestsPerHour`. `pipeline: full`
restores every step, so self-review can still be run as an A/B.

**ADR.** One new ADR records the `lean` pipeline and amends ADR-0075 (an author-accepted finding is
confirmed; verification only on a dispute); it reverses T267's self-review step for `lean`.

**Measure.** Attempt wall time, fix rounds per attempt, findings disputed and their verification
outcomes, escaped defects and reverts (goal 5).

### 4. A step's tier is set by the step; a new attempt starts fresh (routing)

**Change.** Each template step names its own minimum tier; `tierByRisk` raises only `develop` and
`review:1`:

| Step | Tier |
|---|---|
| develop | standard; frontier on a heavy change or on a task's second attempt |
| fix | the develop session's tier, since it continues that session (standard unless develop ran at frontier) |
| review:1, review:1:second | standard; frontier on a heavy change |
| re-review | the tier of the review it repeats |
| verify (a disputed finding) | standard |
| digest, tally, triage | economy |

Today a fix takes the tier of the step it fixes, so a frontier review made a frontier fix; under
this table a fix follows its session. A failed required check, or a second fix round, raises the
next step one tier, recorded as an escalation decision, as today.

**Sessions.** A fix continues the develop session within the attempt. A new attempt starts a fresh
session from its brief and the task's dossier
([ADR-0070](../decisions/adr/0070-workers-that-share-no-session-work-through-a-tasks-dossier.md)):
the previous attempt's diff, its checks' output, and its open findings, which the brief already
carries ([board tasks](../design/workflow-engine.md#board-tasks)). The previous attempt's
transcript is not resumed.

**Switches.** The template's tiers sit in the profile's `Config` (`tiers`, by step); the policy's
`tierByRisk`; `workflow.resumeAcrossAttempts` (`true` today, `false` under `lean`).

**ADR.** An amendment to ADR-0073 (tiers per step).

**Measure.** Frontier share of steps and of cost per accepted result, acceptance by tier, the
largest session's size.

### 5. The operator decides what only the operator can (approvals, dispatch, landing)

**5a. Without reversing a decision.**

- `dispatch` is `auto` for ready tasks of an active project with a charter, within dispatch's
  existing bounds and breakers (the policy's own mode).
- Remediation approvals go (change 3).
- Merges are decided in the queue's existing batches: one verdict covers a batch, and each request
  in it stays bound to its own base and head (INV-5). The rebase and its recheck run before the
  request is asked, as today
  ([ADR-0068](../decisions/adr/0068-an-accepted-result-is-rebased-onto-its-target-and-checked-again-before-it-lands.md));
  a target that moves after the verdict makes the merge ask again on the new base and head. Within
  this binding, a batch helps only for results on different targets: on one target, landing the
  first member moves the target for the rest, which ask again. Landing a batch on one target in
  order under one verdict changes what a merge approval binds, and is part of 5b.

**5b. Only if the operator reverses D56.** [ADR-0060](../decisions/adr/0060-an-accepted-result-lands-on-the-operators-merge-approval.md)
puts `merge` in `ALWAYS_ASK` by the operator's decision D56, and a policy that gives it `auto` is
refused when loaded. A light-tier change landing on its own needs a new operator decision and a new
ADR superseding that part of ADR-0060. If decided: `merge` leaves `ALWAYS_ASK` for the light tier
only; the light tier is computed by the policy's path map at the target's tip on the exact diff
([ADR-0071](../decisions/adr/0071-a-changes-risk-tier-comes-from-the-policys-path-map.md)), never by
the change's own files; a change lands only when its required checks pass on the exact rebased
tree, its review had no confirmed important finding on the accepted tree, and the rebase needed no
conflict resolution (a resolved conflict is a change no reviewer read, so it asks); the landing is
recorded as a `merge` decision by System with those references (INV-13); and an escaped defect of
an auto-landed result is recorded through `board_escape`, which the metrics count against goal 5.

The landing queue holds one landing per target at a time
([ADR-0077](../decisions/adr/0077-landings-queue-per-target-branch-one-at-a-time.md)), and its
update of the target is a compare-and-set against the tip the rebase, the checks, and the tier were
computed from. If the target moved, nothing lands: the change is rebased again, its checks run
again, its tier is computed again at the new tip, and the conditions above are read again; any one
failing makes it ask. The same rule lets the members of a batch verdict land in order on one target
(5a), each under the verdict only while its rebase is clean, its rebased change is the reviewed
change (the same `git patch-id`), and its checks pass; this changes what a
merge approval binds (the reviewed change and those conditions, not one base and head) and is part
of the same operator decision and ADR.

**Switches.** The policy (`dispatch`, `remediation`); for 5b, the policy's `merge` mode per risk
tier once ADR-0060 is superseded.

**Measure.** Operator decisions a day (goal 4), unattended completion, escaped defects of results
that landed without a person.

### 6. Park what is not used (bundle)

A parked plugin's row is turned off in the bundle and its package frozen: no change except a
security fix, its tests still run. A parked library with no row is only frozen. Three changes, by
risk:

| Change | Parts | Evidence |
|---|---|---|
| 6a | `feedback-core`'s experiments, evaluations, and statistics (frozen; no package imports them); `gateway-anthropic`, `gateway-responses`; `runtime-antigravity-cli`, `runtime-acp`; the dispatch advisor; the templates `panel`, `panel-led`, `study`, `investigate`, and the stand-alone `develop` template (not the `develop:1` step of `algorithm-development`, which has its own definition) | no runtime use; 16 gateway conversations ever; rows already off; 0 advice; 1 to 4 runs each |
| 6b | `scheduled-review`; `digest-extractive` | 6 runs, all failed; the second provider of one seam, row off |
| 6c | enforce switches that are `on` and were never set otherwise, removed with their `off` path | one value in practice |

Not parked, though rarely used, because a kept part needs it: session handoffs (`workflow`'s
sessions), board escapes (goal 5's escaped defects), board breakers (dispatch's bounds, INV-9), and
`check:reviewer-eval` (`scripts/experiments`, a required check that imports none of the parked
packages).

**Switch.** The row's `disabled` in the bundle, or `system plugin` at runtime
([ADR-0078](../decisions/adr/0078-a-plugin-or-a-mechanism-is-turned-off-at-runtime.md)); 6c has none,
it removes switches.

**Measure.** Each parked row's events and tool calls over 30 days, read from the event log; a part
with none is proposed for deletion in its own change, which supersedes the ADR that introduced it,
on the operator's decision.

### What stays

The store, leases, event log, and reconciliation (INV-4); the workflow engine's task, attempt, step,
and result; the Claude Code and Codex runtimes, worktrees, both confinements; the board, with its
escapes and breakers; the approval queue for merges and for calls the policy asks; the required
checks and serialized landing ([ADR-0077](../decisions/adr/0077-landings-queue-per-target-branch-one-at-a-time.md));
the resource ledger; the website Workers and `turns` for `ask`, `research`, and `brainstorm`; the
MCP server, CLI, and `/ui`.

### Task sizing

A board task is one independently testable behaviour with criteria a command can check. A task
whose develop step runs past 15 minutes, or whose criteria need new behaviour in more than one
test file, is split by the lead before it is ready. This is a heuristic to measure, not a gate: the
evidence does not support a line-count limit.

## Alternatives considered

- **Keep the pipeline and cap cycles only** (brainstorm option B1): leaves 59 % review-type steps.
- **No review on the light tier** (B4): drops the one independent check a light change has; the
  review is short (median 0.9 minutes).
- **A self-review A/B first** (B3): the research run favoured it; the brainstorm chose to switch it
  off. `pipeline: full` keeps the A/B possible.
- **Verify every finding** (today): a third read of findings the author already accepts.
- **The sandbox as the authority** (the first draft): reverses ADR-0038's split; replaced by a
  policy rule (1b).
- **A model classifier before the operator** (A4): miss rate too high for a gate.
- **Delete unused parts now** (F3): not reversible if a use appears.
- **Fresh sessions for every step** (D3): loses the develop context a fix needs.

## Validation plan

- Each change ships with its switch at today's behaviour (or `warn`), on the test profile first,
  then on the live install, one change at a time.
- The baseline is the week of 2026-10-25 to 2026-11-01, its ledger figures recomputed by change 2.
  After each change, one week or 30 finished tasks is read with `system metrics` and `system
  report`.
- A change is kept only if goal 5 holds: escaped defects and reverts per 100 landed, required checks
  failed after landing, and findings confirmed after landing do not rise.
- The crash suite covers 1c (a host stop while a call waits in the query: the liveness verdict, then
  the deferred path) and 3 (a host stop between the parallel checks and review; a stale result after
  a fix is ignored).
- Conformance: the `workers` suite gains a resumed session's usage case (2) and an asked call that
  waits and one that passes the bound (1c), under its existing contract.

## Rollout and rollback

Order: 1a (configuration), 2, 1b in `warn`, then `on`, 1c, 3, 4, 5a, then 6a, 6b, 6c; 5b only on the
operator's decision. Each is reversed by its switch; a parked row is turned back on with
`system plugin`; change 2's figures can be recomputed from the originals.

## Observability and operations

`system metrics` and `system report` already measure every goal; they gain no metric. A run whose
call waits in the query shows the request in its liveness, in `status` and the roster. The runbooks
change: [a deferred tool call](../operations/runbooks.md#a-workers-tool-call-is-deferred-on-an-approval)
for 1c, [change the autonomy policy](../operations/runbooks.md#change-the-autonomy-policy) for 1a and
1b, and [accept or reject a review](../operations/runbooks.md#accept-or-reject-a-review) for 3 and 5.

## Security and privacy

Every loosening, and what holds it:

- **1a** puts in force rules the operator already wrote, through the queue.
- **1b** lets a Bash call run without a person when the policy forbids or asks for nothing about it
  and the proven sandbox holds it to the worktree with no network. A call that leaves the sandbox
  fails; a call the policy names still asks; no sandbox, no Bash (INV-2). It is a trust-boundary
  change and is decided by the operator through a policy change, in `warn` first.
- **1c** changes how long an asked call waits, not who decides it: the operator still approves the
  exact call (INV-5).
- **3** drops self-review and the third read of accepted findings, and the remediation approval; the
  independent review on the exact tree, the required checks, and the merge decision remain. Goal 5
  measures the effect, and `pipeline: full` restores it.
- **5b**, if decided, lets a light change land without a person, only on its checks on the exact
  rebased tree, a review with no confirmed important finding on the accepted tree, and a rebase
  with no conflict resolution, the tier computed by the target's path map.
- **6c** removes only switches that were never used to turn a mechanism off.

Egress (INV-12) and credentials (INV-8) are unchanged.

## Compatibility and migration

Change 2 migrates `resource_usage` (recompute, originals kept). Change 3 adds a pipeline; a run
started before it finishes on its stored spec. Old runs of parked templates stay explainable. No
MCP tool, CLI command, or seam contract changes.

## Decision

Accepted by the operator on 2026-11-01 (D113: "implement it as proposed"). Two parts stay the
operator's own decisions and are not taken by that acceptance:

- **1b** ships with `agent-workers.enforce.sandboxedCommands: warn`. D114 (the operator, 2026-11-01,
  on a System brainstorm's choice): `warn` for 7 days or 300 would-be decisions, whichever is later
  and at most 14 days; every recorded call is audited (arguments, working directory, rule matches,
  sandbox state); `on` only if none would have written outside the worktree, reached the network,
  read a sensitive path, or broken the `forbid`, `ask`, sandboxed order. One confirmed violation
  turns it back to `warn`.
- **5b**: D115 (the same day and way) reverses D56 for the light tier only after the `lean` pipeline
  has run 7 consecutive days and at least 30 eligible light results, with escaped defects and
  reverts not rising; the conditions of 5b apply, with a kill switch. One escaped defect or revert
  of an automatically landed light result in 14 days, or a non-light path in a light landing,
  turns it back. Until then a merge always asks, and 5a holds.

Changes 1a and 5a's policy modes are the operator's policy changes through the queue.

## Implementation

Board tasks of project `system`, each one change with its own ADR or document updates, landed by
System: T361 (change 2), T362 to T364 (change 1), T365 to T367 (change 3), T368 and T369
(change 4), T370 (change 6a and 6b). The [roadmap](roadmap.md#lean-core-prop-0022) tracks them.
