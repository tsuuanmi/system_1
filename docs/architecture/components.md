# Components and boundaries

> Target state. Layers: the [layer map](README.md#layer-map); each layer's packages and dependencies:
> generated [packages](packages.md); mechanisms: [design](../design/README.md); what a package does
> now: its own `README.md`.

Each boundary states what it **owns**, what it **does not own**, and its **contracts** to the layers
above, each published as one or more Cordis seams ([seam catalog](plugin-model.md#seam-catalog)).

Boundaries are cut by layer; the [core and plugin classes](plugin-model.md#core-and-plugin-classes)
cut the same seams by guarantee. Most boundaries hold both: Routing, the gate (admission, acceptance,
egress) beside the routing policy; Orchestration, the work state machine and runner beside the
workflow templates. Changing a guarantee seam's contract needs an ADR ([ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md)).

## Kernel

- **Owns:**
  - the durable store: SQLite in WAL mode, per-plugin migrations, transactions, `afterCommit` hooks ([ADR-0003](../decisions/adr/0003-sqlite-durable-store.md));
  - artifacts: immutable, content-addressed, schema-validated envelopes with lineage, decision records
    included ([artifacts](../design/artifacts.md));
  - the append-only event log, written in the transaction of the change it reports;
  - leases with generations, and fencing of writes by a stale owner;
  - the encrypted credential vault behind DSH `ctx.credentials`;
  - the plugin host's record: every plugin's manifest, lifecycle state, and manifest-check result,
    every change a decision ([plugin host](../design/plugin-host.md));
  - the libraries: canonical JSON hashing, the schema registry, durable owner-only files.
- **Does not own:** domain semantics: it does not know what a workflow, a turn, or a Worker is.
- **Contracts:** `store.transaction / afterCommit / migrate`;
  `artifacts.put / get / list / read / recordDecision / explain`; `eventLog.append / query`;
  `leases.acquire / renew / release / fence / current`; DSH `credentials.resolve / set`;
  `pluginHost.list / get`.

## Provider runtime

- **Owns:**
  - the display (`ctx.display`): a private, X-authenticated Xvfb, never headless;
  - the browser (`ctx.browser`): one headed Chrome context per account, opened from its portable
    state, with filtered capture of refreshed state;
  - accounts (`ctx.accounts`): records, revisioned portable auth state, credentials, and proven
    features, as encrypted grants in `ctx.credentials`;
  - login (`ctx.login`): login profiles, Save, the remote login desktop (reserving the profile), and
    credential sign-in; a session-bound account's operations run in its login profile
    ([ADR-0030](../decisions/adr/0030-session-bound-accounts-use-their-login-profile.md));
  - provider turn receipts (`ctx.turnReceipts`) and the reconciliation decision;
  - the driver registry (`ctx.providers`) and one **driver** per website (`chatgpt-web`, `gemini-web`);
  - the libraries: the per-account scheduler, two-clock completion, the failure taxonomy, the turn
    mechanics every driver shares (`provider-core`), and the UI engine with the shared answer reading
    (UI maps as data, verification, bounded self-heal; [UI operations](../design/ui-operations.md),
    `ui-ops`).
- **Does not own:** Worker admission ([routing](#routing)), workflow semantics, or when a turn runs
  ([capabilities](#capabilities)).
- **Contracts:** the `ProviderDriver` interface in `@tsuuanmi/system-provider-core`
  ([ADR-0005](../decisions/adr/0005-provider-runtime-interface.md)):
  - `provider`, `capabilities` (what the driver proves), `features` and `probeFeatures` (what an
    account may offer, proven per account without sending anything);
  - `loginUrl`, `stateOrigins` (the portable state), `checkAuth`, `identity`, and optional `signIn`
    (bounded credential sign-in);
  - `ask` (with `beforeSend`, where the receipt is written, and `onBinding`) and `snapshot` (reopen a
    bound conversation for reconciliation).

  Credentials never cross upward ([INV-8](invariants.md#inv-8-credentials-never-cross-upward)).
- **Design:** [browser runtime and account vault](../design/browser-runtime.md),
  [provider turns](../design/provider-turns.md),
  [scheduling and leases](../design/scheduling-and-leases.md).

## Capabilities

The capabilities are the **Worker sources**: each describes its Workers to `ctx.workers` and
runs the work the router admitted to them. Callers never reach a source directly.

- **Website Workers** (`ctx.turns`): one Worker per account and tier. It owns the durable turn
  (idempotent by request key), the egress check of the actual prompt, the per-account scheduler, the
  receipt before send, the write-back of refreshed state, the answer artifact, and reconciliation after
  a restart. Persistent sessions stay on their account. It records each website conversation it
  creates and deletes it on its site once its session is released
  ([conversation ledger](../design/provider-turns.md#conversation-ledger)).
- **Agent Workers** (`ctx.agentWorkers`): one Worker per enrolled account and assigned role
  (`agent:<accountId>/<role>`, derived from role templates and assignments), or per hand-named row
  until the operator moves them (`system account migrate`), held to a policy from configuration
  (workspace, sandbox, tool allow-list). Its row, `agent-runtimes`, and the Claude Code runtime's are on
  by default, with no Worker until the operator names a repository
  ([agent Workers](../operations/runbooks.md#agent-workers)); the Codex, ACP, and Antigravity CLI rows
  are off.
  - Capabilities are what the runtime's `probe()` proves now; a policy the runtime cannot enforce
    leaves the Worker unavailable; only a runtime proving its commands confined (`executes`) gives a
    writable Worker `validate`.
  - Runs are durable, one at a time per Worker and up to `maxConcurrentRunsPerAccount` per account; a
    started run is never rerun by itself. In a workflow run's new worktree it first runs the
    repository's setup (commands the policy allows, confined, offline;
    [a worktree's setup](../design/agent-runtimes.md#a-worktrees-setup)).
  - It keeps each runtime's enrollment slots and the agent accounts in them, identified by a keyed hash
    of the verified login (key in `ctx.credentials`), quarantining a missing, changed, ambiguous,
    duplicate, or unverified one, and offers the operator's `account_enroll`, `account_remove`,
    `account_agents`, `account_migrate` tools on `ctx.mcp`
    ([agent accounts](../design/agent-runtimes.md#enrollment-and-quarantine),
    [account × role](../design/agent-runtimes.md#workers--account--role)).
  - A read-only Worker configured `reviewMember` takes only a `review` member's steps, every tool call
    denied ([review members](../design/agent-runtimes.md#review-members)).
  - The model is remote: each prompt passes the egress check first. Every tool call passes the
    run's gate, the autonomy policy through `ctx.approvals`; a runtime that cannot ask a gate is not
    admitted, and a call the policy asks about stops the run until the operator's verdict
    ([a Worker's tool calls](../design/approvals.md#a-workers-tool-calls)).
  - A Worker with a resource pool is metered through `ctx.resources`: it reserves before a run and
    records one usage record from the runtime's own numbers and its limit observations after
    ([agent runtimes](../design/agent-runtimes.md#metering)); a run the ledger counts nothing of is a
    `usage.unknown` event
    ([usage the ledger cannot count](../design/resources.md#usage-the-ledger-cannot-count)). Each ready
    account with a declared pool also has its runtime's usage report read into the pool after its runs
    and every `limitReadSeconds`, never reopening a closed window
    ([an account's usage report](../design/agent-runtimes.md#an-accounts-usage-report)).
  - With `worktreePerRun`, a Worker works per workflow run in that run's own git worktree; the source
    removes it, its changes committed on the run's branch, once the run has been idle past a retention
    ([workspaces](../design/agent-runtimes.md#workspaces)). On the engine's ask it lands an accepted
    result made there on the operator's `merge` approval, starts a task's next attempt from the tree
    the previous attempt left, and runs a run's required checks on its result's exact tree with the
    operator's configured commands, confined as its setup is
    ([landing a worktree](../design/agent-runtimes.md#landing-a-worktree),
    [carrying an earlier run's work](../design/agent-runtimes.md#carrying-an-earlier-runs-work),
    [a run's checks](../design/agent-runtimes.md#a-runs-checks)).
- **Agent runtimes** (`ctx.agentRuntimes`): providers for Claude Code (Claude Agent SDK), Codex
  (Codex SDK), ACP agents, and the Antigravity CLI (its installed `agy`, only on a version verified
  live, every tool call held by its PreToolUse hook, bridged to the run)
  ([agent runtimes](../design/agent-runtimes.md)). Each agent process starts without the daemon's
  credentials, in a home of its own, and cannot read host state (the DSH home, the session's runtime and
  temporary directories, registered secret paths, every agent's login): the registry confines reads with bubblewrap around every agent
  ([ADR-0024](../decisions/adr/0024-agent-workers-confined-for-reads.md)). Commands run in each
  runtime's own nested sandbox (Codex's, or the Agent SDK's for Claude Code), writing only the
  workspace with no network, proven by the probe
  ([ADR-0038](../decisions/adr/0038-confined-commands-for-claude-code-workers.md)). Claude Code and
  Codex ask a run's tool gate through one PreToolUse hook; Codex's reaches the gate over a per-run
  socket ([ADR-0042](../decisions/adr/0042-codex-workers-ask-the-gate-through-a-hook-bridge.md)).
- **Model Workers** (`ctx.models`, the `models` source): one Worker per entry of the operator's model
  catalog, API or local, over the DSH `llm` service
  ([models](../design/models.md)). Calls are durable and idempotent by key, the exact prompt passes the egress
  check (Worker class `model` or `model-local`), output tokens, concurrency, re-attempts, and
  time are bounded, and a restart-interrupted call is sent once more at most ([purpose P4](../requirements/purpose.md#p4-cheap-models-do-low-level-work-strong-models-do-hard-work)).
  The source also keeps sessions by replaying their transcript
  ([ADR-0031](../decisions/adr/0031-model-worker-sessions-by-replay.md)).
- **Does not own:** routing, acceptance, or workflow steps.
- **Contracts:** the `WorkerSource` interface in `@tsuuanmi/system-workers-core`:
  `describe` (capability descriptors with evidence), `start` (durable at once, idempotent by `key`;
  `runId` names the workflow run; `brief` names the `brief@1.x` the source renders its prompt from at
  start, pointers resolved and egress-checked there, [briefs](../design/workflow-engine.md#briefs)),
  `get`, `wait`, and optional `reserve` (an admission counted in the Worker's load until it starts),
  `sandbox` (the confinement a brief names), `affinity`, `siblings` (the Workers on its account),
  `handle`, `reset`, `release`, `cancel`. An agent runtime provides `kind`, `probe()`
  (`RuntimeEvidence`), and `run(spec, signal, onHandle)`, whose result may carry `RunMetering` and
  whose `spec.toolGate` it asks before each tool call (`allow`, `deny`, `defer`); for agent accounts it
  may add `home`, `identity(home, key)`, and `loginCommand(home)`, and run and probe in a named home
  when its evidence reports `homes` ([seam contract](../design/agent-runtimes.md#seam-contract)).
  `ctx.models` provides `list()` (catalog entries with availability) and `complete(request, signal)`.

## Routing

- **Owns:** the Worker-source registry, fail-closed admission, the deterministic router, acceptance
  contracts, the egress policy (classification per Worker class and a credential scan of
  the actual payload, [INV-12](invariants.md#inv-12-data-egress-is-explicit)), and the resource ledger
  (what each configured pool has left and what every run consumed).
- **Worker:** an *opaque assignable executable unit with proven current capabilities*, answering only:
  1. Can it accept this work now?
  2. How is it invoked or cancelled through its owning runtime?
  3. What result and evidence did it produce?
- **Does not own:** a Worker's internals. Model, runtime, tools, and state are not normalized into a
  universal interface.
- **Contracts:** `workers.route(requirement, { restrict, excludeWorkers, exclude, input, assignment })
  → AdmittedWorker` (with `tier` and `route` decisions) or `AdmissionFailure` (with an `admission`
  decision; `limitUntil`, the earliest known reset, when every Worker refused only for its limit is on an
  assigned account);
  `workers.candidates(requirement, options)` (optional) → every Worker with the checks it fails, under
  the same lock, nothing reserved, no decision recorded
  ([candidates](../design/routing.md#candidates-without-a-reservation));
  `workers.accept(result, contract) → Acceptance` (with an `acceptance` decision);
  `workers.register(source)`, `workers.contract(id, check)`, `workers.source(name)`;
  `egress.check({ payload, classification, workerClass }) → allowed + egress decision`.
- **Gate and resource ledger:** `ctx.approvals` (provider `approvals`, on the store): the autonomy
  policy (from configuration or an operator-approved change) and the one batched approval queue,
  whose expiry denies; MCP tools `approvals_*` (`approvals_decide` and
  `approvals_policy_propose` at operator scope) and the operator's queue and policy page on the web UI
  ([approvals](../design/approvals.md)). The queue may propose a policy change from
  repeated identical approvals, never apply it, off unless configured
  ([the queue proposes a policy change](../design/approvals.md#the-queue-proposes-a-policy-change)).
  `ctx.resources` (provider `resources`, on the store): configured pools, pools from templates for the
  accounts a Worker source declares, limit readings, reservations before a run, deduplicated usage
  after it; MCP tools `resources_*` ([resources](../design/resources.md)). Contracts: `approvals.check / request / batch / decide /
  withdraw / sweep`, from contract 1.1 `proposePolicy / policyChanges`; `resources.pools / observe /
  reserve / release / record / usage`, from contract 1.1 `declare`, from 1.2 `quota` ([quota
  settings](../design/resources.md#quota-settings)).
- **Policy inputs:** proven capabilities, data locality, Worker state, tier, session affinity, and
  provider family (compared only for inequality): the three [purposes](../requirements/purpose.md) as
  mechanics.
- **Design:** [routing](../design/routing.md).

## Orchestration

- **Workflow engine** (`ctx.workflow`): runs **all** multi-step work as an append-only DAG
  ([ADR-0012](../decisions/adr/0012-dag-execution-model.md)): templates, durable nodes, input-hash
  binding, routing every node by its requirement, acceptance, escalation, retries, graph growth from
  plans, plan approval gates, teams (proposals, sealed ballots, tally, bounded debate, tie votes,
  review), exact-subject review and remediation cycles, wake-on-message, operator stop, continue,
  supersede, delete, drain and resume
  ([workflow engine](../design/workflow-engine.md), [teams](../design/teams.md)). Each Worker
  execution it starts gets a `brief@1.1` it composes and records first: the node's instructions with
  every artifact by content id, the task it serves, its criteria, and the Worker's confinement
  ([briefs](../design/workflow-engine.md#briefs)).
  - A run may serve one board-task attempt, owned by the engine on `ctx.board` (optional, through the
    abstract `Board`). Before each step it reserves the task's budget lines on `ctx.resources`
    (optional); a spent line blocks the task with a funding request, none on its last attempt ([a task's budget](../design/workflow-engine.md#a-tasks-budget)). A node refused only for
    assigned accounts' limits waits for the reset, bounded, spending no attempt
    ([waiting for an account's limit](../design/workflow-engine.md#waiting-for-an-accounts-limit)).
  - Through the abstract `Approvals` (optional), a remediation fix's gate asks the queue
    ([remediation on the queue](../design/workflow-engine.md#remediation-on-the-approval-queue)).
  - Through the optional `workers` methods `land`, `carry`, and `check` and the landing seam
    `ctx.landing` (`landing-core`, provider `landing-local`; with none, a landing waits), a task's
    accepted result is landed, a next attempt starts from the previous one's work, and the policy's
    command checks run on a written result's exact tree
    ([landing an accepted result](../design/workflow-engine.md#landing-an-accepted-result),
    [the landing seam](../design/workflow-engine.md#the-landing-seam),
    [starting from the previous attempt's work](../design/workflow-engine.md#starting-from-the-previous-attempts-work),
    [a run's required checks](../design/workflow-engine.md#a-runs-required-checks)).
  - Its dispatch pass starts ready board tasks itself under the action class `dispatch`
    ([dispatch](../design/workflow-engine.md#dispatch-starting-ready-work-by-itself)). A configured
    dispatch advisor (none by default; seam `ctx.dispatchAdvisor`, `decision-core`) is asked about each
    choice after it is made and never changes it
    ([the dispatch advisor in shadow](../design/workflow-engine.md#the-dispatch-advisor-in-shadow)).
- **Worker sessions** (`ctx.workerSessions`): durable sessions, each with a `SessionId`, a binding to
  the native handle, groups, and a mailbox for direct peer messages under barriers ([sessions and messaging](../design/sessions-and-messaging.md)).
- **Board** (`ctx.board`): projects with charters and board tasks that outlive a run, stored as records
  with leases and expiring waits; it asks for approvals through `ctx.approvals` (it is mounted only
  with it), serves the `board_*` MCP tools, and projects a project's board to `TASKS.md`
  ([board](../design/board.md)). Its bundle row is on. The workflow run serving an attempt makes its
  holder and run-owner moves, never a `board_*` tool; project moves (pause, resume, close) are the
  operator's.
- **Digests** (`ctx.digests`, digest family): a cited `digest@1.0` of raw artifacts, on request
  (MCP `digests_request`), written by a read-only economy-tier Worker and quote-checked before it is
  stored: a claim whose quote is not verbatim in the artifact it cites is dropped and recorded; when
  every claim fails, it is written once more on the standard tier, never higher. It fails open: an unserved
  request is settled `bypassed` and recorded ([digests](../design/digests.md)). The
  engine asks for a digest of each board task's result once it reached the board and sets it through
  the board's `attachDigest`. Two providers, one running at a time: `digest` (row on) gives its Worker
  the sources whole; `digest-extractive` (row off) gives it verbatim spans code selected first
  ([extractive-first](../design/digests.md#extractive-first)).
- **Experiment registry** (`ctx.experiments`, [defined](plugin-model.md#seam-catalog)): hypotheses and
  pre-registered experiments; every registration answered EXACT_REPEAT, RELATED, CONTEXT_CHANGED, or
  NOVEL, and pre-registered or refused as a `registration` decision; each experiment's state while the
  evaluation engine runs it; and lessons ([experiments](../design/experiments.md)).
- **Evaluation engine** (`ctx.evaluations`, [defined](plugin-model.md#seam-catalog)): a pre-registered
  experiment run offline as paired trials under its pins and seals, measured by collectors
  (`evaluations.collector`) and the resource ledger, analysed once at the horizon, and classified by
  the deterministic verdict rule as a `verdict` decision; it decides no promotion, which always asks
  the operator ([evaluations](../design/evaluations.md)).
- **Statistics** (library): the intervals the verdict rule reads, pinned by version in each experiment;
  inference only, no threshold: the exact paired sign-flip test and the interval that inverts it,
  golden-tested against SciPy ([statistics](../design/statistics.md)).
- **Profiles:** plugins that contribute templates through `ctx.workflow.template` (`research`, with its
  `deep` variant; `agent-review` and `algorithm-development`, for the agent Workers, row off by
  default) and acceptance contracts through `ctx.workers`. A profile never names a provider, browser,
  or account, and holds no engine code.
- **Does not own:** provider mechanics, Worker admission, or protocol framing.
- **Contracts:** `workflow.start / wait / get / approve / vote / stop / continue / supersede / delete /
  drain / resume / explain / usage`, `workflow.template(name, nodes)`;
  `workerSessions.join / send / inbox / ack / openBarrier / activate / settle`;
  `board.charter / propose / claim / renew / start / submit / accept / reconcileRun / block / answer /
  cancel / pause / resume / close / sweep / attachDigest`; MCP `board_*`, and `run` with `task`; `digests.request / get / wait`, MCP
  `digests_request`, `digests_get`; `experiments.lookup / register / get / list / link / begin / settle /
  close / recordLesson / lessons`; `evaluations.collector / start / sweep / get / list`.

## Host

- **Owns:** composition on **DSH core**. The `system` profile lists the `system` bundle first, which
  inserts the allow-listed DSH rows and `system` plugins, no `dsh-base`
  ([ADR-0019](../decisions/adr/0019-explicit-minimal-dsh-core.md)). The `system` CLI creates the
  profile and runs `dsh --profile system` with telemetry off. Cordis validates every plugin `Config` at
  startup, isolates failures per plugin, and runs disposers on shutdown
  ([ADR-0018](../decisions/adr/0018-build-on-dsh-core.md)). Every plugin package ships a manifest
  generated from its code and checked in CI; the plugin host records each plugin's lifecycle state and
  checks it against its manifest at start
  ([plugin host](../design/plugin-host.md)).
- **Does not own:** business logic. `inject` resolves dependencies; the host never wires layers by hand.

## Gateways

- **MCP server** (`ctx.mcp`): Streamable HTTP at `/mcp` behind the operator and client tokens. Plugins contribute
  tools for their lifetime, each declaring the scope that may call it
  ([MCP tools](../reference/mcp-tools.md), [ADR-0023](../decisions/adr/0023-scoped-control-credentials.md)).
  Its `status` tool gives the host's health, read from the mounted services, the resource ledger, the
  event log, and the board's reviews held for the operator
  ([mcp-server](../../packages/plugins/mcp-server/README.md)).
- **Request guard** (in `gateway-core`): one set of transport checks for every client endpoint (MCP,
  both protocol gateways, the web UI): a loopback `Host`, no browser `Origin`, the bearer token in
  constant time (which decides the caller's scope), bounded JSON bodies, and no route on a plain-HTTP
  non-loopback bind. It also creates the owner-only scope token files.
- **Anthropic Messages gateway** (`/anthropic`) and **Responses gateway** (`/openai`): Claude Code and
  Codex use website Workers as their model. Both rows are off by default; Claude Code reaches `system` over MCP. Each request is an `ask` run on a thread bound to one persistent provider
  conversation; the client's tools travel through the text tool protocol and the client runs every
  call
  ([ADR-0022](../decisions/adr/0022-text-protocol-tool-calls-for-website-models.md)).
- **Gateway turns** (library): the text tool protocol and threads both client-protocol gateways share;
  each owns only its wire format.
- **Web UI** (`/ui`) and **CLI**: the operator surface for runs, approvals, accounts, remote login, and
  maintenance. The CLI calls the MCP tools of the running profile. With `ctx.approvals` the web UI
  shows the approval queue by batch and passes the operator's verdicts on; with `ctx.board`, the
  board's reviews and projects, with the operator's acceptance and project moves
  ([web UI API](../reference/web-ui.md)).
- **Roster** (in `gateway-core`): every Worker in one read model, projected on read from the Worker
  registry, the account and enrollment records, the resource ledger, the event log, the workflow runs,
  and the board, each unreadable fact shown as unknown with why; no state of its own. Served as MCP
  `roster` (client scope), `system roster`, and the web UI's Workers tab
  ([roster](../design/roster.md)).
- **Report** (`report`): the baseline report of a period, for one project or all, from recorded data
  only (the board, the approval queue, the resource ledger, the event log), as MCP `report` and
  `system report`; by default the weekly investor report. It writes and decides nothing ([reports](../design/reports.md)).
- **Notifications** (`notify`, row off): out-of-band notices, from recorded events only, of what needs
  the operator (an approval request opened or about to expire, a run failed for the operator or
  escalated, a step waiting for an account's limit, a pool closed, an agent account quarantined), on
  the desktop or, opt-in, to a webhook behind the egress gate. It reads the event log
  after its own cursor, decides nothing, and records outcomes as events health reads
  ([notifications](../design/notifications.md)).
- **Does not own:** orchestration state; gateways only translate protocols and enforce transport
  security.
- **Design:** [gateways](../design/gateways.md), [reports](../design/reports.md),
  [roster](../design/roster.md), [notifications](../design/notifications.md); wire details in
  [reference](../reference/gateways.md).

## Parked

[PROP-0022](../proposals/0022-lean-core.md#6-park-what-is-not-used-bundle) chose the parked parts
(evidence: [lean-core research](../research/lean-core-2026-11-01.md#5-what-is-used)). A parked
plugin's row is off in the shipped bundle and its package frozen (only a security fix; tests still
run). A parked library with no row is only frozen. No code is removed.

**What turns it back on.** A row: its `disabled` in the bundle, or `system plugin on`
([ADR-0078](../decisions/adr/0078-a-plugin-or-a-mechanism-is-turned-off-at-runtime.md)). A part with
its own key: that key. A template: naming it in a run. A frozen library: the first change needing it unfreezes it.

**Deletion.** A separate decided change may delete a parked part unused for 30 days (event log). This
section deletes nothing.

| Part | Why (research, section 5) | Turned back on by |
|---|---|---|
| `feedback-core`'s experiments, evaluations, statistics: deleted on 2026-11-04 by the operator's decision, before the 30 days | no runtime use, no importers | a change that rebuilds them from git history |
| `gateway-anthropic`, `gateway-responses` | 16 conversations ever | their rows: `disabled: false` |
| `runtime-antigravity-cli`, `runtime-acp` | rows off; no run | their rows: `disabled: false` |
| `digest-extractive` | the second provider of one seam, row off | the row on and `digest` off, in one patch |
| `scheduled-review` (in `workflow`) | 6 runs, all failed (`stale_subject`) | `workflow.scheduledReview.enabled` |
| the dispatch advisor | 0 advice given, 323 unavailable | `dispatch.advisor.provider` |
| templates `panel`, `panel-led`, `study`, `investigate`, and the stand-alone `develop` (not the `develop:1` step of `algorithm-development`) | 1 to 4 runs each in 30 days | naming the template in a run |

**Kept though rarely used**, because another part needs it:

| Part | Why kept |
|---|---|
| session handoffs (`workflow`'s sessions) | 0 rows, but a run's continuation needs them |
| board escapes | goal 5's escaped defects are counted from them |
| board breakers | dispatch's bounds (INV-9) |
| `check:reviewer-eval` (`scripts/experiments`) | a required check; it imports none of the parked packages |
