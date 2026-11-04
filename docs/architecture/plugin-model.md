# Plugin model

> Target state. Decisions: [ADR-0007](../decisions/adr/0007-everything-is-a-plugin.md),
> [ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md) (guarantee core and
> capability plugins),
> [ADR-0018](../decisions/adr/0018-build-on-dsh-core.md) (build on DSH core),
> [ADR-0019](../decisions/adr/0019-explicit-minimal-dsh-core.md) (only the DSH core rows we use).
> Invariants: [INV-10](invariants.md#inv-10-everything-is-a-plugin),
> [INV-11](invariants.md#inv-11-no-tool-lock-in).

`system` follows the **Everything Is A Plugin** philosophy of DeepSeek Harness and is built **on DSH
core**: a DSH bundle and profile that mounts only the DSH core rows it uses (no `dsh-base`), on the
same plugin runtime, Cordis. Every part of the product is a plugin: the store, the provider drivers,
the router, the workflow engine, each gateway. There is no privileged core to patch. You extend
`system` by mounting a plugin beside the others, and every registration is an effect that unwinds
when its plugin unloads.

A **guarantee seam** carries a correctness or safety guarantee and belongs to one of six core
components; a **capability seam** only carries capability and belongs to one of eight plugin families
([core and plugin classes](#core-and-plugin-classes)). Both are ordinary plugins; they differ in how their contracts change and how they fail.

## Vocabulary

| Term | Meaning |
|---|---|
| **plugin** | a module with `apply(ctx, config)`, optional `inject`, and a validated `Config`, or a Cordis `Service` subclass |
| **service** | a stable `ctx.<key>` claimed by one plugin. Consumers find it by key, never by importing an implementation |
| **seam** | a swappable capability with three roles: a **definition** (an abstract `Service` class that owns the key and its vocabulary types), one or more **providers**, and one or more **consumers** |
| **library** | a plain module with no `apply` and no service, used for pure logic that has nothing to swap |
| **profile** | a named, ordered composition of bundles plus the operator's patch file |
| **bundle** | a distributable set of config rows and the plugins they mount |

## Seam catalog

Each boundary in [components](components.md) is published as one or more seams. Status is one word:
**built**, **defined** (an abstract definition, a protocol, and a conformance suite a fake provider
passes, no real provider yet), **planned**, or **not planned**. Who injects what is generated from the
code in [packages](packages.md); this table names the roles.

| Layer | Seam (`ctx.*`) | Class | Status | Definition and providers | Main consumers |
|---|---|---|---|---|---|
| Kernel | `store` | core: ledger of record | built | `system-store` (`node:sqlite`, WAL) | every stateful plugin |
| Kernel | `artifacts` | core: ledger of record | built | `system-artifacts`: envelope, ids, lineage, schema validation, decisions. `list` takes optional `newest` (contract 1.1) and `outcome` (1.2), both additive | every producer of results or decisions |
| Kernel | `eventLog` | core: ledger of record | built | `system-event-log` (named so because Cordis owns `ctx.events`). Contract 1.1 adds an optional newest-first read (`order: 'desc'`, `beforeSeq`), additive ([ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md)): a reader takes the latest entries of a run or type and pages back | append: workflow, turns, agent-workers, models, approvals, board, resources, the `digests` providers, browser-patchright, both website drivers, notify; listen: profile-scientific-research, notify (wake-ups); query: workflow (the request a deferred Worker call waits on), report, notify (after its cursor), mcp-server (`events`; health checks), web-ui (activity since a time, the live view) |
| Kernel | `leases` | core: work state machine | built | `Leases` in `system-board-core`, provided by `system-leases` (generations, fencing). Contract 1.1: `hold` aborts `lost` only on a positive loss, never on a failed renewal ([ADR-0056](../decisions/adr/0056-a-failed-lease-renewal-is-not-a-lost-lease-and-death-needs-a-verdict.md)) | workflow, turns, agent-workers, models, board, the `digests` providers |
| Kernel | `credentials` | core: ledger of record (secrets) | built | definition: **DSH** `dsh-credentials`; provider: `system-credentials-vault` (encrypted at rest) | accounts, `llm-pi-ai` (route keys by reference), models (`model_key`), agent-workers (the key of agent account ids) |
| Provider runtime | `display` | plugin: Worker | built | `Display` in `system-provider-core`; `system-display-virtual` (Xvfb) | browser |
| Provider runtime | `browser` | plugin: Worker | built | `Browser` in `system-provider-core`; `system-browser-patchright` | turns, login |
| Provider runtime | `providers` | plugin: Worker | built | `ProviderRegistry` in `system-provider-core`; registry `system-providers`; drivers `provider-chatgpt-web`, `provider-gemini-web` register into it. Optional, additive: a driver's `title` for people (ChatGPT, Gemini), carried by its Workers (`capability-descriptor@1.8`) as the roster's display name, never a routing input ([driver interface](../design/provider-turns.md#driver-interface)); `ProviderError.siteError`, the site's own error after the send ([a site's own error](../design/provider-turns.md#a-sites-own-error-after-the-send)); `checkAuth({ save })`, the operator's Save check in the login profile | turns, login |
| Provider runtime | `accounts` | plugin: Worker | built | `system-accounts` (records and grants in `ctx.credentials`) | turns, login |
| Provider runtime | `login` | plugin: Worker | built | `system-login`: login profiles, Save, remote login, credential sign-in | operators (MCP `account_*`), turns |
| Provider runtime | `turnReceipts` | core: runner | built | `system-turn-receipts` | turns |
| Capabilities | `turns` | plugin: Worker | built | `system-turns`: the `website` Worker source | `ctx.workers`, through the source it registers |
| Capabilities | `agentRuntimes` | plugin: Worker | built | `AgentRuntimes` in `system-agent-runtime-core`; registry `system-agent-runtimes`; providers `runtime-claude-agent-sdk`, `runtime-codex-sdk`, `runtime-acp`, `runtime-antigravity-cli` ([seam contract](../design/agent-runtimes.md#seam-contract)). Optional, additive: a provider's `title` for people (never a routing input); a per-tool-call gate (`RunSpec.toolGate`, asked through bounded, fail-closed `askToolGate`) of a runtime that reports `gatesToolCalls`, refused by one that cannot ([tool gate](../design/agent-runtimes.md#tool-gate)); several accounts per runtime ([ADR-0051](../decisions/adr/0051-agent-accounts-are-enrolled-slots-identified-by-their-login.md)): `RunSpec.home`, `probe({ home })`, `identity(home, key)`, `loginCommand(home)`, `home`, refused by a provider that does not report `homes` ([agent accounts](../design/agent-runtimes.md#agent-accounts), [identity readers](../design/agent-runtimes.md#identity-readers)); the liveness verdict: `run`'s `RunObserver` ([restart and liveness](../design/agent-runtimes.md#restart-and-liveness)); each account's quota: `limits({ home }, signal)`, the account's own usage report as limit observations or `unreadable`, read without a model turn on a checked runtime version, asked through `readLimits` ([ADR-0059](../decisions/adr/0059-quota-readings-from-each-accounts-own-usage-report.md), [an account's usage report](../design/agent-runtimes.md#an-accounts-usage-report)) | agent-workers |
| Capabilities | `agentWorkers` | plugin: Worker | built | `system-agent-workers`: the `agents` Worker source. Agent accounts sit in enrollment slots, quarantined unless verified ([enrollment](../design/agent-runtimes.md#enrollment-and-quarantine)); Workers derive as account × role ([account × role](../design/agent-runtimes.md#workers--account--role)); a read-only Worker configured `reviewMember` takes a `review` member's steps only ([review members](../design/agent-runtimes.md#review-members)); its source tells its runs' liveness, frees what a run that ended `unknown` holds (`agent_run_free`), lists and removes run worktrees (`agent_worktrees`, `agent_worktrees_remove`), lands an accepted result (`land`) and carries a task's next attempt's worktree (`carry`) ([landing a worktree](../design/agent-runtimes.md#landing-a-worktree), [carrying an earlier run's work](../design/agent-runtimes.md#carrying-an-earlier-runs-work), [ADR-0061](../decisions/adr/0061-a-tasks-next-attempt-starts-from-the-work-its-previous-attempt-left.md)) | `ctx.workers`, through the source it registers; mcp-server (health) |
| Capabilities | `models` | plugin: Worker | built | `Models` in `system-models-core`; provider `system-models` over **DSH** `ctx.llm` (`llm`, `llm-pi-ai`) ([models](../design/models.md)) | the `models` Worker source in `system-models` |
| Routing | `workers` | core: gate (admission, acceptance); its routing policy is a decision input | built | `Workers` in `system-workers-core`; `system-workers`. A start names the `brief` its source renders its prompt from ([briefs](../design/workflow-engine.md#briefs)). A descriptor may name its `account` (`id`, `group`, `assigned` or `pooled`); under `assigned`, a Worker at its limit holds its work off its group's other accounts, and a refusal for such limits carries `limitUntil` ([assigned accounts](../design/routing.md#assigned-accounts), [ADR-0052](../decisions/adr/0052-accounts-are-assigned-unless-pooling-is-recorded.md)). An execution's error may carry `siteError`: the input was sent and the site answered with its own error ([ADR-0062](../decisions/adr/0062-a-team-members-first-step-is-resent-once-after-a-sites-own-error.md)). Optional methods: `sources()` ([sources that do not answer](../design/routing.md#sources-that-do-not-answer)); `held(sessionId)` (why a session takes no input now; [held sessions](../design/agent-runtimes.md#held-sessions), [ADR-0056](../decisions/adr/0056-a-failed-lease-renewal-is-not-a-lost-lease-and-death-needs-a-verdict.md)); `liveness(query)` ([what the operator sees](../design/agent-runtimes.md#what-the-operator-sees)); `land(step)` ([ADR-0060](../decisions/adr/0060-an-accepted-result-lands-on-the-operators-merge-approval.md)); `changes(runId)` ([a run's change](../design/agent-runtimes.md#a-runs-change-for-the-operators-review)); `carry(step)` ([ADR-0061](../decisions/adr/0061-a-tasks-next-attempt-starts-from-the-work-its-previous-attempt-left.md)); `check(step, signal)`, the run's required checks on the exact tree of its result, each `passed`, `failed`, or `error` ([a run's checks](../design/agent-runtimes.md#a-runs-checks), [ADR-0063](../decisions/adr/0063-a-runs-required-checks-run-on-its-exact-result.md)); `candidates(requirement, options)`, every Worker with the checks admission fails it on, in the router's order, reserving nothing and recording no decision ([candidates](../design/routing.md#candidates-without-a-reservation), [ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md)) | workflow (`explain` reads `liveness`; landing calls `land`; a task's next attempt calls `carry`; acceptance calls `check`; the dispatch pass calls `candidates`), digests; profile-scientific-research adds acceptance contracts; mcp-server (health reads `sources()` and `liveness()`; the roster); web-ui (the roster; a review's change reads `changes`) |
| Routing | `egress` | core: gate | built | `Egress` in `system-workers-core`, provided by `system-egress`: classification policy and credential scan (INV-12) | turns, agent-workers, models, workflow |
| Orchestration | `workflow` | core: work state machine, runner; templates are the workflow family | built | `system-workflow`; templates through `ctx.workflow.template`. Contract 1.12. It states a board task's budget, a run's question, and `TASKS.md` in a run's worktree ([ADR-0053](../decisions/adr/0053-workflow-contract-states-task-budget-question-and-tasks-file.md)); under assigned accounts a node refused only for their limits waits for the reset (recovery `wait`, bounded by `maxLimitWaitHours`) and an unsent failure never moves to another account of its group ([ADR-0052](../decisions/adr/0052-accounts-are-assigned-unless-pooling-is-recorded.md)), and a team member avoids every Worker on an account another member holds ([distinct accounts](../design/teams.md#distinct-accounts)); a task's next attempt never resumes a session its Worker source holds ([ADR-0056](../decisions/adr/0056-a-failed-lease-renewal-is-not-a-lost-lease-and-death-needs-a-verdict.md)); a team member's first step the site answered with its own error is resent once as a recovery decision `resend` ([ADR-0062](../decisions/adr/0062-a-team-members-first-step-is-resent-once-after-a-sites-own-error.md)); the dispatch pass starts ready board tasks under the action class `dispatch`, with `sweepDispatch`, `dispatchStatus`, `pauseDispatch`, `resumeDispatch`, MCP `dispatch_status` (client), `dispatch_pause` and `dispatch_resume` (operator) ([dispatch](../design/workflow-engine.md#dispatch-starting-ready-work-by-itself), [ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md)). `setDispatchAdvisor` and the optional seam `dispatchAdvisor` (a registered provider is asked in place of the configured advisor, a `setDispatchAdvisor` one, now a thin path, in place of both) record an advice decision beside every dispatch choice, never changing it ([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md)). Additive changes follow [ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md) | gateways, web-ui, profiles |
| Orchestration | `leadInbox` | plugin: surface | built | `system-lead-inbox`: a project's lead inbox, `lead-notice@1.0` records from recorded events, read by MCP `lead_inbox`, `system lead wait`, and the `/ui` Lead panel, pushed to the project's sinks ([the lead's inbox](../design/notifications.md#the-leads-inbox)) | web-ui |
| Orchestration | `workerSessions` | core: work state machine | built | `system-worker-sessions` ([design](../design/sessions-and-messaging.md)). Contract 1.1 adds the binding runtime `antigravity-cli` (`worker-session@1.1`; [ADR-0015](../decisions/adr/0015-worker-sessions-and-peer-messaging.md#amendment-2026-10-23-contract-11-names-the-antigravity-cli-runtime)) | workflow |
| Gateways | `mcp` | plugin: surface (its scope check is a gate rule) | built | `McpTools` in `system-gateway-core`; `system-mcp-server` (own: DSH has only an MCP client) | tool contributors: login, turns, workflow, worker-sessions, models, resources, approvals, board, report, the running `digests` provider (the seam's own tools), and agent-workers (`account_enroll`, `account_remove`, `account_agents`, `account_migrate`, `agent_run_free`, `agent_worktrees`, `agent_worktrees_remove`); mcp-server adds `status`, `roster`, `events`, `evidence`, `artifact`, and the operator's runtime switches `plugin` and `enforce` (over `ctx.pluginHost`). Each tool declares its scope, `operator` by default ([ADR-0023](../decisions/adr/0023-scoped-control-credentials.md)) |
| Kernel | `pluginHost` | core: plugin host | built | `PluginHost` in `system-plugin-host-core` ([plugin host](../design/plugin-host.md)): every plugin of the composition with the manifest its package declares (`plugin-manifest@1.x`) and each plugin's lifecycle state, every change recorded first as a `lifecycle` decision; Base records and automates nothing. Contract 1.1: the manifest check. A mounted plugin without a valid manifest its configuration allows, or with a consumed seam its providers' manifests do not satisfy, is recorded once as a `gate` decision, listed, and makes health down; the host cannot refuse the row ([ADR-0048](../decisions/adr/0048-the-plugin-host-checks-the-composition-at-start.md)). 1.2: the operator's runtime switches, each optional: `rows`, `turn` (an optional row off or on in the running host, kept in the profile's patch), `enforcement`, `setEnforce`, `enforced` ([turning a plugin off](#turning-a-plugin-off), [ADR-0078](../decisions/adr/0078-a-plugin-or-a-mechanism-is-turned-off-at-runtime.md)). Provider `system-plugin-host` (on `ctx.store`; rows read from the DSH loader at start), its bundle row on | mcp-server (`status`) |
| Host | `webServer` | plugin: surface | built | **DSH** `dsh-host-webserver` (loopback) | mcp-server, gateway-anthropic, gateway-responses, web-ui |
| Routing | `resources` | core: resource ledger and metering | built | `Resources` in `system-resources-core` ([resources](../design/resources.md)): pools and their windows, limit readings, reservations before a run, deduplicated usage records from objective sources only. Optional `declare` (contract 1.1): one pool per template and account a Worker source declares ([pool templates](../design/resources.md#pool-templates), [ADR-0052](../decisions/adr/0052-accounts-are-assigned-unless-pooling-is-recorded.md)). Optional `quota()` (1.2): the operator's quota settings, validated when the row loads ([quota settings](../design/resources.md#quota-settings), [ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md)). 1.3: `record` takes `usage-record@1.1`, whose `partial` keeps a lower bound, and a cap of its run's scope stays refused until a whole record ([ADR-0065](../decisions/adr/0065-a-cap-fails-closed-on-usage-the-ledger-could-not-count.md)). Provider `system-resources` (on `ctx.store`) | agent-workers (reserve, record, observe for a Worker with a pool; declares its ready assigned accounts), workers (routing by scarcity), workflow (run budgets; the dispatch pass reads `pools()` and `quota()`), surfaces (reports, health, MCP `resources_*`) |
| Routing | `approvals` | core: gate | built | `Approvals` in `system-approvals-core` ([approvals](../design/approvals.md)): the autonomy policy and one batched approval queue for every action that needs a person, expiry denying. Provider `system-approvals` (on `ctx.store`; policies from its configuration or an operator-approved change; MCP `approvals_*`, `approvals_decide` and `approvals_policy_propose` at operator scope). Contract 1.1: optional `proposePolicy` and `policyChanges` ([a policy change](../design/approvals.md#a-policy-change), [ADR-0041](../decisions/adr/0041-policy-changes-through-the-approval-queue.md)). The provider may propose a change itself, never apply it (a commands line from repeated identical approvals, off unless configured; [ADR-0050](../decisions/adr/0050-the-queue-proposes-a-policy-change-from-repeated-approvals.md)). The action class `dispatch` (System starting a ready task's attempt by itself) is not in `ALWAYS_ASK` ([a start System proposes](../design/approvals.md#a-start-system-proposes), [ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md)) | board; web-ui (queue and policy page, optional); agent-workers (each run's tool gate, optional: none, and no tool call runs); workflow (optional: a remediation fix's gate, an approved deferred call, a result's required checks; none, and remediation waits for the operator's plan gate); surfaces |
| Orchestration | `dispatchAdvisor` (the dispatch advisor) | plugin: decision | built | `DispatchAdvisor` in `system-decision-core`, with the call every provider answers (`Advisor`), its vocabulary, and its conformance suite ([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md); [the dispatch advisor in shadow](../design/workflow-engine.md#the-dispatch-advisor-in-shadow)); the package is where PROP-0002's `decisions` is planned too. Contract 1.0: asked once per dispatch choice, after it is made, with frozen features (`dispatch-features@1`) and an `AdvisorSignal` (not an `AbortSignal`: its listeners run inside a guard); it answers `dispatch-advice@1` (three probabilities per candidate alias under a pinned model version) or `unavailable` with why. Fails open: an error, a timeout, a malformed answer, or the hourly bound is recorded as `unavailable`; its answer never changes a choice. Providers: none by default (`dispatch.advisor.provider` `none`); the engine's `local` (a logistic regression fitted on this host's recorded outcomes) and `model` (a configured model Worker), each only when configured; a plugin providing `ctx.dispatchAdvisor` is asked instead of the configured one, and one set through `ctx.workflow.setDispatchAdvisor` instead of both | the dispatch pass (optional); the report (its calibration) |
| Orchestration | `landing` | core: gate | built | `Landing` in `system-landing-core` ([PROP-0017](../proposals/0017-github-front-door.md#one-landing-seam-two-providers), [ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md); [landing an accepted result](../design/workflow-engine.md#landing-an-accepted-result)), with the calls every provider answers (`LandingProvider`) and its conformance suite. Contract 1.0 covers an accepted result after its commit (ADR-0068's rebase and checks run again in the engine for every provider): `prepare` gives the subject a `merge` approval binds, changing nothing; `land`, only on an approval of that exact subject, puts it on its target and reports the new head, or finds it landed before (`already`); a moved target or head, another subject (`unbound`), a dirty checkout, or a conflict is a typed refusal that changes nothing; `status` never says landed before it is, or says it cannot tell (`unknown`). Provider `system-landing-local` (row on): a local merge through `workers.land` in the operator's checkout ([ADR-0060](../decisions/adr/0060-an-accepted-result-lands-on-the-operators-merge-approval.md)), never a push. The engine lands only the subject the approved request names, while the provider in force prepares that same subject (else it asks again); with no provider, a landing waits. A code host's provider is PROP-0017 G2's, with its own ADR | workflow (optional: each landing's merge request and merge) |
| Routing | `decisions` | plugin: decision | planned | typed decisions with probabilities for intake and routing (PROP-0002) | workers, workflow |
| Orchestration | `board` | core: work state machine | built | `Board` in `system-board-core` ([board](../design/board.md)): projects (charter, milestones, funding rounds) and board tasks across runs, with leases and expiring waits. Contract 1.3: a spent budget's optional `unreleased`, the reservations its holder could not release, named in its funding request ([ADR-0054](../decisions/adr/0054-a-funding-request-names-the-holds-the-ledger-did-not-release.md)). Provider `system-board` (store-backed, `board_*` MCP tools, projected to `TASKS.md`), its bundle row on, over the approval queue | workflow, surfaces, the lead through `board_*` tools |
| Orchestration | `digests` | plugin: digest | built | `Digests` in `system-digest-core` ([digests](../design/digests.md)): cited `digest@1.0` summaries of raw artifacts, every claim quote-checked against the artifact it cites, failing open, and the MCP tools `digests_*` every provider serves. Contract 1.2: a request's optional `check`, run before it is recorded, through which `digests_request` checks its output. Provider `system-digest` (on `ctx.store`, a read-only Worker on the economy tier through `ctx.workers`), its bundle row on; alternative `system-digest-extractive` ([extractive-first](../design/digests.md#extractive-first): verbatim spans selected by code before the Worker writes), its row off, swapped in by configuration | the workflow engine (each board task's result, set through the board's `attachDigest`); the lead, on request (`digests_request`); the report (the claims of attached digests); it cooperates with the core by artifacts only |
| Orchestration | `experiments` | core: work state machine | planned | the experiment registry ([experiments](../design/experiments.md)): hypotheses and pre-registered experiments with exact identity and structured fingerprint, the four registry answers each a `registration` decision, manual links, the evaluation engine's moves fenced by the evaluation holding an experiment, and lessons whose applicability is computed when read; the fake `FakeExperiments` | the evaluation engine (`ctx.evaluations`); the `improve` template and MCP `experiments_*` (planned) |
| Orchestration | `evaluations` | core: gate | planned | the evaluation engine ([evaluations](../design/evaluations.md)): a pre-registered experiment run offline under its pins and seals as paired trials drawn from its seed, measured by collectors registered through `evaluations.collector` (the verification family) and by the resource ledger, analysed once at the horizon by the pinned statistics, and classified by the deterministic verdict rule as a `verdict` decision; it decides no promotion; the fake `FakeEvaluations` | the `improve` template (planned); collectors register into it |
| Capabilities | `context` | plugin: context | planned | context plugins attached to an agent Worker at launch (tool search, output filters, symbol retrieval), each with a manifest | agent-workers |
| Kernel | `knowledge` | plugin: knowledge | planned | indexing and retrieval over artifacts (full text, local embeddings, re-check dates) | intake, research templates |
| — | `website` (Website Core) | — | not planned | replaced by `ctx.turns` and the engine's request keys and result reuse | — |
| — | `exec` (local tools) | — | not planned | agent runtimes run commands inside their own sandbox | — |
| — | `teams` | — | not planned | the `team` option of workflow nodes, unrolled by the engine; members are Worker sessions ([teams](../design/teams.md)) | — |
| — | `profiles` | — | not planned | profile plugins contribute templates through `ctx.workflow.template` | — |
| — | `clientProtocols` (turn broker) | — | not planned | gateways are plain plugins that share the `gateway-turns` library ([ADR-0022](../decisions/adr/0022-text-protocol-tool-calls-for-website-models.md)) | — |

Gateways (`gateway-anthropic`, `gateway-responses`, `web-ui`, `report`, `notify`, the CLI) only consume
services, so they are plain plugins with no seam. The two client-protocol gateways share the library
`gateway-turns` (text tool protocol, threads bound to provider conversations;
[gateways](../design/gateways.md)). Every client endpoint, MCP included, shares the request guard in
the library part of `system-gateway-core`.

## Core and plugin classes

[ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md) classifies every seam. A
**guarantee seam**: a worse provider could make `system` incorrect (wrong results, lost data, work
done twice), unsafe (an unapproved irreversible action, leaked data), or change every other
component. A **capability seam**: a worse provider only makes `system` less efficient. The core
decides *that* something happens; plugins decide *how*. The `Class` column of the
[seam catalog](#seam-catalog) gives each seam's class.

| Core component | Guarantees | Seams |
|---|---|---|
| ledger of record | append-only artifacts and events, provenance, every decision an artifact ([INV-13](invariants.md#inv-13-every-decision-is-an-artifact)) | `store`, `artifacts`, `eventLog`, `credentials` |
| work state machine | only valid, complete transitions; one writer per subject ([INV-15](invariants.md#inv-15-one-writer-per-subject)) | `workflow`, `workerSessions`, `leases`, `board`, `experiments` |
| runner | restart is reconciliation, not replay ([INV-4](invariants.md#inv-4-restart-is-reconciliation-not-replay)); everything is bounded ([INV-9](invariants.md#inv-9-everything-is-bounded)) | `workflow` (the engine), `turnReceipts` |
| gate | fail closed ([INV-2](invariants.md#inv-2-fail-closed)); explicit egress ([INV-12](invariants.md#inv-12-data-egress-is-explicit)); irreversible actions go to a person; acceptance needs verification | `egress`, `workers` (admission, acceptance), `approvals`, `evaluations`, `landing` |
| resource ledger and metering | numbers from objective sources (usage fields, invoices, limit notices), never model self-reports | `resources` |
| plugin host | a plugin sees only what its seam allows; a failing plugin cannot damage the core; every plugin declares a manifest, and each lifecycle change is a decision | the host: DSH core and Cordis, the `system` bundle, the [plugin rules](#plugin-rules), conformance suites; `pluginHost`: the manifests and the lifecycle record ([plugin host](../design/plugin-host.md)) |

| Plugin family | Contract | Seams and providers |
|---|---|---|
| Worker | takes a brief and artifact pointers; returns result artifacts with usage | Worker sources `turns`, `agentWorkers`, `models`, and `workers-fake` (scripted Workers for the `system-test` profile's canary; off in the bundle); their runtimes `agentRuntimes`, `providers`, `browser`, `display`, `accounts`, `login`; the plugins that register into them: `runtime-claude-agent-sdk`, `runtime-codex-sdk`, `runtime-acp`, `runtime-antigravity-cli`, `provider-chatgpt-web`, `provider-gemini-web` |
| decision | takes state and typed questions; returns typed answers with probabilities | the routing policy inside `workers`; model healing in `ui-ops`; `dispatchAdvisor` (defined in `decision-core`; its providers `local` and `model` in the workflow engine); the planned decisions seam of the seam catalog (PROP-0002), not the decisions surface row |
| verification | takes an artifact and criteria; returns pass or fail with evidence | acceptance contracts registered through `workers.contract`; metric collectors and validators registered through `evaluations.collector`; quote checks and tallies in team review |
| digest | takes raw artifacts; returns a cited summary | `digests`: `system-digest` (on by default), `system-digest-extractive` (off, its alternative) |
| context | attached to a Worker at launch; reduces tokens entering context without changing results | `context` (planned) |
| workflow | template: job graph, team kind, milestones, default criteria | profiles through `workflow.template`: `profile-software-development`, `profile-scientific-research` |
| knowledge | indexing and retrieval over the ledger of record | `knowledge` (planned) |
| surface | reads from the core and presents it to the operator and the lead | `mcp`, `webServer`, `gateway-anthropic`, `gateway-responses`, `web-ui`, `report`, `notify` (out-of-band notices from the event log, its row off; [notifications](../design/notifications.md)), `lead-inbox` (a project's lead inbox from the event log, pushed to its sinks; [the lead's inbox](../design/notifications.md#the-leads-inbox)), `decisions` (the operator's decisions as `operator-decision@1.0` records, its row off, no seam: its MCP tools are `mcp-decisions@1.0`; [runbook](../operations/runbooks.md#record-a-decision)), the CLI |

Rules for the two classes:

1. **Dependencies.** A capability plugin depends on seam definitions, never on another plugin's
   implementation. Across families it cooperates only through the core, by artifacts or events.
   Within one family, providers may build on each other's seams.
2. **Failure.** Capability plugins fail open: a failing context or digest plugin is bypassed and the
   event recorded; a failing decision plugin yields the deterministic default for the work kind; a
   failing Worker is reconciled by the runner. Guarantee seams fail closed. A failing verification
   plugin means no automatic acceptance.
3. **Change.** A guarantee seam's contract changes only through an ADR, as an invariant does; a
   capability seam's through a versioned definition and its conformance suite.
4. **Alternatives.** A capability seam may have several provider packages, each its own bundle row
   passing the seam's conformance suite at one contract: exactly one row is on by default, the others
   off, for the operator to swap in by configuration ([composition](#composition)). One provider runs
   at a time (INV-1): Cordis refuses a second registration of a service, so with two such rows on, the
   second does not start and health `plugins` is down, naming it. A guarantee seam has one provider;
   replacing it takes an ADR. `pnpm check:packages` and `pnpm check:manifests` hold both rules.

### Package classes

`pnpm check:deps` (run by `pnpm check`) holds the dependency rules: plugins are testable alone and
removable with System still working, so they depend only on the core and on each other as little as
possible. This table is its one source; the check fails when a package is missing from it or named
without existing. Each package is one class:

- **kernel**: the libraries, the host (`cli`, `system-bundle`), and the `*-core` seam definitions;
  anyone may import them.
- **guarantee**: a provider of a guarantee seam, the [required rows](#required-and-optional-rows).
- **capability**, **surface**, **profile**: the optional rows.

The **family** is the seam a group of plugins registers into, where one may build on another's seam
(rule 1); `—` means none.

| Class | Family | Packages |
|---|---|---|
| kernel | — | `libs`, `system-bundle`, `cli`, `ui-ops`, `gateway-turns`, `ledger-core`, `plugin-host-core`, `provider-core`, `workers-core`, `approvals-core`, `resources-core`, `board-core`, `digest-core`, `decision-core`, `landing-core`, `models-core`, `gateway-core`, `agent-runtime-core` |
| guarantee | — | `credentials-vault`, `store`, `event-log`, `leases`, `artifacts`, `plugin-host`, `resources`, `approvals`, `turn-receipts`, `egress`, `workers`, `worker-sessions`, `landing-local`, `workflow`, `board` |
| capability | agent-runtimes | `agent-runtimes`, `runtime-claude-agent-sdk`, `runtime-codex-sdk`, `runtime-acp`, `runtime-antigravity-cli` |
| capability | web-providers | `providers`, `provider-chatgpt-web`, `provider-gemini-web` |
| capability | digests | `digest`, `digest-extractive` |
| capability | — | `display-virtual`, `browser-patchright`, `accounts`, `login`, `turns`, `workers-fake`, `agent-workers`, `models` |
| surface | — | `lead-inbox`, `decisions`, `report`, `notify`, `gateway-anthropic`, `gateway-responses`, `web-ui`, `mcp-server` |
| profile | — | `profile-software-development`, `profile-scientific-research` |

The check reads each package's `src/` imports (tests excluded), type and value apart (`import type`, a
list of only `type` specifiers, `export type … from`, and `import('x').T` are type), and refuses:

1. `guarantee-provider`: any import of a guarantee provider's package by another package. A seam's
   definition lives in a `*-core` package and the consumer imports that. Some definitions still live in
   their provider (`leases`, `egress`, `turn-receipts`, `worker-sessions`, `workflow`); importing one
   is a baselined violation until the definition moves to a `*-core`.
2. `plugin-to-plugin`: a plugin importing another plugin's package, type or value, unless both are in
   one family of the table. Plugins cooperate through the core: a seam, an artifact, or an event.

`scripts/dependency-baseline.json` lists today's violations, one `from -> to [rule]` per package pair.
It may only shrink: a violation it lacks fails the check, naming the import and the rule, and a line no
longer a violation is stale and fails too (`pnpm check:deps --shrink` drops it). To fix one, move the
definition to a `*-core` package or reach the seam through `ctx`; to allow one, change this table in a
change the review reads. `pnpm gen:deps` writes the layers, edges, and counts to
[dependency-graph](dependency-graph.md), and the check holds it up to date.

## Required and optional rows

The `system` bundle's rows, split by the `Class` column of the [seam catalog](#seam-catalog). A
**required** row provides a guarantee seam or is the host the rows mount on; with one off, System is
not the product it promises, and the plugin host and each consumer say so. An **optional** row
provides a capability or a surface (or a driver, runtime, or profile that registers into one): disable
its row and System still works, what the row did is absent, and a request that needs its seam fails
with the reason that the seam is not mounted, never a crash, a hang, or a down health check. The
[removability matrix](../engineering/testing.md#removability-matrix) holds this one row at a time and
reads the two lists below (one row id per backtick; a new bundle row is in exactly one, or it fails).

- **Required** rows (the host, and the guarantee seams): `timer`, `webserver` (the DSH host every
  surface mounts on), `credentials`, `store`, `event-log`, `leases`, `artifacts`, `plugin-host`,
  `resources`, `approvals`, `turn-receipts`, `egress`, `workers`, `worker-sessions`, `landing-local`,
  `workflow`, `board`.
- **Optional** rows (capability and surface): `lead-inbox`, `decisions`, `display`, `browser`, `providers`,
  `provider-chatgpt-web`, `provider-gemini-web`, `accounts`, `login`, `turns`, `workers-fake`, `agent-runtimes`,
  `runtime-claude-agent-sdk`, `runtime-codex-sdk`, `runtime-acp`, `runtime-antigravity-cli`,
  `agent-workers`, `llm`, `llm-pi-ai`, `models`, `digest`, `digest-extractive`, `report`, `notify`,
  `profile-software-development`, `profile-scientific-research`, `gateway-anthropic`,
  `gateway-responses`, `web-ui`, `mcp-server`.

`mcp-server` is optional as a surface: with it off there is no MCP endpoint, so the matrix reads
health from the host and runs work through the engine directly. A required row that tolerates its own
absence (the board, the landing) makes no promise by it.

The plugin host tells the two apart by the same rule at run time: a row whose plugin's manifest
declares a core class is required, one of a plugin family optional, and one with no manifest required
unless the `plugin-host` row names its package in `optionalWithoutManifest` (the bundle names `llm`
and `llm-pi-ai`). The removability spec holds the host's answer to these two lists.

## Turning a plugin off

Two switches turn a plugin off, neither needing a restart or a code change ([ADR-0078](../decisions/adr/0078-a-plugin-or-a-mechanism-is-turned-off-at-runtime.md)):

- **A row.** `system plugin off <row> [reason]` and `system plugin on <row>` (MCP `plugin`,
  operator). The plugin host records the turn as a `lifecycle` decision with the reason first, then
  turns the row in the running daemon's DSH loader. Off: the plugin is disposed, and the turn waits,
  within `quiesceSeconds`, until its disposers ran, each finishing or handing back its in-flight work
  as its seam says (plugin rule 3). On: until it applied. Then the row's `disabled` is written into
  the profile's patch, so a restart keeps it. Refused before anything is recorded: a required row, an
  unknown one, a patch the host cannot edit by lines, and a row whose plugin serves the switches
  themselves (it provides `ctx.mcp`: `mcp-server`), since nothing could turn it on again; its patch
  turns it off, with a restart. A plugin that does not stop within the bound is put back, and a
  decision chained to the turn's records that it did not complete.
  `system plugin list` shows each row's state, class, and last turn with why.
  **What health says of a dependent**: a plugin that waits, as Cordis makes it wait, only for services
  whose row is off (in the composition, or turned off) is not down: health stays `ok` and its
  `plugins` check names it `off` with the reason (`Login waits for service accounts, whose row is
  off`). So is a plugin that waits for an on row that itself waits for an off row (display, browser,
  Login). A plugin that waits for a service no row provides, or for an on row that has not provided
  it, is still down (INV-2). A package with no manifest declares no seam, so its row id is taken as
  the service it supplies.
- **A mechanism.** A gate-like mechanism has an enforce switch: `on` (it refuses), `warn` (it records
  what it would refuse and lets it through), or `off` (it does not run), as far as it takes that mode.
  Its owning row's `enforce.<key>` gives its start value; `system enforce set <mechanism> <mode>`
  (MCP `enforce`) sets a live override the plugin host keeps, recorded as a `gate` decision, read by
  the mechanism at each use. `MECHANISMS` in the libs lists them and their modes:
  `evidence-gate` (off, warn, on); `handbook-bound` (warn, on; `handbook.enabled: false` gives no slice
  at all); `review-guides` (off, on); `red-on-base` (off, warn, on; the check that a result's new
  tests fail on its base, ADR-0079; starts in warn); `lockfile-verification` (off, warn, on; online
  verification of a new lockfile, [a lockfile's verification](../design/agent-runtimes.md#a-lockfiles-verification);
  starts in warn); `disk-floor` (off, warn, on; no new worktree under a free-space floor of the
  worktrees' filesystem; starts in warn); `sandboxed-commands` (off, warn, on; the autonomy policy's
  rule that lets a sandboxed Bash call it does not name run without the operator, ADR-0080; starts in
  warn); `lead-rights` (on only: every refusal is a bound of authority, INV-6; revoke the lead's token
  instead).

**The rule for a new mechanism** (checked by the review; no automated check):

1. It lands as an optional row (its bundle row off, or on with nothing depending on it), or behind
   an enforce switch whose default is `off` or `warn`.
2. It moves to `on` only after **7 days** clean: no refusal it recorded in warn that the operator
   judged wrong. The number is the operator's, kept here until the autonomy policy has a field for it.
3. Turning it off never breaks System: the removability matrix turns every optional row off and on at
   run time and smokes after each turn, and a mechanism off or in warn refuses nothing.

## What is not a plugin

A plugin exists only when something can really be swapped or scoped. These stay **libraries**:
canonical JSON and hashing, the pure reconciliation decision function and the liveness verdict
(`livenessOf`, pinned by version), the failure-class taxonomy, the timeout primitives,
the per-account scheduler, the UI engine, the evaluation engine's statistics (pinned by version in
each experiment), and the record schemas. Each has exactly one correct answer per process; as services
they would make the kernel "know too much".

A plugin that registers only event listeners, such as a policy hook, is a plugin, not a seam.

## DSH core reuse map

This table is the canonical **allow-list of DSH rows** that `system` mounts; the bundle inserts
exactly the **mounted** rows. It does not use `dsh-base`, which mounts 94 rows
([ADR-0019](../decisions/adr/0019-explicit-minimal-dsh-core.md)). DSH services reach `system` domain
plugins only through `system` seams or `system-dsh-*` adapter plugins (lock-in safeguard 1 of
[ADR-0018](../decisions/adr/0018-build-on-dsh-core.md)). Adding a row updates this table and the
composition test that asserts the exact row set.

| Status | DSH row (package) | Serves | Notes |
|---|---|---|---|
| **mounted** | `timer` (`@deepseek-ai/cordis-plugin-timer`) | the Cordis `timer` service | no `system` plugin injects it ([packages](packages.md)) |
| **mounted** | `credentials` (`dsh-credentials` seam) | secrets for `ctx.accounts` | provided by `system-credentials-vault`; `dsh-credentials-local` (plain YAML) is not used in any composition |
| **mounted** | `webserver` (`dsh-host-webserver`) | `/mcp`, `/anthropic`, `/openai`, `/ui` | loopback `127.0.0.1:47317` |
| not mounted | `approval`, `user-questions` | — | plan approval is the engine's own `approval@1.0` artifact bound to the exact plan |
| not mounted | `attachments` (`dsh-attachment-local`) | — | depends on native `sharp`, requires a display name, not an allow-listed row |
| **mounted** | `llm` (`dsh-llm`), `llm-pi-ai` (`dsh-llm-pi-ai`) | `ctx.llm` under `ctx.models` ([models](../design/models.md)) | need only `ctx.credentials`; no route until the operator configures one; a route's key is a credential reference resolved through the vault |
| not mounted | `llm-retry` | — | injects the agent loop and session log (`agents`, `sessionProjections`), never inserted, retries agent-loop steps only; `models` bounds its own re-attempts by the route's retry policy |
| planned (optional) | `dsh-acp` | ACP editor client gateway | — |
| optional | `hmr` | development reloads | — |
| not mounted | `subprocess`, `sandbox`, `sandbox-policy`, `shell`/`fs` providers | — | no `exec` seam; agent runtimes run commands in their own sandbox. `agent-runtime-core` imports only the `dsh-subprocess` library function `scrubbedParentEnv` for agent child environments |
| not mounted | `dsh-web-app` rows, `dsh-client-ui-*` | — | needs `dsh-base`; the operator UI is the small `/ui` page of `system-web-ui` |
| not mounted | `dsh-subagent-claude-code`, `-codex`, `-acp` | — | one-shot, no resume or probe, sandbox not held exactly; `ctx.agentRuntimes` uses the official SDKs ([dependency register](../engineering/dependencies.md)) |
| **never inserted** | telemetry (`otel`, `session-telemetry-otel`), DeepSeek account and default-model rows, agent loop, session log, tools, compaction, goals, skills, web search, plugin manager, config editor | — | inserted only when a requirement asks for them |
| **avoided** (experimental) | agent teams, hook bridges, browser-use and computer-use providers, webhooks | — | — |
| **not provided by DSH** | — | everything else in the [seam catalog](#seam-catalog) | `system` builds it ([dependency register](../engineering/dependencies.md)) |

One exact DSH version is pinned for every row.

## Composition

`system start` runs `dsh --profile system`. Configuration alone decides what runs:

```mermaid
flowchart LR
  e["empty entry list"] --> b["@tsuuanmi/system-bundle<br/>allow-listed DSH rows + system plugins<br/>(no dsh-base)"]
  b --> r["a preset's bundle layer, if any<br/>(system init --preset)"]
  r --> o["bundles the operator added<br/>(kept by system init)"]
  o --> p["the profile's cordis.patch.yml<br/>(operator overrides)"]
  p --> c["--patch overlays<br/>from the command line"]
```

A patch can insert rows, or target a row by `id` to replace its `config`, set `disabled`, or change
`inject` or `isolate`. A targeted patch replaces the row's whole config; it does not deep-merge.
Removing a capability means disabling its row.

Examples:

- To drop a website, disable its driver row (`provider-gemini-web`).
- To run with no Worker that drives a website, `system init --preset api-first` adds the preset's
  bundle layer right after the system bundle, disabling those rows and both model gateways
  ([ADR-0025](../decisions/adr/0025-api-first-composition.md)). The operator's patch is untouched.
- To swap the browser engine, disable `browser` and insert another provider of `ctx.browser`.
- To replace the digest provider, turn `digest` off and `digest-extractive` on in one patch
  ([swap the digest provider](../operations/runbooks.md#swap-the-digest-provider)). Nothing else
  changes: consumers reach `ctx.digests` through the definition, and the MCP tools are the seam's.
- To give part of the tree its own provider of a seam, mount it in an `isolate` scope. The
  parent scope is unaffected.

## Plugin rules

1. **Plugins, not core changes.** New behavior goes on a documented seam or event. A change to a
   seam definition updates this document and the seam's conformance suite.
2. **A seam is complete.** It has all three roles: definition, provider, and consumer. A definition
   is an abstract `Service` class, not a bare `interface`, so it can own its `ctx` key.
3. **Every registration has a disposer**, and disposal reaches quiescence. Nothing outlives its
   plugin.
4. **No hardcoded tunables.** Anything that varies by deployment is a validated `Config` field.
   Protocol constants, external specifications, and security invariants stay fixed in code.
5. **Events for interception and policy, service methods for direct calls.** An event's
   dispatch mode (`emit`, `waterfall`, `parallel`, `serial`, `bail`) is part of its public
   contract.
6. **Durable state lives in the store, not in service memory.** A plugin reload never loses
   committed state.
7. **Every seam ships a conformance suite.** Every provider, including fakes, passes the same
   suite ([testing](../engineering/testing.md)).

## Portability and exit path

`system` *is* a DSH bundle, so a DSH user can mount its plugins in their own profile. Moving off
DSH means replacing the `system-dsh-*` adapters and the composition root; domain plugins stay
unchanged, since every seam is defined by `system` and the runtime is Cordis. Claude Code and Codex
reach `system` through protocols (MCP and the Responses and Messages gateways), so the host choice does
not affect them ([INV-11](invariants.md#inv-11-no-tool-lock-in)).

## Seam definitions and conformance

Every new seam ships, with its first provider, an abstract definition, schemas for its records and
payloads, a written protocol, and a conformance suite
([ADR-0037](../decisions/adr/0037-schema-and-protocol-first.md)). Older single-provider seams may
still be concrete services; their guarantee seams have suites in the providing plugin, run against that
provider, with the contract's known gaps baselined. Suites written since ADR-0037 run through the
[conformance runner](../../packages/libs/conformance/runner.ts), modelled on
`@modelcontextprotocol/conformance`: scenarios with stable ids, each applying from one contract
version on; a provider pins the contract version it implements; known failures are a baseline that
fails the run once the scenario passes. Consumers depend on definitions only.

| Seam | Definition (abstract `Service`) | Conformance suite | Providers that run it |
|---|---|---|---|
| `display` | `Display` in `@tsuuanmi/system-provider-core` | `provider-core/conformance/display.ts` | `display-virtual` (real Xvfb), the fakes `KillableDisplay` and `fileDisplay` (one Xvfb per test file) |
| `browser` | `Browser<Page, Context>` in `@tsuuanmi/system-provider-core` (engine-neutral) | `provider-core/conformance/browser.ts` | `browser-patchright` |
| `providers` | `ProviderRegistry` in `@tsuuanmi/system-provider-core` | `provider-core/conformance/providers.ts` | `providers` |
| `mcp` | `McpTools` in `@tsuuanmi/system-gateway-core` | `gateway-core/conformance/mcp-tools.ts` (also checks that a tool declaring no scope is listed to the operator only) | `mcp-server` (through a real MCP client, per scope) |
| `workers` | `Workers` in `@tsuuanmi/system-workers-core` | `workers-core/conformance/workers.ts` | `workers` |
| `agentRuntimes` | `AgentRuntimes` in `@tsuuanmi/system-agent-runtime-core`, plus a provider suite, an identity suite, and a usage report suite | `agent-runtime-core/conformance/agent-runtimes.ts` | `agent-runtimes` (registry); `runtime-claude-agent-sdk`, `runtime-codex-sdk`, `runtime-acp`, `runtime-antigravity-cli` (against scripted streams, agents, and CLIs; the usage report suite by Claude Code, Codex, and the Antigravity CLI, against a scripted SDK, an app-server stand-in, and a scripted agy); the fake `FakeAgentRuntime`, which also passes the identity and usage report suites |
| `models` | `Models` in `@tsuuanmi/system-models-core` | `models-core/conformance/models.ts` | the fake `FakeModels`; `models` (`LlmModels` over `llm` and `llm-pi-ai`, against a fake OpenAI-compatible server) |
| workflow templates | `ctx.workflow.template(name, nodes)` | `workflow/conformance/profiles.ts` | `profile-software-development`, `profile-scientific-research` |
| `approvals` | `Approvals` in `@tsuuanmi/system-approvals-core` | `approvals-core/conformance/approvals.ts` (contract 1.1) | `approvals` (store-backed), the fake `FakeApprovals` |
| `resources` | `Resources` in `@tsuuanmi/system-resources-core` | `resources-core/conformance/resources.ts` (contract 1.3) | `resources` (store-backed), the fake `FakeResources` |
| `board` | `Board` in `@tsuuanmi/system-board-core` | `board-core/conformance/board.ts` (contract 1.5, over any `ctx.approvals`) | `board` (over a real store, with `FakeApprovals` and with `approvals`), the fake `FakeBoard` |
| `digests` | `Digests` in `@tsuuanmi/system-digest-core` | `digest-core/conformance/digests.ts` (contract 1.2) | `digest` and `digest-extractive` (each over real routing, with a scripted Worker), the fake `FakeDigests` |
| `pluginHost` | `PluginHost` in `@tsuuanmi/system-plugin-host-core` | `plugin-host-core/conformance/plugin-host.ts` (contract 1.2) | `plugin-host` (over a stub of the DSH loader and installed package directories), the fake `FakePluginHost` (at 1.1: no loader, so no runtime switch) |
| `store` | `Store` in `@tsuuanmi/system-ledger-core` | `ledger-core/conformance/store.ts` (contract 1.0) | `store` |
| `eventLog` | `EventLog` in `@tsuuanmi/system-ledger-core` | `ledger-core/conformance/event-log.ts` (contract 1.1) | `event-log` |
| `artifacts` | `Artifacts` in `@tsuuanmi/system-ledger-core` | `ledger-core/conformance/artifacts.ts` (contract 1.2) | `artifacts` |
| `turnReceipts` | concrete `TurnReceipts` in `@tsuuanmi/system-turn-receipts` | `plugins/turn-receipts/conformance/turn-receipts.ts` (contract 1.0) | `turn-receipts` |
| `leases` | `Leases` in `@tsuuanmi/system-board-core` | `board-core/conformance/leases.ts` (contract 1.1) | `leases` |
| `egress` | `Egress` in `@tsuuanmi/system-workers-core` | `workers-core/conformance/egress.ts` (contract 1.0) | `egress` |
| `workerSessions` | concrete `WorkerSessions` in `@tsuuanmi/system-worker-sessions` | `plugins/worker-sessions/conformance/worker-sessions.ts` (contract 1.1) | `worker-sessions` |
| `workflow` | concrete `Workflow` in `@tsuuanmi/system-workflow` | `plugins/workflow/conformance/workflow.ts` (contract 1.12, over the store-backed `board`, `approvals`, and `resources`), beside the template suite `profiles.ts` | `workflow` |
| `landing` | `Landing` (and the calls `LandingProvider`) in `@tsuuanmi/system-landing-core` | `landing-core/conformance/landing.ts` (contract 1.0, over a `World`: the repository a provider lands in; `MemoryRepository` is one in memory, with the local merge's semantics) | the fake `FakeLanding`; `landing-local`, as the provider of `ctx.landing` and as a plain call (`localLanding`), over a Worker source that merges in a `MemoryRepository` |
| `dispatchAdvisor` | `DispatchAdvisor` (and the call `Advisor`) in `@tsuuanmi/system-decision-core` | `decision-core/conformance/dispatch-advisor.ts` (contract 1.0, over a dispatch harness the test supplies; the engine's is `plugins/workflow/conformance/advisor.ts`) | `local` (fitted, and with too few labelled attempts), `model` (over a scripted model Worker), and a fake whose advice opposes every choice, each set through `setDispatchAdvisor` and as the provider of `ctx.dispatchAdvisor`, in `workflow/tests/dispatch.spec.ts` |
