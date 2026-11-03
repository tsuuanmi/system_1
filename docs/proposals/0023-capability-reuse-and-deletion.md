---
id: PROP-0023
type: proposal
status: draft
owners: [operator]
created: 2026-11-03
summary: Reduce System's owned code through measured capability reuse, especially DSH skills, memory backends and communication transports, without weakening its guarantee seams or introducing a second agent control plane.
related: [PROP-0022, ADR-0010, ADR-0036, INV-2, INV-4, INV-5, INV-8, INV-9, INV-11, INV-12, INV-13, INV-15]
implementation: []
---

# Proposal: Capability reuse and measured code deletion

**Draft for operator and local-agent review. Not accepted and not implemented.**
Read the [2026-11-03 capability reuse audit](../research/capability-reuse-audit-2026-11-03.md)
and [ADR-0010](../decisions/adr/0010-reuse-before-build.md) before assigning work.
Existing [Lean Core PROP-0022](0022-lean-core.md) and safety decisions take precedence
over the experiment plan here.

## Problem

System's out-of-tree Cordis plugins reproduce some capabilities that existing
libraries or DSH/Hermes components may already provide. The cost is not merely
LOC: it includes duplicated state machines, tests, dependency maintenance,
breakage during SDK upgrades, slow feedback, and increased coupling. A
43-plugin directory inventory alone does not establish which are redundant;
several plugins implement guarantees unavailable in their apparent peers.

The goal is **fewer maintained mechanisms**, not a larger plugin catalog.
Hermes Agent is a **candidate capability source** for UI, memory, skills or
messaging, **not** a new coding Worker, Lead, scheduler, or governance owner.

## Goals

- Map each System plugin to owned semantics, consumers, candidate upstream
  providers, evidence and a named reuse decision.
- Prevent future in-house implementations of already available non-core
  capabilities without a recorded [ADR-0010](../decisions/adr/0010-reuse-before-build.md)
  comparison.
- Prove at least one *bounded* reusable capability through a small
  isolated spike, with explicit conditions for adopting or declining it.
- Remove replaced implementation and tests in the same bounded migration,
  once contract parity is demonstrated. Count net production LOC, dependencies,
  processes, memory and test maintenance; report unchanged cases too.
- Preserve the 20–30-minute small-task target of PROP-0022, the single
  authoritative System Board, and fail-closed core behavior.

## Non-goals

- No Hermes Agent loop/Worker enrollment, second Kanban DB, second dispatcher,
  automatic skill editing, remote-control surface, or unapproved telemetry.
- No mass migration of 43 plugins; no replacement of guarantee seams based
  merely on equivalent marketing features.
- No changes to the default profile, packages, schemas, ADRs or
  runtime behavior in this **docs-only proposal**.
- No deletion of a parked package ahead of the existing
  [30-day no-use rule](../architecture/components.md#parked)
  (earliest consideration 2026-12-01).
- No new generic plugin integration framework without a specific,
  demonstrated cross-candidate need.

## Evidence and research

The [research audit](../research/capability-reuse-audit-2026-11-03.md)
records the 43/43 inventory, base commit, source-byte counts,
known upstream implementations, pin mismatches, provenance limits, and
screening verdicts. The [earlier community review](../research/dsh-community-plugins-review.md)
and the canonical [dependency register](../engineering/dependencies.md)
already record many justified build-vs-reuse decisions.

The source-size concentration in `workflow` and `agent-workers` makes them
simplification targets, **not** proven substitutes for GM-HZ or Hermes.
The existing `web-ui/client/board.ts` is small, so replacing that view
only pays off if new Kanban capabilities are wanted or a thin adapter removes
more maintenance than it adds.

## Proposed design

### Ownership rules

1. **System guarantees remain authoritative:** durable workflow, board states,
   exact-subject approvals, credential isolation, budget ledger, read/write
   fences, review/check acceptance, and safe landing.
2. **External providers may implement capabilities** behind existing
   capability seams, data projections, or narrow transports. Their outputs
   must be classified and checked at every System trust boundary.
3. **One writer and one owner per subject:** do not synchronize two task
   databases or allow an external scheduler to launch a task independently.
4. **Prefer smaller reuse units:** official SDK / DSH core / standalone
   library / thin adapter / selective port; reject a complete host runtime
   when only a UI or search library is needed.
5. **Reversible, observable rollout:** optional plugin off by default,
   isolated data and fixed inputs during the spike, version pin plus
   documented rollback before promotion.

### Workstreams and order (proposed, not authorized)

| Order | Workstream | Scope | Exit artifact |
|---|---|---|---|
| R0 | Baseline + dead/redundant code | `workflow`, `agent-workers`; module call graph, production and test LOC, live use and duplicated responsibilities | Dated inventory with deletion candidates and exact tests |
| R1 | First-party DSH Skills | Registry, discovery, filesystem; compatibility with System Worker briefs and explicit skill trust | Thin read-only spike + conformance report |
| R2 | Memory backend | OpenViking direct API vs Hindsight direct backend; opted-in artifacts only | Evaluation over common scrubbed fixtures + provenance and leakage results |
| R3 | Notification transport | Existing `notify`/`lead-inbox` logic feeding one external outbound sink | Delivered/failed/deduplicated cases without inbound remote control |
| R4 | Hermes Kanban UI | Read-only UI against `ctx.board` projections; no Hermes dispatcher/DB | Working, blocked, approval, review, done, stale and restart scenarios |
| R5 | Workflow engine candidate | GM-HZ only as a contract and cost comparison; no implementation migration by default | Contract gap table and separate ADR decision if appropriate |

Do not block Lean Core stabilization on any R1–R5 experiment.

### Agent-ready task contracts

**Task R0 — Measure before replacing**

- Pin `dev` and record its SHA; inventory plugin `src`, `client`,
  `tests` and core library LOC separately.
- Inspect `workflow/src/{tasks,landings,dispatch,engine,teams,handbook,dossiers,continuations,recovery,review}.ts`
  and `agent-workers/src/{index,worktrees,gate,setup,checks}.ts`.
  Trace entry points and readers, integration of SDK features, and live use.
  Identify redundancy *with evidence*, not by module size.
- Report before/after estimates; do not edit engine behavior or alter
  accepted invariants in this task.

**Task R1 — Skills candidate**

- Inspect first-party DSH `dsh-skill` and `dsh-skill-filesystem`
  at exact pinned versions, and compare `agentskills.io` semantics.
- Verify compatibility without importing a complete DSH agent loop.
  Expose only skill metadata and bounded prompt content to existing
  Worker briefs; no model-selected auto-install or script execution.
- Test traversal/symlink boundaries, project separation, untrusted skill
  instructions, watcher teardown, offline operation and permission gates.
- Decide whether native Claude/Codex skills already cover the user need;
  **no new registry** if they do.

**Task R2 — Memory candidate**

- Prepare fixed project-scoped artifacts, seeded retrieval questions,
  ground-truth citations, stale/contradictory documents and redacted secrets.
- Compare direct provider interfaces for indexing, recall and deletion.
  Do not enable DSH auto-session capture or cross-project sharing.
- Test exact citation IDs, authorization boundaries, reindex, malformed
  output, fail-open retrieval behavior (never fail-open authorization),
  memory/storage costs, latency and token overhead.
- Choose no provider if evidence cannot establish net benefit.

**Task R3 — Outbound delivery**

- Keep authoritative event selection and delivery records in System.
  Implement at most one outbound-only experimental sink.
- Do not mount inbound commands, approve/deny controls, shell calls,
  cross-project subscriptions, or an unauthenticated sidecar endpoint.
- Verify duplicate events, retries, offline network and crash recovery,
  egress scans, scope and delivery metrics.

**Task R4 — Kanban read-only UI**

- Reproduce the existing System board states from authoritative
  `ctx.board` reads. Do not start the Hermes DB, Kanban dispatcher, cron,
  background worker or task claim system.
- Verify web UI authentication, page refresh, API/WS disconnect,
  project filtering, revision/staleness and task links to System runs.
- Calculate extra service count, transitive dependency tree, LOC and UI
  maintenance relative to retaining `client/board.ts`.
- **No-go** unless requested UX exceeds current functionality or
  maintenance decreases. Mutation support requires a separate review
  with exact-subject policy and optimistic revisions.

**Task R5 — Durable DAG compatibility**

- Use current System workflow conformance + crash/fencing/replay fixtures,
  the old [DSH candidate review](../research/dsh-community-plugins-review.md)
  and the GM-HZ source.
- Compare per-node lease generations, input-hash reuse, unknown-effect
  handling, operator approval lifecycle, exact-revision validation,
  bounded retries and records.
- Do **not** replace `ctx.workflow` or enable another runner without
  a new accepted ADR and verified contract parity.

Each task may be independently declined after assessment. Do not
bundle several migrations in one PR.

### Shared acceptance gates for each subsequent code PR

| Gate | Pass evidence |
|---|---|
| Compatibility | Exact versions, lockfile and peer ranges documented; isolated composition/load/unload passes |
| Contract | All applicable conformance cases pass unchanged, including negative/refusal cases |
| Safety | Invalid approval, credential, project scope, data egress and remote action paths denied |
| Reliability | Crash/restart, duplicate delivery, cancellation and stale writer tests pass |
| Security/supply chain | License and notices, pinned source/package hash, dependency audit, network/port inventory |
| Operational ROI | Added vs removed LOC, tests, dependencies, resident processes and measured latency/cost |
| Rollback | Switch off + restore old provider without data loss or invisible double writers |

For a capability provider, failure must degrade only that capability, never
grant an unapproved action. For core, failure remains fail closed. One
successful happy-path test does not satisfy the gate.

## Alternatives considered

- **Adopt Hermes end-to-end:** rejected for current proposal; duplicates
  dispatch/agent state and expands the trust boundary.
- **Install arbitrary DSH community plugins directly:** rejected pending
  exact-version/security/contract proof; System deliberately does not mount
  `dsh-base`, and some candidates require different DSH client/session APIs.
- **Rewrite each capability in System:** inconsistent with ADR-0010 when
  maintained narrow implementations already exist.
- **Delete every large package now:** rejected; bytes/LOC are not evidence
  of unneeded behavior, and parked parts have a separate sunset policy.
- **Only keep existing code:** valid default when comparative value fails
  the shared acceptance gates.

## Validation plan

Before implementation, local agent:
1. Check out the current `dev`, compare it with the pinned baseline,
   refresh the mapping when upstream files or System packages changed.
2. Reproduce measured LOC and dependencies, not just tracked-blob byte counts.
3. Read current [invariants](../architecture/invariants.md),
   [plugin model](../architecture/plugin-model.md), [testing](../engineering/testing.md),
   [dependency register](../engineering/dependencies.md) and package READMEs.
4. Create one isolated test profile per candidate and record commands,
   selected versions, setup, fixtures, pass/fail output and rollback.
5. Run `pnpm check` and all affected conformance tests and the
   composition test, followed by crash tests where applicable; code PRs
   changing runtime must also meet normal release gates.
6. Ask for a separate operator decision before enabling a provider,
   migrating persistent records or deleting a previously active package.

**No tests or benchmarks have been run as part of this documentation PR.**

## Rollout and rollback

Start with readonly isolated spikes and off-by-default optional rows.
Record baseline, experiment and provider version at each decision point.
For adopted capability plugins, gate on a configuration switch and verify
disposal. Turn it off and restore the previous provider on incompatible
behavior, anomalous egress, duplicated side effects, lost records or
latency/regression beyond its preregistered bound. Migrations requiring
state transfer need restore-tested backups and a single-writer cutover,
never live dual writes.

## Observability and operations

For each spike report task count, success/failure, compatibility findings,
response time, token/context cost, cold-start and steady-state resource
usage, operator touches, policy refusals and dependency inventory.
Keep evidence in a dated research or validation artifact.
Upstream outages/unknown data must be explicit; absence of telemetry is
not a zero. The resulting implementation PR must update the package README,
dependency register, affected reference and operations docs.

## Security and privacy

All upstream code and plugin outputs are untrusted until audited. Review
source, license, installation hooks, dependencies, ports and permissions
without running arbitrary install scripts in the System host. Neither
Hermes Kanban plugin routes nor community DSH web endpoints inherit
System's operator authorization automatically. The only permitted memory
indexer reads redacted, scoped records; it does not scrape process
environment, vaults or local sessions. No inbound remote tool control,
autonomous skill promotion or second dispatcher is in scope.

## Compatibility and migration

There is currently **no migration**. If a future accepted code PR replaces
a provider, it must document data ownership, explicit schema migration,
configuration changes, safe rollback and code/test deletion. For
guarantee-seam contract changes, seek a separate ADR rather than
reinterpret the current protocol.

## Decision

Awaiting operator review. This proposal deliberately records a **candidate
work plan**, not authorization to adopt any one of the upstream products.

## Implementation

None. Documentation-only groundwork; future bounded PRs should link here
and supply reproducible evidence for each gate.
