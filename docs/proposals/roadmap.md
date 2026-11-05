# Roadmap

Non-normative. This is the queue of open milestones, from PROP-0010,
PROP-0011, PROP-0013, and the other accepted proposals. It orders the work and says what
remains. Done milestones are removed; Git keeps them. What each release stage must deliver
is in [release scope](../requirements/release-scope.md). What was verified on live accounts,
and when, is in the [release checklist](../validation/release-checklist.md)
([status ownership](../README.md#status-ownership)).

## Priorities

Set by the operator on 2026-10-22 ([PROP-0010](0010-base-version.md)):

1. **The core and the Claude Code Worker first.** The next release is Base (v0.8).
2. **Everything has a schema and a clear protocol**
   ([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md)).
3. **Website Workers and API or local model Workers after Base.** Their open items wait; their
   conformance suites keep running.
4. **Deep Research is future work** ([below](#future-work)).

Set by the operator on 2026-11-05
([ADR-0086](../decisions/adr/0086-production-is-the-lean-core-judged-by-reliability-targets.md)):

5. **Production (v1.0) is the lean core, hardened**, judged by the reliability targets R1 to R4
   ([exit criteria](../requirements/release-scope.md#production-ready-exit-criteria)).
6. **No new features until v1.0.** An accepted increment that moves no target waits; the operator
   may grant an exception for a change that directly moves one.

## Next: Base (v0.8)

Base exit criteria are in [release scope](../requirements/release-scope.md#base-v08).
B2 to B9 are in order; B6 needs B5, B7 needs B6, B8 needs B7, and B9 needs B6 and B7.

| Milestone | State | What remains |
|---|---|---|
| **B2** Resource ledger and metering | mostly done | Transcript reconciliation; then failing closed for metered pools, with its own ADR; the metering oracle against `ccusage --json`; the live checks of the limit readings ([limit readings](../design/agent-runtimes.md#limit-readings), [conformance](../design/resources.md#conformance)). |
| **B3** Claude Code Worker first-class | built, live checks open | Live checks of a Claude Code Worker under both confinements ([release checklist](../validation/release-checklist.md)); the worktree setup's command in the studio policy and the setup of the `system` repository on the live host; `validate` runs in B8's [`algorithm-development`](../reference/workflow-templates.md#algorithm-development) template. |
| **B4** Board and charter | built, open items | A budget is enforced before each step, never inside one, so a step in flight can overdraw its last lines; stopping an agent run at its next turn waits for step 2 of [ADR-0047](../decisions/adr/0047-a-run-stops-at-a-boundary-once-its-task-budget-is-spent.md), until the live install shows real overdraws. A lead cannot propose its own funding lines. Only a Worker source with a worktree per run writes `TASKS.md`, and the `workers` contract does not state that source's part. |
| **B5** Approval queue | in progress | A deferred run's project (no trusted envelope names an agent run's project); a planner's plan gate on the queue ([where the gate leaves room](../design/approvals.md#where-a-workers-gate-leaves-room)); no proposal for a policy the policy cannot say as narrowly as a command's argv ([where a policy change leaves room](../design/approvals.md#where-a-policy-change-leaves-room)). Codex and Antigravity CLI Workers keep their rows off until verified live. |
| **B6** Brief and digest | built, open items | Team and remediation prompts stay engine-composed text ([ADR-0040](../decisions/adr/0040-briefs-on-the-workers-and-workflow-seams.md#amendment-2026-10-23-digests-on-a-tasks-result-and-usage-spent-on-a-task)); no test output is parsed before the digest Worker reads it; a run outside the board is digested on request only. |
| **B7** Plugin manifest | built, open items | Base automates no lifecycle step (shadow runs, canary splits, promotion on the task suite); a row changed while the host runs is recorded at its next start; a veto point in the DSH loader, with its own ADR, to refuse a plugin the manifest check finds something in. |
| **B8** Pilot and baseline | in progress | The operator's pilot: one project of at least five working days, a restart, the baseline against Claude Code alone ([pilot runbook](../operations/pilot.md), [release checklist](../validation/release-checklist.md)). The report does not give quota lost at reset. Until the live install configures the required checks per repository, the operator accepts every result ([a run's required checks](../design/workflow-engine.md#a-runs-required-checks)). |
| **B9** Evolution | built, one item open | The same comparison on the pilot's live Worker, in tokens. After a provider swap, the report counts attachments but not the other provider's claims. |

## Feedback loop (PROP-0011)

What each milestone delivers is in [PROP-0011](0011-feedback-loop.md#milestones). The operator
started F1 on 2026-10-23, in parallel with the Base pilot (B8).

| Milestone | State | What remains |
|---|---|---|
| **F1** Specification | built, acceptance open | The operator's acceptance of [ADR-0045](../decisions/adr/0045-feedback-loop-guarantee-seams.md) and [ADR-0046](../decisions/adr/0046-evaluation-and-promotion-integrity.md) (INV-16 and INV-17 join the invariants then); how a trial's run is fixed to its arm's Workers (Q2, an ADR of F4 or F5). |
| **F2** Statistics | built, open items | A Monte Carlo test above 20 cases (no record holds its RNG state and sample order yet); a `bootstrap` method for the review contract's ratio primary and a method for a level's interval; refusing at start what the library cannot analyse. |
| **F3** Experiment registry | not started | `experiments`: exact identity, fingerprints, the four registry answers, retry predicates, lessons. |
| **F4** Offline evaluation runner | not started | `evaluations`: pinned and sealed paired trials as board tasks, cost from the resource ledger, the verdict rule. |
| **F5** Review contract and suite | not started | The `review` objective contract; a three-partition suite seeded from [self-build](../validation/self-build.md); collectors. |
| **F6** Controller and promotion | not started | The `improve` template; promotion bound to the exact evaluation and subject. |
| **F7** First experiment | not started | Worker agnosticism on `review`, the acceptance test of v1. Needs Codex CLI and Antigravity CLI Workers admitted as review members on the live host ([ADR-0049](../decisions/adr/0049-read-only-agent-workers-as-review-members.md), proposed). |

## Feedback from work (PROP-0013)

Phases and their order are in [PROP-0013](0013-feedback-from-work.md#phased-plan). The
operator accepted it in part on 2026-10-24 (D32): each phase starts on the operator's
go-ahead. The code-host observer and landing wait until the pilot (B8) produces PRs.

| Phase | State | What remains |
|---|---|---|
| **L1** Liveness rules | built, open item | A Worker without a worktree per run shares one workspace, and a new run there is not held back while an older run's liveness is `unknown` (INV-15). |
| **L2** Liveness in reconciliation | built, open item | Codex, ACP, and the Antigravity CLI report no agent process, so their started runs reach the operator as `unknown` after a restart. |
| **C1** Evidence | accepted, not started | A supervised check that the pinned Claude Agent SDK honours a `Stop` hook's block. |
| **C2** Completion gate | accepted, not started | The required checks at a Worker's stop boundary, a failure fed back in the same session, bounded, failing closed. Needs C1. |
| **C3** Checks at acceptance | built in part | Completion evidence from C2 at the stop boundary is not reported yet. Needs C2 and the operator's decision. |
| **W1** to **W4** Code-host observer | deferred | Until the pilot produces PRs (B8). |
| **W5** Landing | built in part | `apply`, MCP `land`, `system land`, and whether `merge` is always asked (PROP-0013 open question 5). |

## Dispatch by quota (PROP-0014)

Accepted by the operator on 2026-10-25 (D61 to D66). Increments are in
[PROP-0014](0014-dispatch-by-quota.md#increments).

| Increment | State | What remains |
|---|---|---|
| **D1** Ask to start, chosen by quota | built | The live day on one project ([validation plan](0014-dispatch-by-quota.md#validation-plan)). |
| **D2** Starting by itself | accepted, not started (priority by the operator, D66) | `notify` and `auto` per project; hourly bounds; per-project pause; task `priority`; `startedBy` on the roster and Home. |
| **D3** Quota in every route | built (T185, [ADR-0066](../decisions/adr/0066-every-route-orders-workers-by-their-accounts-quota-headroom.md)) | None. |

## Right worker, right job (PROP-0015)

Accepted by the operator on 2026-10-25 (D71 to D78). Start order (D75): E1, then E5, then E4
and E3, then E6, with J0 in parallel. Increments are in
[PROP-0015](0015-right-worker-right-job.md#increments).

| Increment | State | What remains |
|---|---|---|
| **E1** One quota rule | accepted, not started (first) | Capacity reads `accountQuotaOf` with the reserve; `free` in the quota score's order; `inReserve`; `mcp-roster@1.8`. |
| **E3** Fit before start | accepted, not started | The fit key and light band, shadow first, for 100 dispatched attempts with outcomes (D74). Needs E1. |
| **E4** Measured strengths | accepted, not started | Acceptance by Worker and kind, with counts (the declared split confirmed, D77). |
| **E5** Needs you | accepted, not started | One list on Home, board questions included; `board.question` notifications. |
| **E6** Handoffs | accepted, not started | `handoff@1.0`, child tasks under the board's gate (depth 1, at most 3 per attempt, D76), the `handoff` wait, fresh-context briefs for tasks the lead marks (D78). Needs E5. |
| **J0** to **J3** Jev advisor | accepted, in part | The swappable advisor in shadow is built (T196, `5bb4ee4f`). Open: its 100-attempt shadow period, visible and bounded advice behind `ctx.decisions`, and J3, which needs PROP-0011 F4. Features only, never a task's title or goal (D73). |

Per-attempt quota draws (E2) are built (T193, `7f542a70`).

## Operating model (PROP-0016)

Accepted by the operator on 2026-10-26 (D83). The target is L4 by 2028 to 2029, with selective
L5 ([maturity model](0016-operating-model.md#1-maturity-model-l0-to-l6)). The 30-day evidence
period started 2026-10-27; L3 is not claimed until the metrics show it.

| Increment | State | What remains |
|---|---|---|
| **I1** Handbook layers and the per-Worker slice | in part | Part 3, the lead's file; part 4, the docs that follow (T296 brings the docs level with the code). |
| **I2** Risk tiers and the lead-touch metric | in part | The adversarial review prompt and the decision brief; the lead-touch metric read by the weekly scorecard (I4). |
| **I3** Integration queue, attempt shielding, canary | in part | The integration queue itself (landing in order per repository, amending ADR-0060 and ADR-0068); the canary on a test task. |
| **I4** Evidence ledger and weekly scorecard | in part | Idle quota; global IDs; the weekly level reading in the report. |
| **I5** A project template | in part | The attention budget, portfolio scheduling, reporting up, global IDs, and a second project of a different kind. |

## Lean core (PROP-0022)

Accepted by the operator on 2026-11-01 (D113). No new features: each change is switched, at
today's behaviour or `warn` first, and kept only if quality holds
([PROP-0022](0022-lean-core.md#validation-plan)).

| Change | State | What remains |
|---|---|---|
| **1b** Sandboxed commands | `warn` landed (T363, `250e93dd`) | `on` after 7 days of `warn` records audited (D114). |
| **1c** A call waits in the query | not started | The bounded wait in `canUseTool` (T364). The supervised SDK check (T362, `5d93fed6`) is done. |
| **3** One attempt, one review | part 1 built (T365, `737ca1ad`) | T366 (confirmation of a finding) and T367 (parallel checks and review). |
| **4** Tiers by step, fresh attempts | part built (T369, `52387cd3`, off by default) | T368, the template's tiers by step. |
| **5a** The operator's load | not started | The operator's policy changes: `dispatch` and `remediation` modes; merges in batches. |
| **5b** Light changes land on their own | decided (D115) | The light tier's `merge` mode and its kill switch, after 7 days of `lean` and 30 light results. |
| **6c** Park what is not used, later | not started | After 30 days (6a and 6b are built, T370, `d0972f9a`). |
| **W2** Website re-reviews | not started (T372) | A scoped `review` offer of supplied evidence, `turns.reviewSteps` (off), an input bound. |
| **W3** One vendor, one family | not started (T373) | Diversity by vendor; a heavy change's second review on a website Worker of another vendor. |

## Other open proposals

Proposals with open work that no table above holds.

| Proposal | State | What remains |
|---|---|---|
| PROP-0005 Session-bound website accounts | accepted | Gemini's two-tab check on its next two-member run (P2 below), blocked by Google's challenge (operator). |
| PROP-0017 GitHub front door | accepted | G0 remainder (rulesets on `dev` and tags `v*`, auto-merge; before G2); G1 intake; G2 landing as a PR; G3 CI as evidence; G5 credentials. |
| PROP-0018 Lean code | draft | Tasks T6, T8 (operator decision O1), T9, T10, T11, T13, T14, T15, T16, T17. |
| PROP-0019 Lead logic in System | accepted | Ranks 2, 3, 5, 7, 8, 9, 11, 12, 13. |
| PROP-0023 Worker roles and token budget | accepted 2026-11-03 | Rollout steps 1 to 5, each measured for a week; change 2 (website review packets) behind its switch; change 6; owner decision 2 (one approval per plan); [ADR-0083](../decisions/adr/0083-a-budget-line-on-a-template-counts-every-accounts-pool.md) proposed. |

## Done and open milestones

| Milestone | State | What remains |
|---|---|---|
| **M1** Provider runtime and ChatGPT Web | one check open | Credential re-login past the email page (needs the operator). |
| **M3** Workers | mostly done | After Base: connectors as capabilities (`connector:<name>`) and a persistent Gemini chat (verified on the fake site only, by operator choice). Gemini Deep research is [future work](#future-work). |
| **M4** Orchestration | mostly done | Handoff envelopes. |
| **M5** Gateways | one item open | Journaled client configuration edits (REQ-HOST-3), once `system` edits a client file. |
| **M6a** Security hardening | live checks open | A signed-in Codex Worker run with reads confined and the model token ([checklist](../validation/release-checklist.md)). |
| **M6b** Operability | started | `/ui` health banner; scheduled website account probes (`system account probe` on a schedule); the DSH pin in health; a host whose required service refuses to start exits non-zero. |
| **M6c** Data lifecycle, upgrades, reliability | started | A crash test for each row of the [effect register](../architecture/data-flow.md#effect-register) that has none (moved into Base, B1 to B5). |
| **M6e** API-first composition | live checks open | After Base: an API model Worker and a local model Worker, each verified live ([models](../design/models.md)). |
| **PROP-0007** Account pools | live checks open | After Base: two concurrent `ask`s on two accounts, a two-member team on two accounts, a failover. A failover needs a provider the operator records as `pooled`; under the default `assigned`, work waits for the limit's reset ([ADR-0052](../decisions/adr/0052-accounts-are-assigned-unless-pooling-is-recorded.md)). Limit rules once a site's limit text is seen. Design: [agent runtimes](../design/agent-runtimes.md), [routing](../design/routing.md). |
| **PROP-0012** Agent accounts | phases B to F built | Phase A: the identity check on the operator's real Codex and Claude Code accounts (equal across restart, token refresh, re-login). Phase G: live checks with the operator's go-ahead (accounts assigned by default, D24; pooling on the operator's recorded acceptance, D33, [ADR-0055](../decisions/adr/0055-personal-accounts-may-be-pooled-on-the-operators-recorded-acceptance.md)). The operator's `system account migrate --apply` on the live host ([runbook](../operations/runbooks.md#migrate-agent-workers-to-accounts--roles)); acceptance of ADR-0051 and ADR-0052. Antigravity CLI accounts wait for a verified way to read their identity. |
| **Work kinds** (D35, D36) | built, live split open | The live split and a writing Claude Code Worker on the system repository, as an example patch ([route work by kind](../operations/runbooks.md#route-work-by-kind)), applied on the live host after Claude Code's confined commands and Codex's sign-in. Validating the system repository in a run's worktree. Brainstorms on the Codex or Antigravity CLI need their own decision (ADR-0049). |
| **v1.0** Production-ready release | after Base | The reliability targets R1 to R4 met over 14 days, the operational readiness items, and the open live items of the release checklist, except Deep Research ([exit criteria](../requirements/release-scope.md#production-ready-exit-criteria)). The gateways move to 1.x ([after v1.0](../requirements/release-scope.md#after-v10-1x)). |

The operator web page stays the small `/ui` page in
[`web-ui`](../../packages/plugins/web-ui/README.md); `system` does not build a UI
inside the DSH web app.

## Refactors found by review

These change no behaviour. Each lands with its tests unchanged:

- One durable-run lifecycle for website turns (`turns`), agent runs (`agent-workers`),
  and model calls (`models`): waiters, cancel, retries, and stop. Run bodies and recovery
  stay separate on purpose.

## Follow-ups from the reliability review

The review of 2026-10-16 fixed its confirmed liveness defects, with regression tests. These remain:

| Priority | Item | Why it waits |
|---|---|---|
| P2 | **Two tabs of one Gemini profile.** Concurrent turns per account are back at 2 (checked live on ChatGPT, 2026-10-18). Check the same on Gemini with its next two-member run. | It comes with the next Gemini team run. |
| P2 | **A resend after a site's own error, beyond a team member's first step.** A team member's first step is resent once ([ADR-0062](../decisions/adr/0062-a-team-members-first-step-is-resent-once-after-a-sites-own-error.md)); every other step fails as `overloaded`. | Only Gemini's driver tells the site's error; another resend needs its own decision. |
| P2 | **Provider diversity.** A family's value comes from the live descriptor, and one vendor reached through several Worker sources counts as several families ([ADR-0027](../decisions/adr/0027-provider-diversity-in-routing.md#consequences)). Record the family at routing, and allow an operator override per account. | The MVP has website Workers only. |
| P2 | **Evidence-backed review approval.** Approval stays with the Lead ([ADR-0028](../decisions/adr/0028-local-lead-final-authority.md)). A gate that requires verified findings before a run reports `pass` is a separate design. | Scope. |
| P3 | **Teams of 5 to 10 members, and ranked choice.** Contracts exist for 2 to 5 members. | No requirement yet. |
| P3 | **Engine details.** Only the first tie gets a deadline timer. Two concurrent `stop`s each record a decision. The session record labels a model Worker's runtime `local-tool`, which the INV-11 rule does not yet cover. | Low impact; each is a small change with its own test. |
| P3 | **A crashed host's remote-login display.** Its private Xvfb and VNC server stay until the host restarts. Reap them by a recorded pid file at start. | Harmless: nothing waits on them. |
| P3 | **Website-only composition.** The mounted `llm`, `llm-pi-ai`, and `models` rows are inert until a model catalog is configured. A `website-only` preset would turn them off. | It saves little and adds a preset to keep in step. |

## Future work

Not scheduled; each needs the operator's go-ahead:

- **Deep Research** on ChatGPT and Gemini: the `research --deep` check on two providers, and
  Gemini Deep research through `ask` ([release checklist](../validation/release-checklist.md)).
  The code stays and keeps its fake-site tests.
- **After Base:** new work on website Workers (connectors, Gemini chat, the P2 items above),
  live checks of API and local model Workers, Codex and ACP agent Workers.

## Later candidates

Each needs its own proposal: an A2A gateway and runtime (cross-runtime peers), an
ACP client gateway for editors, sandboxed or SSH `exec` providers, more website
providers, and a desktop launcher.
