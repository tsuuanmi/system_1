# Proposals

Proposals describe **changes under consideration**. They are evolutionary, not
current truth.

## Lifecycle

```text
draft -> proposed -> accepted -> implementing -> implemented
                  \-> rejected
accepted/implemented -> superseded
```

A proposal that is implemented, abandoned, or superseded in whole is deleted; Git keeps it
([rule](../governance/documentation.md#deleting-what-is-no-longer-current)). What it decided
lives in the design documents and ADRs.

- [Research](../research/README.md) provides evidence. A proposal frames a
  concrete change, its alternatives, validation, rollout, and risks.
- Accepting a proposal does not change production behavior by itself. Current
  truth changes only when requirements, design, source, and tests change.
- Architecturally significant choices are recorded as
  [ADRs](../decisions/adr/README.md).

## Active proposals

- [PROP-0005: Session-bound website accounts](0005-session-bound-website-accounts.md),
  **accepted** ([ADR-0030](../decisions/adr/0030-session-bound-accounts-use-their-login-profile.md)). An account whose site ties its session to the browser that signed in runs its
  turns as tabs of its own persistent login profile instead of fresh contexts from copied state,
  behind a driver capability. Copies died on Gemini (2026-10-16) and on ChatGPT (2026-10-17) while
  the profiles stayed signed in. Gemini goes first.



- [PROP-0008: `system` as a startup template](0008-studio-operating-model.md), **draft**.
  Purpose restated around five goals: use paid plans fully, fit existing workflows, delegate with
  confidence, evolve, and optimize accepted results per unit of operator attention. Projects run as
  startups from one template (charter, funding rounds, investor report). Adds the digest layer, a
  task board across runs, intake, tiers `none` and `reflex`, an autonomy matrix with batched
  approvals, a resource ledger with shadow prices, an optimization plugin bundle with a measured
  lifecycle, and an evolution loop.


- [PROP-0010: The Base version](0010-base-version.md), **accepted**
  ([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md)). The next release: the six
  core components closed and specified by schema and protocol, Claude Code as the first Worker,
  and one multi-day pilot project measured against a baseline. Deep Research is future work;
  website and API Worker work follows Base.

- [PROP-0011: Feedback loop](0011-feedback-loop.md), **proposed**. Research, hypothesis,
  experiment, evaluation, and lesson as records in the ledger of record; a deterministic core
  evaluation engine under versioned objective contracts, offline and paired, with INCONCLUSIVE
  allowed; maker, reviewer, and evaluator of different provider families; a registry that never
  redoes an experiment blindly; promotion through the approval queue. First loop: worker
  agnosticism on the `review` template.

- [PROP-0012: Agent accounts](0012-agent-accounts.md), **accepted** (D23, D24; phases B, C, D, E, and F
  built, ADR-0051 and ADR-0052 proposed). Several sign-ins per agent
  runtime (three Claude Code, two Codex CLI, three Antigravity CLI): enrollment slots are only
  homes; the account id is derived from the verified login, never named; an unverified, changed,
  or duplicate identity is quarantined; Workers are account × role with per-account concurrency,
  pools, and siblings; and a per-provider `accounts: assigned | pooled`, assigned by default and
  required for personal plans, under which a limit makes an account's work wait instead of moving
  it to another account of that provider, website accounts included.

- [PROP-0013: Feedback from work](0013-feedback-from-work.md), **accepted** in part (D32: the
  liveness verdict and the completion gate, to be built; the code-host observer and landing
  deferred until the pilot produces PRs). Three ways for a
  board task's attempts to learn from the work, as facts the core acts on: a code-host observer
  (`scm-<host>`, egress declared) that records a bound PR's CI checks, reviews, and conflicts by
  conditional polling, bound to the head SHA, and briefs the next attempt with the actionable ones,
  with landing (merge or apply) on a `merge` approval bound to the base and head SHAs; a completion
  gate that runs the required checks at a Worker's stop boundary and feeds a failure back in the
  same session, bounded and failing closed; and a liveness verdict under which a failed probe is
  never death and no automation sends input to a session blocked on an approval.

- [PROP-0014: Dispatch by quota](0014-dispatch-by-quota.md), **accepted** (D61 to D66, 2026-10-25:
  increment D1, ask to start, chosen by quota, built under
  [ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md);
  never a metered pool, a 20 % reserve of every window). System starts ready
  board tasks on free Workers by itself instead of waiting for the lead. A dispatch sweep in the
  workflow engine takes the ready tasks of active projects by priority, then age. A new action
  class `dispatch` gates each start: the shipped studio policy asks, so the operator approves by
  button, and a project may set auto. The writing step's Worker is chosen among those routing
  admits by a versioned quota score: headroom above a reserve kept for the operator, a window
  about to reset used first, unknown readings after known ones, and metered pools last and only
  inside a cap. Each choice records a reason on every candidate. Parallel runs are bounded per
  account, per project, and in total, with one task per write subject. Starts are capped per
  hour, and dispatch can be paused per project.

- [PROP-0015: Right worker, right job](0015-right-worker-right-job.md), **accepted** (D71 to D78,
  2026-10-25, every open question answered as proposed: the 20 % reserve stays the hard line for
  starts with a light band of 65 % to 80 % for measured light work; the reserve also keeps a
  dispatched run's later steps out of the operator's share, not starts made by hand; Jev sees
  features only; shadow for 100 dispatched attempts with outcomes; E1, then E2 and E5, then E4 and
  E3, then E6, J0 in parallel; a step may propose child tasks under the board's gate, depth 1, at
  most 3 per attempt; Claude Code writes code, docs, and tests, Codex validates and reviews,
  website Workers research, the Antigravity CLI validates only once it proves `validate`;
  fresh-context review on tasks the lead marks, measured; nothing built yet). From the operator's
  request of 2026-10-25 and research runs T177 to T182. One quota rule: the
  roster's capacity summary reads `accountQuotaOf` with the reserve, so "free" means what it means
  to dispatch (E1, buildable now, no new vendor). Then the quota each attempt drew, recorded from
  the account's readings; a start refused when its kind's observed draw would not fit, with a
  light band below the reserve, shadow first; each Worker's acceptance by kind measured from
  recorded decisions; one *Needs you* list on Home with board questions in it; a step's typed
  handoffs becoming child board tasks with fresh-context briefs; and Jev as an advisor behind
  PROP-0002's `ctx.decisions` seam, one query per decision with the whole distribution recorded,
  in shadow, never widening a gate.

- [PROP-0016: Operating model, a startup inside a group](0016-operating-model.md), **accepted** (D83)
  (2026-10-26, from the operator's vision of that day and the T224 brainstorm). System grows
  itself inside clear policies, and the operator keeps objectives, budgets, trust boundaries,
  irreversible actions, and exceptional risk. A maturity model from L0 to L6, each level read from
  rolling-30-day metrics (lead touches per task, operator decisions per day, unattended
  completion, time ready-to-landed, stalls, escaped defects, Worker availability, cost per
  accepted result, quota idle while work is ready). System is between L2 and L3 today, and the
  target is L4 by 2028 to 2029 with selective L5. It also covers a handbook in five layers, each
  with an owner, a version, and a check, of which each Worker gets only its slice; trust tiers for
  a new Worker or model; light, normal, and heavy process by risk; a research function the
  operator steers by direction and budget; and packaging for several projects. Increments I1 to
  I5.

- [PROP-0017: GitHub as System's front door](0017-github-front-door.md), **accepted** (D84, without the Projects mirror) (T227, from
  the operator's request of 2026-10-26). An issue an allowed person opens or labels becomes a
  proposed board task once a person approves it, and its text is data, never an instruction. An
  accepted result is pushed to its own branch and opened as a PR against its target with an
  evidence summary of ids and verdicts. It merges through GitHub's auto-merge at the exact head
  that the one `merge` approval named (D56 kept), and only when D80's conditions hold. Its required
  check runs are recorded as evidence, and a failed one reopens the task. The Projects mirror (G4) was
  dropped on acceptance. A fine-grained token or a GitHub App, held in the vault, writes only
  through the egress check. Local landing stays as the second provider of one landing seam, for
  private repositories.

- [PROP-0018: Lean code](0018-lean-code.md), **draft** (T298, from the operator's request of
  2026-10-27). A read of the whole source for what can go with the same behaviour, from line counts and
  searches: sizes by package, duplicated logic (five glob matchers, two digest providers that
  repeat one request engine, helpers copied across 14 packages), legacy paths and what a store still
  needs of them, dead exports, one removal that needs the operator's decision (the hand-named agent
  Worker rows), plugin boundaries (two parts worth a plugin, the rest engine parts that stay), 17
  ranked tasks each under about 1,500 changed lines with their guards and order, and what stays.
  It changes no code.

- [PROP-0019: The lead is a session; its logic lives in System](0019-lead-logic-in-system.md),
  **accepted** (D119, 2026-11-01; rank 6 dropped for PROP-0022 change 3, rank 8 within D115) (T324, from the operator's words of 2026-10-27, D109). About 1,400 lines of scripts and
  state files in the lead's coordination directory do eleven jobs System should do. For each:
  what System has (command rules, the lead inbox, the lead principal, auto-accept, the report), what
  is missing, the design at its seam, and its switch (off or warn, D108) and test profile case;
  `system lead brief`, the page a new lead session takes over from, with a handover note; the end
  state of a coordination directory that holds `LEAD.md` alone; and 13 ranked tasks that start
  after the core loop runs clean. It changes no code.



- [PROP-0022: Lean core, a small System that runs smoothly](0022-lean-core.md), **accepted** (D113,
  2026-11-01; 1b and 5b stay the operator's decisions D114 and D115; from the operator's request of
  that day and four live System runs). No new features. A command no longer ends
  its run while it waits for an approval (a quarter of all agent runs); the ledger counts a resumed
  session's spend once (3.9 times too high today); an attempt is develop, then checks and one
  independent review in parallel, at most two fix rounds, then landing; a step's tier is set by the
  step; the operator decides merges in a batch and a light change lands on its own; little-used parts
  are turned off and frozen. Target: a small task landed in 20 to 30 minutes, quality held.

- [PROP-0023: Worker roles and a token budget](0023-worker-roles-and-token-budget.md), **accepted**
  (2026-11-03; from the operator's decisions of 2026-11-02). Claude builds, at the standard tier; Codex and
  Antigravity review, write tests and documentation, and run the checks; website Workers ask,
  research, brainstorm, and review a change from a packet when it fits. A session stops growing past
  a ceiling, every task has a default budget, frontier is reached only by escalation, and a
  `decompose` template splits a goal into small tasks that run in parallel. Target: at most 5 USD of
  Claude usage per accepted result (52 today).

Use [0000-template.md](0000-template.md) for new proposals. The
[roadmap](roadmap.md) is a non-normative queue of milestones, not a substitute for
a reviewed proposal.
