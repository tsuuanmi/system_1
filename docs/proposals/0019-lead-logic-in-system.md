---
id: PROP-0019
type: proposal
status: accepted
owners: [operator]
created: 2026-10-27
summary: The lead is a session talking to System (operator, D109, 2026-10-27), so all logic, the lead's too, belongs in System, so the session can change, and another project's lead works the same. Today about 1,400 lines of scripts and state files in the lead's coordination directory do eleven jobs that System should do (a watcher loop, command judges, routine remediation approvals, auto-accept and auto-merge sweeps, pushing dev and syncing checkouts, a task registry, a decision log, the live profile patch history, salvage and hand landings, the morning report and health table, the handover). For each, this proposal says what System already has (the command rules, the lead inbox, the lead principal, auto-accept, the report) and what is missing, and gives the design in System, its switch (off or warn first, D108, T322) and its test on the test profile (T323). It designs `system lead brief --project <id>`, the one page a new lead session needs to take over, with a handover note the outgoing session leaves. The end state is a coordination directory that holds LEAD.md and nothing a script reads. Thirteen ranked tasks, each small and each with its switch, start after the core loop (T293b, T318b, T321) runs clean. Nothing in this proposal changes code.
evidence: [operator request 2026-10-27 (D109), D107 (the lead's inbox), D108 (everything a plugin, turn it off, test profile first), D88 (a lead per project), T319b, T320, T318b, T322, T323, T324, ADR-0076, docs/operations/lead-playbook.md]
related: [PROP-0008, PROP-0016, PROP-0017, PROP-0018, ADR-0060, ADR-0063, ADR-0064, ADR-0067, ADR-0068, ADR-0069, ADR-0071, ADR-0072, ADR-0076, INV-2, INV-5, INV-6, INV-9, INV-10, INV-13, INV-14, INV-15]
implementation: []
---

# Proposal: The lead is a session; its logic lives in System

## Problem

The operator's words on 2026-10-27 (D109): "the lead is only a session talking to System, so all logic, the lead's too, belongs in System, so the lead session can change, and another project's lead works the same."

That is not how it is. A project's lead session keeps working because of about 1,400 lines of scripts and state files in its coordination directory (`~/workspaces/system-coordination`) that decide, push, sweep, and remember. A new session cannot take over without them, and cannot read them as policy: they are not gated, not recorded as decisions, not tested, and not visible on `/ui`. A second project's lead (D88; `system project new`, [packaging](../design/packaging.md)) would have to copy them. The handover from one session to the next exists only in the outgoing session's memory.

Part of the logic has already moved into System, each time after the lead's script showed the need: the lead as a principal with a closed list of rights ([ADR-0076](../decisions/adr/0076-the-lead-is-a-principal-of-its-own-with-a-closed-list-of-rights.md)), the routine command judges as [command rules](../design/approvals.md#command-rules), the polling script as [the lead's inbox](../design/notifications.md#the-leads-inbox), and a listed branch's acceptance as `board.auto-accept` ([ADR-0067](../decisions/adr/0067-system-accepts-a-listed-branchs-result-on-its-review-and-checks.md)). This proposal finishes the move, and says what is left, in what order, and how each part is turned off.

This proposal is not normative until accepted, and changes no code. It does not rest on reading the scripts, which are outside this repository; it relies on the task that asked for it and on the lead playbook.

## Goals

1. Every duty of the lead that a rule can state is a System mechanism (a seam, a plugin row, a policy rule, and a record), decided in one place, recorded (INV-13), and the same for every project.
2. Every mechanism ships as an optional row or behind a switch, starting `off` or `warn` (D108, T322), and is proven on the test profile (T323) before it runs on live.
3. A new lead session, or another project's lead, takes over from `LEAD.md` plus MCP and the CLI alone, with one command, `system lead brief`.
4. The lead's own judgement stays the lead's: what to file, escalate, or tell the operator. System gets the rules, never the judgement.

## Non-goals

- No change to what the lead may decide. The closed list of rights ([the lead principal](../design/approvals.md#the-lead-principal)) and the escalations of [PROP-0016 §7](0016-operating-model.md) stand; a duty moves into System only inside them. The operator keeps a merge or push to `main`, policy and charter changes, deploys, external sends, security alerts, and a heavy-tier acceptance (INV-6).
- No Worker, model, or vendor named in a mechanism (INV-11).
- No second place for a rule. The [lead's playbook](../operations/lead-playbook.md) stays the home of each LD rule; a rule that System enforces says so in its Check column, and the lead keeps no copy.
- No code, schema, or configuration change here. The lead files each task separately.

## 1. The inventory

Each item in the coordination directory, and what System still lacks for it. The built parts are in [Implementation](#implementation).

| # | Item (in the coordination directory) | What is missing |
|---|---|---|
| 1 | **Watcher loop**: auto approvals, stuck detection, held items reported once | A notice for a **stuck** run or task (stalled with no verdict, running past its bound, a lease that keeps lapsing, a task in `waiting` past its time). The auto-approval part is items 2 and 3, so no loop is left to port |
| 2 | **Command judges**: read-only, own tests, `git mv`/`rm`, scratch removal | Proof the lead's judges are redundant: a replay of their recorded verdicts against the command rules, then the judges' removal.  |
| 3 | **Routine remediation approvals**: a review-asked fix, a host-stopped retry | Not needed. PROP-0022 removes the remediation approval from the `lean` pipeline (see the [Decision](#decision)); rank 6 is dropped |
| 4 | **Auto-accept and auto-merge sweeps on dev** | Two sweeps: **accept** a held result that meets LD1's conditions after the fact (a pending check has since passed, or a review was re-opened), and **approve the `merge`** of an accepted result into a listed dev branch, which needs a policy rule naming listed dev branches only (`ALWAYS_ASK` holds `merge` today) |
| 5 | **Pushing dev to the remote and syncing checkouts** | A **publish** step after a landing on a listed dev branch: push the branch to the project's remote through the egress check (INV-12), and leave the landing checkout in step, so the next landing rebases onto what the remote holds (LD16, LD17). A lead's own push to the target must enter the queue (T318b, deliverable 4) |
| 6 | **Task registry**: `T`-number aliases, goal files | A short, stable **alias** (`T324`) the board gives a task and every tool and CLI accepts; the goal stays on the task, so the files are copies. A home for the lead's tasks that run no run (today `board.json` in the coordination directory) |
| 7 | **Decision log**: `D`-numbers, about 107 | Built as rank 4 (see [Implementation](#implementation)) |
| 8 | **Live profile patch history**: `cordis.patch.1..12` | A **versioned history of the live profile patch**: each write (a toggle, a live update, an operator edit) kept as an artifact with its parent, its reason, and its decision; show, diff, and restore; so `.1` to `.12` are System's records and a profile can be rebuilt from them |
| 9 | **Salvage and hand landings** | A **salvage** operation: the decision (with its LD13 reason), the diff saved as an artifact, the run stopped, the task closed as salvaged, a worktree for the lead's edits on the run's branch, then the result **through the same checks and the landing queue** as any other, recorded as a lead landing, with its root-cause task filed (LD15) |
| 10 | **Morning report and health table** | Built as rank 10 (see [Implementation](#implementation)) |
| 11 | **Handover to a new session** (only in the session's memory) | A **brief for a lead** (section 3), and a **handover note** the outgoing session leaves: a record, not a memory |
| + | **Starting tasks** (`scripts/sysrun.mjs`, in this repository) | `system task start <task>`: the same start as a CLI and MCP verb of the lead, so the lead needs no script (rank 13) |

Items 1 and 2 are mostly **built**: what is missing is proof and removal. Items 4, 5, and 9 are about **landing** and must come after the landing queue (T318b), or they race it.

## 2. The design in System

Each part below says: the seam or row, the policy rule, the record, how it is switched off, and how
it is tested on the test profile.

### 2.0 Four rules for all of them

**The switch.** Following D108 and T322, every mechanism lands as an optional row or as a key
`enforce: off | warn | on` on its owner's row, read live (no restart).

| Mode | What it does | What the lead does |
|---|---|---|
| `off` | The mechanism does nothing and its records stop; System works as today | the lead's script still does the duty |
| `warn` | It computes what it **would** do and records it as a `lead-duty` decision (`would-approve`, `would-push`, and the like), acts on nothing | the script still does the duty; the two are compared |
| `on` | It acts, as a decision recorded under its rule's id, within the lead's rights | the script is removed |

A new mechanism starts `off`, or `warn` where the mechanism only reads. It moves to `on` only after N
days clean on live, N in the policy (T322; proposed 5 working days for a deciding mechanism, 3 for
a notice). Turning any of them off never breaks System (T317, T322).

**The retirement.** A script is removed only when its replacement has run in `warn` beside it for N
days with **no disagreement**: every case the script acted on, the mechanism would have, and every
case the mechanism would act on, the script did. Each disagreement is a task. The comparison is a
query over the `lead-duty` decisions and the lead's own notes, not a manual read.

**The test.** Each mechanism is tested on the test profile (T323) with the conformance fakes. Its switch
goes to `warn`, then `on`, on the test profile first, through the canary (a board task through
`algorithm-development` on fakes, an ask, a research run, the removability smoke); only then on live. The
canary gains one case per mechanism. A mechanism whose canary case fails never reaches live: the stage step
refuses to touch `system` (T323).

**The records.** One new record, `lead-duty@1.0`, is a decision of System's own (INV-13): the
duty, the project, the subject, the mode, what it did or would do, the rule's id. It is added to
the decision kinds; an existing kind (`approval`, `acceptance`, `landing`) is used instead where the
act already has one, with the rule id in its detail.

### 2.1 The watcher loop → the inbox, with stuck notices (rank 3)

- **Seam and row.** The `lead-inbox` row (a surface, optional) reads recorded events only. It gains `run.stuck` (a run stalled and not freed within `stuckMinutes`, from `agent-workers.run.stalled` and the liveness verdicts), `task.stuck` (a task `running` past its bound, or `waiting` past its wait time, with no event since), and `host.restarted` (the board's recorded restart and what it reconciled).
- **Policy.** None: a notice decides nothing (INV-6). The inbox's rule stays: ids, kinds, counts, times, and the command to act only.
- **Record.** `lead-notice@1.0`, an added kind (a minor version of the enum).
- **Off / warn.** The row's `kinds` list names the kinds on; the three start off. `warn` shows the kind with `push: false` (in `lead inbox` and `/ui`, never pushed).
- **Test.** A fake Worker that stalls produces one `run.stuck`, once, and none after the run is freed; a second stall is one more notice only after `dedupMinutes`.
- **Retires.** The watcher loop's stuck check and its "report once" state file.

### 2.2 Command judges → command rules (rank 3: audit, then removal)

- **Built.** `commandRules` decide the read-only programs, the run's own tests and checks, tree edits, and scratch removal at the gate. The judges are redundant when every command they approved is one a rule decides.
- **What is added.** `system lead audit-commands --project <id> [--days n]` (MCP `lead_audit`), a read-only query: the deferred commands of the period that **reached the lead**, and what the lead decided, grouped by program and subcommand. Each group is a rule to add (a policy change the operator approves) or a command that must stay a judgement. 
- **Policy, record.** None new: a rule is added through a [policy change](../design/approvals.md#a-policy-change); every verdict is already recorded.
- **Off / warn.** Nothing to switch. A judge is removed under the retirement rule of 2.0, after N days in which no deferred command reached the lead that a rule could have decided.
- **Test.** A replay of ten recorded commands: those a rule decides do not reach the lead; the rest group correctly.

### 2.3 Routine remediation approvals → policy rules (rank 6)

Dropped, not built. See the [Decision](#decision).

### 2.4 Auto-accept and auto-merge sweeps → the board and the approvals rows (ranks 7 and 8)

- **Accept sweep (board).** `board.auto-accept` already accepts at the run owner's decision. Each board sweep re-reads every task held `operator-review` for a **listed** project and applies the same conditions (the last review approved the exact tree, no blocking finding, every required check passed on it and none `notRun`, a listed landing branch, not heavy), deciding as `board.auto-accept` on the held record. It never accepts a heavy-tier result, one with a check pending, or one on an unlisted branch. Switch: `autoAccept.sweep: off | warn | on`; `warn` records `would-accept` in the `board` decision kind.
- **Merge sweep (approvals).** A `merge` request into a listed `devBranches` branch is decided for an accepted result whose acceptance recorded the landing on that branch, at the exact head: a policy `mergeRules` entry with `branches: listed-dev` and no other, decided with the rule's id. `ALWAYS_ASK` keeps `merge` for every other branch; `main` and `master` can never be listed. This is the one change here that touches the gate: it **amends ADR-0060 and ADR-0076** and takes the heavy path (two families, the operator accepts alone). Switch: `mergeRules.mode`.
- **Order.** After the landing queue (T318b), so a sweep never moves a target under a landing.
- **Test.** Three results accepted together land in order; a heavy-tier result is held; a result with a pending check waits until it passes; a request for `main` is asked, never decided; `warn` records `would-merge` and leaves the request open.
- **Retires.** The two sweeps.

### 2.5 Pushing dev and syncing checkouts → a publish step after a landing (rank 9)

- **Seam and row.** A new optional row `landing-publish`, a decorator of the landing seam's provider ([the landing seam](../design/workflow-engine.md#the-landing-seam)): after a landing `merged` on a listed dev branch, it pushes that branch to the project's remote and, through the same provider, leaves the landing checkout on the pushed commit. `landing-local` never pushes; a project with no `publish` entry is untouched.
- **Policy rule.** A new action class `publish` (a push of a listed dev branch to a named remote), asked by default and decided by the lead's rights where the branch is listed. A push to `main` or any other branch stays the operator's. The push goes through the egress check on the exact refs (INV-12), with the vault's credential (INV-8), never the lead's file.
- **Record.** The `landing` decision gains a `publish` outcome (`pushed`, `skipped`, `refused`), the commit, and the remote's name (never its URL); an inbox notice on a refusal.
- **Off / warn.** `landing-publish` starts off. `warn` computes the refs it would push and records `would-push`; it pushes nothing.
- **Never on a red commit** (LD17): the landing's checks are the push's precondition.
- **Test.** On the test profile with a local bare repository as the remote: a landing pushes once; a second pushes after it, in order; a moved remote refuses and notifies, and changes nothing; a `main` landing never pushes.
- **Retires.** The push script and the checkout sync (LD16).

### 2.6 The task registry → the board (rank 5)

- **Seam and row.** The `board` row. A task's `ref` (`T324`) is a per-project sequence the board allocates at creation and keeps with the record (`board-task@1.3`, an optional field: a minor version, no migration). `system board import-refs` gives the lead's existing T-numbers their refs, once. Every tool and the CLI accept `T324` where they accept the id, within the caller's project; an ambiguous or unknown ref is refused with the reason.
- **Goals.** The task's goal and criteria are already its record; the coordination goal files are copies and go.
- **Tasks that run nothing.** A lead's own task (a follow-up, a question for the operator) is a board task with `action: none` and the lead as owner, moved by `board_update`, with no run. Whether the board admits that today is the task's first check; if not, it is a small change of its own (open question 4).
- **Policy.** None new.
- **Off / warn.** The field is optional, and the allocation is a switch on the row (`refs: off | on`); with it off a task has only its id.
- **Test.** Concurrent tasks get distinct refs; a ref of another project is refused for a lead token; a restart keeps the sequence.

### 2.7 The decision log → an operator-decision record (rank 4)

Built as rank 4. Its schema is [`operator-decision@1.0`](../../schemas/operator-decision.v1.json), its steps are in the [runbook](../operations/runbooks.md#record-a-decision), and the decisions taken in the build are in [Implementation](#implementation).

### 2.8 The profile patch history → the plugin host (rank 5)

- **Seam and row.** The `plugin-host` row, which T322 makes write a runtime toggle into the profile patch. Every write of the patch (`system plugin on|off`, a live update, an operator edit found at start) is kept as a `profile-patch@1.0` artifact: the patch's text, parent, hash, reason, and the decision that made it. `system profile history`, `system profile diff <a> <b>`, and `system profile restore <n>` (operator scope; a restore is itself a new version).
- **Policy.** Unchanged: the operator's, or a live update the operator's `dev` permission covers (LD3). The lead never writes the profile.
- **Record.** `profile-patch@1.0` plus the existing lifecycle and `host.live-update` decisions, each linked to its version.
- **Import.** `cordis.patch.1..12` are imported once as versions with their dates; a gap is noted, not invented.
- **Off / warn.** Versioning off: the patch is written as today. `warn`: a mismatch between the patch on disk and the last version is a health finding, not a refusal.
- **Test.** Off, on, and a live update each make one version; a restore reproduces the patch byte for byte; an edit made outside System is recorded as `external`.

### 2.9 Salvage and hand landings → one salvage operation through the queue (rank 11)

- **Seam and row.** A tool of the `workflow` row (it owns the runs and the landing seam): `system salvage <task> --reason <sandbox-gap|review-bound|hang> --cause "…"`. It:
  1. records a `salvage` decision with its LD13 reason, the run, and the task;
  2. saves the run's diff as an artifact (the `$TMPDIR` copy of LD14 becomes a record);
  3. stops the run (`system stop`) and takes the task off the board as `salvaged`, never `cancelled`;
  4. opens a **salvage worktree** on the run's branch for the lead's edits (never the live checkout);
  5. proposes the **root-cause task** (LD15) with the cause as its goal; no cause, no salvage.
  `system salvage land <task>` takes the worktree's head, runs the **required checks on that exact tree** (ADR-0063, T299), and enters it in the landing queue (T318b) as a result with `landedBy: lead:<project>`. Its tier comes from the path map (ADR-0071), so a heavy-tier salvage is held for the operator. No salvage lands on a failed or skipped check (LD17).
- **Policy.** Nothing new: the lead's right to merge into its listed dev branches (existing).
- **Record.** The `salvage` decision, the diff artifact, and the `landing` decision with its source.
- **Off / warn.** While off, the tools are refused with a reason and the lead lands by hand. `warn` runs the whole path but stops before the landing and says what it would land.
- **Test.** On fakes: a salvaged run lands once, in the queue's order, after its checks; a salvage without a cause is refused; a failing check stops it; a heavy path is held.
- **Retires.** The hand-landing steps of LD14 and the salvage notes of the coordination board.

### 2.10 The morning report and health table → a daily digest and a health section (rank 10)

Built as rank 10: `lead_digest` and `lead_health` in the [`report` row](../../packages/plugins/report/README.md), read in the [runbook](../operations/runbooks.md#read-the-day). The digest's push to a sink and the remote row are not built; see [Implementation](#implementation).

### 2.11 The handover → the lead brief and a handover note (ranks 1 and 2)

See section 3.

### 2.12 What stays the lead's, and not in System

| What | Why |
|---|---|
| deciding what to file and in what order (LD21, LD22) | judgement: System offers the facts (`lead brief`, `system metrics`), never the choice |
| the decision brief for the operator (LD4) | it needs the lead's reading of the evidence; System builds the facts of it (I2) |
| what to tell the operator and when, beyond the digest | judgement |
| answering a Worker's question (T291) | the answer is knowledge the lead has |
| the choice to salvage or retry | LD13 says when; System does the mechanics |

## 3. `system lead brief --project <id>`

One command, one page, read-only, that a session reads at its start and again whenever it is lost.
It is MCP `lead_brief` (client scope; a lead token reaches its own project only, the operator names
one) and `system lead brief --project <id> [--json] [--since <time>]`. It adds nothing a session could not read elsewhere; its value is that nothing is forgotten.

**It reads, never writes**, except one event, `lead.brief-read` (who, when, which project), which
`system metrics` counts as a session change and the inbox's lead-touch metric ignores.

| # | Section | Holds | Read from |
|---|---|---|---|
| 1 | **You** | the project, the principal (`lead:<id>`), the charter's objective and constraints (a line each), dates, **the playbook's version**, and the rules changed since this principal's last brief | `board_projects`, the lead principal, the playbook's blob id (handbook layer 4), the last `lead.brief-read` |
| 2 | **Inbox** | unread notices, oldest first, each with its kind, subject, age, and the command to act | `lead_inbox` |
| 3 | **Waiting on the operator** | open approval requests outside the lead's rights (each with its expiry and brief); reviews held `operator-review` or `review-expired`; heavy-tier results | approvals, `board_tasks` |
| 4 | **Held on you** | requests the lead may decide and has not (a deferred command no rule covers, a `remediation`, a `merge`), and results the lead may accept, each by expiry | approvals, board |
| 5 | **Pending decisions** | the lead's open questions to the operator (`asked` records), policy or charter changes awaiting approval, and decisions recorded since the last digest | `decisions`, approvals |
| 6 | **Running work** | runs and steps; tasks `ready`, `running`, or `waiting` (with what for); tasks blocked by dependency; the landing queue (depth, head); worktrees held | board, workflow, the landing queue, `system worktrees` |
| 7 | **Health** | the health table of 2.10 | `lead_health` |
| 8 | **The last day** | what landed, what the lead decided, what failed (the digest's body for the period since the last brief) | `lead_digest` |
| 9 | **Switches** | each lead mechanism of this proposal, its mode, and its days clean | the owning rows' `enforce` keys |
| 10 | **Handover note** | the outgoing session's note: what it was doing, what it promised, what to watch, what it deferred and why | `lead-handover@1.0` |
| 11 | **What I could not read** | each section that failed, with the reason | the brief itself |
| 12 | **First moves** | the daily loop's three commands, `system lead wait`, `system lead ack`, `system handbook --role lead` | fixed text |

- **Bounded** (INV-9): each list holds at most 20 entries and says how many it omitted; the text rendering
  fits one screen when the project is quiet, and about 200 lines when it is not.
- **Fail closed** (INV-2): a section that cannot be read says so in section 11 and shows no value, never an
  empty list, which would read as "nothing to do".
- **The playbook is a pointer, not a copy**: section 1 gives the version and the changed rules; the text is
  read through `system handbook --role lead` (I1 part 3) or `LEAD.md`'s link, so a rule has one home.
- **The handover note** (`lead-handover@1.0`): `system lead handover --project <id> (<text…> | -)` and MCP
  `lead_handover`, bounded (4,000 characters), one current note per project with its history kept. The lead
  writes it when it ends a session or before a long wait; `lead brief` shows the latest, and the next session
  marks it read (`ack`). A note is advice, not an instruction: it never grants a right (INV-6), and
  `lead brief` says who wrote it and when.
- **Switch.** `lead_brief` is a tool of the `lead-inbox` row and appears with it. Its sections are read through
  optional rows (`decisions`, the landing queue, `landing-publish`): a row that is off is a section that says so.
- **Test.** On the test profile: an empty project, a busy project from a fixture (one of each section), a
  section whose source is down (it reads "could not read", not empty), two projects (a lead token never reads
  the other's), and the 20-entry bound.

## 4. The end state

The coordination directory holds `LEAD.md` and nothing a script reads. A new session, or another
project's lead, works from `LEAD.md` plus MCP and the CLI.

| Today (coordination directory) | End state | Where it lives |
|---|---|---|
| watcher loop, its state file | gone | the inbox (2.1), command rules (2.2), policy rules (2.3, 2.4) |
| command judges | gone | `commandRules` |
| remediation (rank 6, dropped), accept, and merge sweeps | gone | `remediationRules`, `autoAccept.sweep`, `mergeRules` |
| push and sync scripts | gone | `landing-publish` |
| task registry, goal files | gone | board refs |
| decision log | gone | `operator-decision` records |
| `cordis.patch.1..12` | gone from the directory | `profile-patch` versions |
| salvage notes | gone | the `salvage` decisions and diffs |
| morning report script, health table | gone | `lead_digest`, `lead_health` |
| the handover in memory | a record | `lead-handover` |
| `board.json` for tasks that run nothing | gone | board tasks with no run (open question 4) |
| `LEAD.md` | **stays**, shorter | the checklist of [LEAD.md](../operations/examples/LEAD.md), the project's own facts (its name, its listed branches, who the operator is), and four commands: `system lead brief`, `system lead wait`, `system lead ack`, `system lead handover` |

- **What `LEAD.md` may hold**: text a session reads. It never holds a token, a number a script parses, or a
  rule (a rule is in the playbook or the policy). `system lead doctor --project <id>` (rank 12) fails when the
  coordination directory holds anything but `LEAD.md`, so the end state is checked, not hoped for.
- **A lead token is not in the directory.** It stays beside the operator's token (`lead-<project>.token`), as
  today (LD25).
- **The test of the end state**: a fresh lead session with only `LEAD.md`, the token, and the CLI reads the
  brief, handles the inbox, and ends with a handover note; a second fresh session reads that note and continues.
  Proven on the test profile and once on a second project (PROP-0016 I5); it is the acceptance of the last task.
- **Another project's lead** needs no copy: `system project new` writes `LEAD.md` from the template, the policy
  rules come with the project's policy, and every tool names its project by id.

## 5. Ranked implementation tasks

The order starts after the core loop runs clean: T293b (checks before any acceptance), T318b (the landing queue), and T321 (the handbook bound). Every task that changes how the system decides also needs T322 (the switches) and T323 (the test profile). Each task is one concern, about 1,500 changed lines at most, with one switch and one test on the test profile. Ranked by value over risk: read-only first, deciding last. **Rank 12 is the exception**: it changes no behaviour of System beyond `lead doctor`, so its switch is the lead's own step (a script is removed only after N clean days of its replacement), and its docs are `LEAD.md` and the template; a changeset only for `lead doctor`.

Ranks 1, 4, and 10 are built (see [Implementation](#implementation)), and rank 6 is dropped (see the [Decision](#decision)). The open ranks:

| Rank | Task | Switch (starts) | Test that must fail without it | Needs |
|---|---|---|---|---|
| 2 | **The handover note** (`lead-handover@1.0`, `lead handover`, section 10 of the brief) | the row; read-only | a note is shown once and kept; a note grants no right | 1 (built) |
| 3 | **Stuck notices** (2.1) and the audit of commands (2.2) | `kinds` (off); the audit is read-only | one `run.stuck` per stall; the audit groups a replay | 1 (built) |
| 5 | **Board refs** (2.6) and **profile patch versions** (2.8) | `refs` (off); versioning (`warn`) | distinct refs under concurrency; a restore is byte-exact | T322 |
| 7 | **The accept sweep** (2.4) | `autoAccept.sweep` (`warn`) | a held result with passed checks accepts; a pending or heavy one does not | the core loop only (see the Decision) |
| 8 | **The merge rule on listed dev branches** (2.4), ADR amending 0060 and 0076 | `mergeRules.mode` (`warn`) | `main` is asked, a listed dev branch decided, in the queue's order | 7, T318b; **heavy path** |
| 9 | **`landing-publish`** (2.5) | the row (off, then `warn`) | a landing pushes once, in order; a moved remote refuses | 8 |
| 11 | **Salvage** (2.9) | off, then `warn` | a salvage lands once after its checks; none without a cause | 9 |
| 12 | **`system lead doctor`**, then **retire the coordination scripts**, one duty at a time, and `LEAD.md` rewritten from the template | the lead's own step, after N clean days of each replacement (the exception above) | `lead doctor` names a stray file in a fixture directory | 3 to 11 |
| 13 | **`system task start`** (replacing `sysrun.mjs`) | the verb; refused while off | a start by the lead is recorded as `lead:<project>` | 12 |

Notes on the order:

- **Ranks 2 to 5 are read-only or add records**, so they can ship before T322's switches are everywhere.
- **7 to 9 decide or act**: each starts `warn`, is compared with the script it replaces for N days, and moves to `on` only after the test profile's canary and N clean days on live. A policy change (8) goes through the approval queue; the lead never approves it.
- **8 is the only task on the heavy path** (it changes the gate's rules for `merge`), and it follows the landing queue so a merge never races a landing.
- **Each task begins by reading its script** and listing every behaviour it has, so a behaviour this proposal missed is found before the script goes.
- **Metrics**: the lead-touch metric ([maturity metrics](../design/maturity-metrics.md)) is the measure; the scripts removed at 12 are about 1,400 lines.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Keep the scripts and document them | a session changes, so what it needs must not sit beside it (D109); a script is not gated, recorded, or tested |
| One `lead-duties` plugin holding every mechanism | a row that does eight unlike things cannot be removed in part (D108); each duty lives at its own seam |
| The lead's sessions share a state file in System | a file mirrors System's records (INV-7); what is missing is a record |
| System writes the digest and decides what to file | judgement is the lead's; a rule cannot state it (2.12) |
| Let the lead approve the policy changes that move its duties | LD3 and INV-6: a policy or charter change is the operator's |
| A lead daemon, a second process that runs the lead's loop | a second authority (INV-1) |
| Do all of it in one task | each duty is a different seam and risk; a task over about 1,500 lines is not reviewable |

## Validation plan

- Each task's tests run with the switch `off`, then `warn`, then `on`, on the test profile with fakes (T323), with one canary case per mechanism.
- The retirement comparison (2.0): for N days in `warn`, the would-do decisions equal the script's acts; a disagreement is a task before the script goes.
- Conformance suites and schemas (INV-14) for each new record, and minor versions of `lead-notice@1.0`, `board-task`, and `autonomy-policy`.
- The end-state check (`lead doctor`) and the two-session handover test of section 4; `pnpm check`, `pnpm lint`, `pnpm typecheck`, and the related tests on every task (W15).

## Rollout and rollback

- Every mechanism is optional and starts `off` or `warn` (2.0). Turning one off returns the duty to the lead's script, which therefore stays until N days clean; the records a mechanism made stay.
- The scripts are removed last, one duty at a time (rank 12), and not before the replacement has been `on` for N days. A removed script stays in the coordination directory's git history, so a duty can return to a script in minutes.
- A mechanism goes to `on` on the test profile first, with the canary, then on live ([update the live install](../operations/runbooks.md#update-the-live-install-from-e218ae7-to-the-base-release)).

## Observability and operations

- `system lead brief` (section 3) is the operational view; the `/ui` Lead panel shows the same sections.
- Each mechanism's mode and days clean are in the brief's section 9 and in `system plugin list` (T322).
- `lead-duty` decisions are read by `system explain` on a task and by the lead-touch count: a duty System does is not a lead touch.
- Runbooks to add: take over as a lead; turn a lead mechanism to `warn` and `on`; retire a script; write a handover note.

## Security and privacy

- No right is added to the lead. Each mechanism acts inside `leadMayDecide`; `main`, policy and charter changes, deploys, external sends, security alerts, and tokens stay the operator's (INV-6). A mechanism decides as a **policy rule**, recorded with its id, never as the lead's token.
- A push (2.5) is an egress (INV-12): declared, checked on the exact refs, with the vault's credential (INV-8).
- The brief, the digest, and a notice hold ids, kinds, counts, times, and commands, not secrets, tokens, host paths, or private text. The handover note is classified `operator-shared` and checked by the credential scan on write.
- A handover note and a decision record are data, never an instruction (INV-6). Decision records are never deleted, so a lead cannot rewrite what the operator said.

## Compatibility and migration

- Additive: new records and tools; a minor version for `lead-notice`, `board-task`, `autonomy-policy`
  (`remediationRules`, `mergeRules`), and the `landing` decision's `publish` outcome. No existing record
  is changed in place (INV-14, [schemas](../reference/schemas.md#versioning)).
- Imports, once each: the 107 decisions, the T-number refs, the patch versions `.1` to `.12`.
- A project without these rows works as today: the brief says which sections it could not read.

## Open questions

Each has a recommendation; the operator decides.

1. **N, the days clean before a mechanism moves to `on`.**
   **Recommended:** 3 working days for a notice or a read, 5 for a mechanism that decides or acts, set in the
   policy (T322).
2. **The merge rule (2.4) amends ADR-0060 and ADR-0076.** May the policy let System approve a `merge` into a
   listed dev branch, with `main` and `master` never listed?
   **Recommended:** yes, on the heavy path, after the landing queue runs clean.
3. **A push of a listed dev branch (2.5) as the lead's right.**
   **Recommended:** yes, to the project's named remote only; any other push is the operator's.
4. **Tasks that run nothing (2.6).** Do they live on the System board with no run, or do they end?
   **Recommended:** on the board, `action: none`, so the next session sees a lead's follow-up.
5. **Where the operator's decisions live for studio-wide (no project) decisions.**
   **Recommended:** the same `decisions` row, `projectId` absent, readable by every lead, written by the
   operator or by a lead on the operator's word, as `recordedBy` says.
6. **The handover note's bound.**
   **Recommended:** 4,000 characters, the latest shown, ten kept.

## Decision

Accepted by the operator on 2026-11-01 (D119: "the logic should be in System"), read together with
[PROP-0022](0022-lean-core.md), accepted the same day:

- **Rank 6 (remediation rules) is not built.** PROP-0022 change 3 removes the remediation approval
  from the `lean` pipeline (T366), so no rule is needed to decide it.
- **Rank 7 (the accept sweep) needs no rank 6.** It follows the board's auto-accept rule (ADR-0067).
- **Rank 8 (the merge rule)** decides a merge only within D115: `on` for the light tier alone, after
  the `lean` pipeline has run 7 days and 30 light results with quality held; every other merge asks.
- **Rank 3's audit of commands** also serves D114's audit of the sandboxed rule's `warn` records.
- Ranks 1, 4 and 10 are built (T327, T328, T329); their rows (`lead-inbox`, `decisions`) are off on
  the live install until the operator turns them on.

The resulting ADRs (the merge rule, the publish action class) are recorded by their tasks.

## Implementation

Each task of section 5 is filed by the lead after the core loop runs clean (T293b, T318b, T321); it records its commit here and in the [roadmap](roadmap.md).

- **Rank 10 (T329).** Built in the `report` row, read-only: MCP `lead_digest` and `lead_health`
  (`mcp-report@1.7`), `system lead digest|health`, and the `lead-digest@1.0` record, stored once a day is
  over ([`report`'s README](../../packages/plugins/report/README.md), [runbook](../operations/runbooks.md#read-the-day)).
  Not built: the digest's push to a sink at an hour (its own switch, off), the remote row (`landing-publish`,
  rank 9), and "decisions left for tomorrow" beyond what waits on the operator.
- **Rank 1 (T327).** Built as a tool of the `lead-inbox` row. Sections 1 to 8, 11, and 12 of section 3 are
  built; sections 9 (switches) and 10 (handover note) are not yet. The record is
  `lead-brief@1.0` ([schema](../../schemas/lead-brief.v1.json)). A source that cannot be read whole within its
  bound is unreadable too, never a list filtered from a truncated read.
- **Rank 4 (T328).** The `decisions` row (`@tsuuanmi/system-decisions`, off in the bundle) holds
  `operator-decision@1.0` ([schema](../../schemas/operator-decision.v1.json)), with MCP `decisions_*`
  ([reference](../reference/schemas.md#mcp-tools-decisions_)) and `system decisions list|show|ask|answer|import`
  ([runbook](../operations/runbooks.md#record-a-decision)). The build differs from section 2.7 in these ways:
  - A question takes its number when it is **asked**. The store draws it from one sequence in the writing
    transaction, so two writers never share a number, and none is reused.
  - An answered record never changes, and none is deleted. A correction is a new record whose `supersedes`
    names the old one.
  - A lead token asks and records answers for its own project only, and only on the operator's word (`source`
    is required; `answeredBy` is `lead:<project>`, never `operator`). It reads its project's and the studio-wide
    records, but never answers a studio-wide question or another project's, corrects another's, or imports.
  - The import reads `{"decisions": [...]}` or an object keyed by number, and refuses a gap, a duplicate, or
    an entry it cannot read exactly (no guessed time, no truncated text); a second run changes nothing.
  - The closed list of a lead's rights (ADR-0076) is unchanged: asking and recording the operator's word are
    records of evidence, not decisions of System.
