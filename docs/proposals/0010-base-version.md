---
id: PROP-0010
type: proposal
status: accepted
created: 2026-10-22
summary: Define the Base version as the closed core with Claude Code as the first Worker, every record and seam specified by schema and protocol, proven by one multi-day project; Deep Research, website and API Worker work come after.
owners: [operator]
evidence: [research/design-review-2026-10-22, research/ecosystem-for-base-2026-10-22]
related: [PROP-0004, PROP-0008, PROP-0009, ADR-0036]
decided-by: [ADR-0037]
implementation: []
---

# Proposal: the Base version — close the core, Claude Code Worker first

## Problem

The release stages in [release scope](../requirements/release-scope.md) come from PROP-0001, which
saw `system` as a tool for delegating turns. [PROP-0008](0008-studio-operating-model.md) restated the
purpose, and [ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md) fixed which seams
carry the guarantees. Against that, three of the six core components are incomplete:

- the **resource ledger** does not exist; only account cooldowns and per-request usage reports do;
- the **gate** has egress and acceptance but no approval queue, so every approval interrupts the operator;
- the **work state machine** knows runs and nodes but no project or task that outlives a run.

Most validation time goes to website Workers, which do not make the core more correct. The agent Worker
rows, which put Claude Code to work on the operator's Claude Max plan, are off by default and carry a
known P1 defect ([follow-ups](roadmap.md#follow-ups-from-the-reliability-review)).

The new mechanisms add records and seams. Unless they are specified first, each one would invent its own
shape and failure rules.

## Goals

1. **Close the core.** Each of the six core components has a built guarantee seam, a written protocol,
   and a conformance suite.
2. **Claude Code is the first Worker:** on by default, safe for writing, able to validate its changes,
   and metered.
3. **Schema and protocol first.** Every record has a JSON Schema; every seam has an abstract definition,
   a protocol, and a conformance suite from its first provider
   ([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md)).
4. **Prove it on real work.** One multi-day project runs from charter to close on Claude Code Workers,
   measured against PROP-0008's baseline.

After Base, `system` evolves by adding or replacing plugins only. A change that needs a core contract
change needs an ADR (ADR-0036).

## Non-goals

- **Deep Research** on ChatGPT and Gemini is future work. The code stays; its open live checks do not
  gate Base or v1.0.
- **Website Workers and API or local model Workers** get no new work until Base ships; they keep passing
  their conformance suites and serving their current work.
- Codex and ACP agent Workers: they follow Claude Code once its path is proven.
- Decision-assisted routing (PROP-0002), the knowledge family, RTK, Serena, context-mode, automated
  shadow and canary runs, shadow prices across projects, A2A, new gateway work.

## Evidence and research

- [Ecosystem for the Base version](../research/ecosystem-for-base-2026-10-22.md): what to adopt, adapt,
  or avoid for each milestone. Nothing replaces a core component.
- [Design review 2026-10-22](../research/design-review-2026-10-22.md), PROP-0009 and ADR-0036: the six core
  components, the eight families, and where tokens are wasted.
- [agent-workers](../../packages/plugins/agent-workers/README.md) and
  [runtime-claude-agent-sdk](../../packages/plugins/runtime-claude-agent-sdk/README.md): the Claude Code
  Worker today (the "Today" column below).
- [Roadmap](roadmap.md): which milestones are done, and the P1 follow-up on agent Workers.

## Proposed design

### Definition

**Base** is the version in which:

1. every core component is built, specified, and covered by its conformance suite;
2. each plugin family has at least one provider, or a deterministic default;
3. Claude Code is a first-class Worker;
4. one real project passes the exit criteria below.

### The core in Base

Records are new JSON Schemas in [`schemas/`](../../schemas/README.md). Protocols are written in a design
document when the component is built, with a state diagram and a transition table that names the failure
behaviour of every step.

| Core component | Seam | New records | Protocol |
|---|---|---|---|
| ledger of record | `store`, `artifacts`, `eventLog`, `credentials` | new artifact kinds only | existing ([artifacts](../design/artifacts.md)) |
| work state machine | `workflow`, `workerSessions`, `leases`, **`board`** | `project@1.0` (charter: intent, criteria, constraints, stop rules, budget), `board-task@1.0` | [task states](#protocol-sketch-a-board-task) |
| runner | `workflow` engine, `turnReceipts` | `workflow-node@1.x` gains a run budget | budget exhausted → the node blocks and asks the gate |
| gate | `egress`, `workers` acceptance, **`approvals`** | `autonomy-policy@1.0`, `approval-request@1.0`; verdicts stay `approval@1.x` | [approval requests](#protocol-sketch-an-approval-request); on a Claude Code Worker the policy is enforced by a PreToolUse hook (`deny`, `defer`), never by `canUseTool` alone |
| resource ledger and metering | **`resources`** | `usage-record@1.0` (fields named after OpenTelemetry GenAI, with account, pool, price version, and request id for deduplication), `limit-state@1.0` (pools and windows as configuration); `agent-result@1.2` adds token usage with cache reads and writes | reserve before a run, record after it from the runtime's own usage fields, cool down on a limit notice; reconcile against session transcripts |
| plugin host | host, bundle, conformance | `plugin-manifest@1.0` (seams provided and consumed with versions, family or core component, lifecycle state) | lifecycle states are recorded as decisions; Base records them and automates nothing |

Every guarantee seam fails closed (INV-2): with the resource ledger unavailable no new run starts; with
the approval queue unavailable an action that needs a person waits.

#### Protocol sketch: a board task

```mermaid
stateDiagram-v2
  [*] --> proposed
  proposed --> ready: dependencies met, and allowed by policy or approved
  ready --> claimed: lease taken
  claimed --> running: run started (run id recorded)
  running --> review: result artifacts recorded
  review --> done: acceptance decision accepted
  review --> ready: rejected, retry within budget
  running --> blocked: reconciliation failed, budget spent, or approval needed
  review --> blocked: retries spent
  blocked --> ready: approval verdict
  proposed --> cancelled
  ready --> cancelled
  blocked --> cancelled
  done --> [*]
  cancelled --> [*]
```

Only the work state machine moves a task, and each move references the decision or event that caused it.
A started run that cannot be reconciled is never run again (INV-4): its task becomes `blocked`, and the
gate puts one request in the queue to run it again from a resume brief.

#### Protocol sketch: an approval request

```mermaid
stateDiagram-v2
  [*] --> open: action needs a person under the autonomy policy
  open --> batched: grouped with other open requests
  batched --> approved: operator verdict
  batched --> rejected: operator verdict
  batched --> expired: deadline passed
  expired --> rejected: fail closed
  approved --> [*]
  rejected --> [*]
```

The autonomy matrix that decides which actions need a person is defined in
[PROP-0008](0008-studio-operating-model.md#fewer-approvals-reliable-results).

### Claude Code as the first Worker

| Item | Today | Base |
|---|---|---|
| Composition | agent rows off by default (PROP-0004) | `agent-workers`, `agent-runtimes`, `runtime-claude-agent-sdk` on by default; Codex and ACP stay off |
| Writing safety | the P1 follow-up: superseded remediation cycles, an unapproved writing step, hidden paths that name one agent's directory | each writing task runs in its own workspace (a git worktree per task); remediation asks the gate; hidden paths cover every agent's credential directory |
| Validation | no Bash, so no `validate` | commands confined to the workspace with no network, by `@anthropic-ai/sandbox-runtime` (bubblewrap, Apache-2.0) around the Worker, proven by `proveConfinement`; decided by its own ADR |
| Metering | `costUsd`, `turns` | `agent-result@1.2`: model, input, output, cache read and cache write tokens, from the SDK's result; one `usage-record` per run |
| Long work | one run, 15 minutes at most | multi-day work is a chain of board tasks; a task resumes the agent's native session from a `brief` |
| Brief | prompt text | `brief@1.0`: goal, acceptance criteria, artifact pointers (never copied content), budget, sandbox |

### Plugin families in Base

| Family | Base provider |
|---|---|
| Worker | Claude Code through the Agent SDK |
| decision | the deterministic router; intake defaults by work kind |
| verification | acceptance contracts, quote checks, a read-only Claude Code review Worker, tests through `validate` |
| digest | `digest@1.0`, written by a read-only Claude Code Worker on the economy tier and quote-checked ([PROP-0008](0008-studio-operating-model.md#mechanism-1-the-digest-layer)) |
| context | briefs carry pointers, not content; tool allow-lists per Worker |
| workflow | an `algorithm-development` template: charter, milestones, develop, validate, review |
| knowledge | none: artifacts are found by id, kind, and lineage |
| surface | MCP tools `board_*`, `approvals_*`, `resources_*` with input and output schemas; CLI; the board and queue on `/ui`; a weekly investor report |

### Order of work

The milestones B1 to B8 are in the [roadmap](roadmap.md#next-base-v08). Metering comes before the board because the baseline needs numbers from the first run. Until B5, remediation
in B3 uses the existing plan approval (`approval@1.0`).

## Alternatives considered

1. **Finish v1.0 first**, then the core. Rejected: most of the remaining v1.0 work is live checks of
   website Workers, which close no core component.
2. **Website Workers first**, as in the MVP. Rejected: they need the most live testing per unit of value,
   and the operator's Claude Max plan is the largest resource `system` does not use yet.
3. **Specify schemas as each mechanism is coded.** Rejected: the new mechanisms share records (a brief
   references a task, a usage record references a run and an account), and late schemas lead to migrations.

## Validation plan

The Base exit criteria are defined in
[release scope](../requirements/release-scope.md#base-exit-criteria): the core specified and conformant,
the crash suite, a pilot project of at least five working days on Claude Code Workers, attention within the
charter's threshold, metered resources, one plugin replaced without a core change, and the baseline
comparison of [PROP-0008](0008-studio-operating-model.md#validation-plan).

## Rollout and rollback

Each milestone adds plugin rows to the `system` bundle. The agent rows turn on by default only after B3's
writing-safety fixes pass. Each new row can be turned off on its own; with `board` off, runs work as today.

## Observability and operations

Usage records, limit states, approval requests, and board transitions are events and artifacts that
`system explain` and the investor report read. Runbooks come with B4 and B5.

## Security and privacy

Confined command execution needs its own ADR and a threat model update before B3 ships. The `agent` Worker
class keeps its egress default: `public` and `operator-shared` work only.

## Compatibility and migration

`agent-result@1.2` and `workflow-node@1.x` are minor versions; readers on `@1.x` keep working. MVP and Beta
keep their definitions. Base is inserted between Beta and v1.0 in
[release scope](../requirements/release-scope.md); Deep Research checks move to future work in the
[roadmap](roadmap.md).

## Decision

Accepted by the operator on 2026-10-22: Deep Research is future work; everything has a schema and a clear
protocol ([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md)); the core and the Claude Code Worker
come first, website and API Workers after.

## Implementation

Milestones B1 to B8 are tracked in the [roadmap](roadmap.md#next-base-v08).
