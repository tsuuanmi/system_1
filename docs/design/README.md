# Design

This area owns **how mechanisms work**: algorithms, state machines, and protocols inside the
boundaries defined by [architecture](../architecture/README.md). It does not restate structure
or invariants. It links to them.

Each document describes the **target** mechanism and says so. It names its implementation in
one line, "Implemented in [package]; differs from target: …". The package READMEs own the
current state, and the [release checklist](../validation/release-checklist.md) owns what was
verified live.

| Document | Mechanism | Boundary |
|---|---|---|
| [browser-runtime.md](browser-runtime.md) | invisible headed browser (Xvfb), anti-leak launch, multi-account vault, login flows | provider runtime |
| [ui-operations.md](ui-operations.md) | UI maps as data, deterministic resolution, passive network signals, bounded self-heal | provider runtime |
| [provider-turns.md](provider-turns.md) | driver contract, turn receipts, reconciliation, two-clock completion, the turn path | provider runtime |
| [scheduling-and-leases.md](scheduling-and-leases.md) | per-account scheduler, exclusive fence, lease generations | provider runtime, kernel |
| [workflow-engine.md](workflow-engine.md) | DAG, durable nodes, briefs, graph growth, remediation, exact-subject gates, recovery, board tasks, lineage | orchestration |
| [artifacts.md](artifacts.md) | artifact envelope, kinds, decision records, lineage, explain | kernel, orchestration |
| [routing.md](routing.md) | capability vocabulary and scoped offers, admission, least-busy order, data locality, tiers, quota-aware routing | routing |
| [board.md](board.md) | projects with charters, board tasks across runs, their states, leases, and fail-closed waits; funding a spent budget | orchestration (work state machine) |
| [approvals.md](approvals.md) | the autonomy policy, the batched approval queue, a Worker's tool calls, policy changes; expiry denies | routing (gate) |
| [digests.md](digests.md) | cited digests of raw artifacts: economy Worker, quote check, one escalation, failing open; the extractive provider and the swap | orchestration (digest family) |
| [plugin-host.md](plugin-host.md) | plugin manifests checked against the code; the composition's plugins and lifecycle states, each change a decision | kernel (plugin host) |
| [experiments.md](experiments.md) | the experiment registry: identity, fingerprint, registry answers, states, lessons | orchestration (work state machine) |
| [evaluations.md](evaluations.md) | the evaluation engine: pins, seals, judge guard, paired trials, collectors, cost, the verdict rule | orchestration (gate) |
| [statistics.md](statistics.md) | the exact paired sign-flip test, its interval, ties and float tolerance, golden tests against SciPy | orchestration (library) |
| [resources.md](resources.md) | configured pools per account, limit readings, reservations before a run, deduplicated usage after it | routing (resource ledger) |
| [sessions-and-messaging.md](sessions-and-messaging.md) | Worker sessions (SessionId), direct peer messaging, long-running mechanics, A2A alignment | orchestration |
| [task-dossier.md](task-dossier.md) | a board task's dossier: the append-only record Workers that share no session work through, the gated append, the bounded slice in each brief | orchestration |
| [handbook.md](handbook.md) | the handbook in five layers, the per-Worker slice by role, class, risk tier, and touched paths, the 6,000-token bound, adding and retiring a rule | orchestration |
| [packaging.md](packaging.md) | a project from a template by kind (`system project new`): what a template holds, its refusals and checks, the policy-change request | orchestration (packaging) |
| [teams.md](teams.md) | the `team` option on a workflow node: members, independent proposals, sealed ballots, tally, bounded debate, tie votes | orchestration |
| [agent-runtimes.md](agent-runtimes.md) | Claude Code, Codex, ACP agents, and the Antigravity CLI as Workers: tool gate, confinement, agent accounts, metering, review members | capabilities |
| [models.md](models.md) | API and local models as Workers: the model catalog, keys by reference, egress, bounds, restart; the `api-first` preset | capabilities |
| [gateways.md](gateways.md) | Messages and Responses gateways, the text tool protocol, threads, drain; MCP inversion as target | gateways |
| [roster.md](roster.md) | the roster: every Worker in one read model, projected on read, each unreadable fact unknown with why | gateways (surface) |
| [web-ui.md](web-ui.md) | the operator's web UI: what needs you first, a button's effect as its tooltip, one spacing and type scale, light and dark, phone width; its screenshots | gateways (surface) |
| [reports.md](reports.md) | the baseline report: what a period recorded, counted by code; the weekly investor report | gateways (surface) |
| [maturity-metrics.md](maturity-metrics.md) | PROP-0016's maturity metrics over a rolling window, each from named records or said not measurable; the L3 reading | gateways (surface) |
| [notifications.md](notifications.md) | out-of-band notices from recorded events: the expiry reminder, deduplication, the bounded queue, desktop and webhook sinks behind the egress gate, health | gateways (surface) |
