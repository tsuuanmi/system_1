# Plugin architecture source audit (2026-11-03)

**Non-normative, targeted static review; not a security certification, runtime
test, or architectural decision.** Companion to
[capability reuse audit](capability-reuse-audit-2026-11-03.md) and
[draft PROP-0023](../proposals/0023-capability-reuse-and-deletion.md).
The existing [Lean Core priority](../proposals/0022-lean-core.md),
[ADR-0010 reuse ladder](../decisions/adr/0010-reuse-before-build.md),
[ADR-0036 guarantee split](../decisions/adr/0036-guarantee-core-and-capability-plugins.md)
and [invariants](../architecture/invariants.md) are unchanged.

## Baselines and method

- System: `tsuuanmi/system` **dev** commit
  [737ca1ad161a74b65e844927576caf01d07addc9](https://github.com/tsuuanmi/system/commit/737ca1ad161a74b65e844927576caf01d07addc9),
  unchanged when inspected on **2026-11-03**.
- External docs/source checked: DSH `master` at
  `ce7073d51254c26cd63b22a60835b8f948deb447`; Hermes `main`
  at `4131fd95700685444c3522bf1ea07578c4003523`. These are
  evidence revisions, **not versions selected for installation**.
- Method: inspected the recursive Git tree, shipped bundle, generated
  package/seam map, plugin READMEs, targeted TypeScript implementations
  and upstream Hermes/DSH plugin APIs. No local checkout or execution;
  **no tests, benchmarks, sandbox checks, pnpm install or pnpm check**.
- Source-line counts below are measured from GitHub's returned UTF-8
  content. Counts include comments; they are not executable LOC,
  complexity scores, defect counts or deletion forecasts.

## Composition: 43 plugin packages is not 43 active services

[Shipped bundle](../../packages/system-bundle/cordis.patch.yml) has
**47 named rows**: 43 `@tsuuanmi/system-*` plugin rows and four
first-party DSH rows (timer, webserver, llm, llm-pi-ai). Of System
rows, **10 ship with `disabled: true`**: `workers-fake`,
`runtime-codex-sdk`, `runtime-acp`, `runtime-antigravity-cli`,
`digest-extractive`, `notify`, `decisions`,
`profile-software-development`, `gateway-anthropic` and
`gateway-responses`. The other **33 are not disabled by the shipped
bundle**. This is *configuration*, not proof that 33 are actually
ACTIVE on a particular machine: injection, credentials, operator
patches and startup failures can alter effective availability.

System intentionally mounts **no `dsh-base`**. Do not assume a
community DSH plugin's referenced `ctx.session`, `ctx.tools`,
`ctx.skill`, web client runtime or agent loop exists.

### Architectural role separation

| Owner in System | What may be reused | What must remain authoritative |
|---|---|---|
| `store`, `artifacts`, `event-log`, `leases` | SQLite, fs, serialization and hash libraries | Atomic state/decision commits, provenance, fencing |
| `board`, `approvals`, `resources` | Presentation, policy helpers, metering parsers | Project and task state, exact-subject authorization and reservations |
| `workflow` | DAG algorithms, retry utilities, step templates | Run admission, durable execution, recovery, acceptance and dispatch |
| `agent-workers`, runtime adapters | Claude/Codex/ACP SDK features, Git utilities | Confinement, worktree ownership, liveness, side-effect recording |
| `web-ui`, `notify`, `lead-inbox` | UI widgets, outbound transports | Operator authorization and recorded notifications |
| Planned `context`, `knowledge` | External provider API, narrow library | Project scope, egress, source artifacts and retrieval provenance |

The goal is to reduce **owned mechanisms**, not the nominal
number of Cordis packages. A small plugin with a stable contract can
be cheaper to retain than a large dependency plus an adapter.

## Source concentration vs code quality guidance

[Code-quality guidelines](../engineering/code-quality.md) flag
files beyond about 800 lines as a *design smell*, not an automatic
rejection. Targeted source counts on the baseline:

| Source | Lines | Focus for local source audit |
|---|---:|---|
| [agent-workers/src/index.ts](../../packages/plugins/agent-workers/src/index.ts) | 3,554 | Worker enrollment, admission, liveness, metering and run ownership boundaries |
| [board/src/index.ts](../../packages/plugins/board/src/index.ts) | 2,650 | State transitions, approvals, sweeps, acceptance, funding |
| [agent-workers/src/worktrees.ts](../../packages/plugins/agent-workers/src/worktrees.ts) | 2,256 | Git operations vs worktree lifecycle and recovery |
| [workflow/src/tasks.ts](../../packages/plugins/workflow/src/tasks.ts) | 2,011 | Task/runs lifecycle, result acceptance, input waits |
| [agent-workers/src/gate.ts](../../packages/plugins/agent-workers/src/gate.ts) | 1,728 | Command classification, safety policy, approval binding |
| [workflow/src/landings.ts](../../packages/plugins/workflow/src/landings.ts) | 1,273 | Landing queue, exact revision/merge, retry/rebase |
| [workflow/src/engine.ts](../../packages/plugins/workflow/src/engine.ts) | 1,265 | Runner and recovery orchestration |

The two plugin `src/` directories `workflow` (1,345,524 bytes)
and `agent-workers` (872,007 bytes) represent **53.3% of 4,160,892
bytes** across all System plugin `src/` folders. Their internals
deserve first attention but must not be rewritten merely to improve
file counts.

The Kanban-specific [web-ui/client/board.ts](../../packages/plugins/web-ui/client/board.ts)
is **23,487 bytes**, versus **241,729 bytes** of `web-ui/client/`.
A foreign Kanban shell is unlikely to produce large measured LOC
deletion unless the operator actually wants the extra user-facing
features.

## Finding A — optional reverse lookups are real coupling

The generated [package map](../architecture/packages.md) lists
seven required and nine optional seams for `workflow`,
six required and seven optional for `agent-workers`, one required
and 14 optional for `mcp-server`, and three required and ten
optional for `report`. These are **integration hubs**.

Targeted implementation confirms additional *runtime* relationships
in lower-level providers:

- [approvals/src/index.ts](../../packages/plugins/approvals/src/index.ts)
  `projectOfRequest()` reads `ctx.get('board' as never)` to
  resolve the owning project for a task, and `baseBranchOf()` reads
  `ctx.get('workflow' as never)` for the landing target (around
  lines 566–589).
- [resources/src/index.ts](../../packages/plugins/resources/src/index.ts)
  `outsideProject()` reads `board.task` and
  `workflow.projectOfRun` through `ctx.get(... as never)`
  (around lines 330–347) before serving a lead-scoped usage query.
- [worker-sessions/src/index.ts](../../packages/plugins/worker-sessions/src/index.ts)
  `outsideProject()` gets `workflow.projectOfRun` to authorize
  access to messages (around lines 183–208).
- [workflow/src/index.ts](../../packages/plugins/workflow/src/index.ts)
  attaches the optional `board` through `ctx.inject(['board'])`
  with a disposer that detaches it (around lines 278–286).

The service graph contains optional back-references such as
`board -> approvals -> board`,
`workflow <-> approvals`, and
`workflow <-> resources`. These are **not proof of a Cordis load
cycle or a security defect**. Current authorization paths deny
unknown ownership; that is correct fail-closed behavior.

**Architectural risk to test:** dynamic casts and domain lookups
increase cross-layer coupling and can make runtime plugin replacement
or plugin removal change authorization availability. In particular,
contract types do not currently express the project-lookup surface
that these three consumers assume.

**Minimal next step:** inventory the three lookups and shared
project-scoped authorization cases; add contract tests for a
missing/unloading `board` or `workflow`, an unknown run/task, and
cross-project access. Only after tests expose meaningful duplication
consider a **small typed lookup contract** or shared authorization
helper. Do not invent a large identity framework up front.

## Finding B — manifest checking is observation, not prevention

[plugin-host README](../../packages/plugins/plugin-host/README.md)
states that its check records invalid manifests and lowers health but
**does not gate or prevent the DSH loader from running a row**.
[plugin-host/src/index.ts](../../packages/plugins/plugin-host/src/index.ts)
records composition and manifest findings; it does not sandbox an
already executing third-party module. This is an intentional
documented limitation, not a newly discovered exploit.

For adoption, treat an external Cordis plugin as **trusted host code**:
inspect it and pin it *before* mounting. The manifest check is not a
supply-chain approval or process boundary. A plugin needing broader
trust should instead be declined or isolated in a process whose APIs
and data exposure System explicitly controls.

Reference: [official DSH service/lifecycle docs](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)
and [plugin lifecycle](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/).
Cordis can dispose required dependents automatically. Async
disposers have no guaranteed total ordering across registrations:
scope all order-sensitive teardown in one awaited disposer.

## Finding C — orchestration lifecycle needs focused unload tests

[workflow/src/index.ts](../../packages/plugins/workflow/src/index.ts)
(around lines 237–286) starts recovery in a microtask, multiple
timers (dispatch, deferrals, purges and opt-in reviews/checks), and
`engine.close()` as an async disposer. Optional Board attachment
has its own disposer. This is normal durable orchestration code;
**no leak or duplicate side effect was established by inspection**.

Targeted tests should disable/re-enable the optional board while
a run is held, dispose the workflow while timers are pending, and
kill/restart between admission, deferred approval and landing.
Assert one durable owner, no duplicated write/dispatch and
successful recovery or an explicit unknown/liveness state.

For third-party plugins, verify Cordis `ctx.effect` cleanup as
well as ordinary init success. A plugin that merely registers a
timer but never disposes is **not** acceptable on System's host.

## Finding D — external reuse has a stronger boundary than the name "plugin"

### Hermes is not a Cordis plugin source

[Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
use `plugin.yaml` and a Python `register(ctx)` API for
tools, hooks, commands and providers. System uses TypeScript
Cordis `apply(ctx, config)`/`Service`. Hermes Python plugins
cannot be installed directly as `@deepseek-ai/cordis` plugins.
Reuse should target **library APIs, UI assets or isolated services**
with explicit System ownership.

[Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
is a stateful board with its own dispatcher and database. Its current
[FastAPI router](https://github.com/NousResearch/hermes-agent/blob/main/plugins/kanban/dashboard/plugin_api.py)
was **1,848 lines** on the inspected revision and imports
`hermes_cli.kanban_db`, workflow, dispatch, diagnostics,
workspace and notification modules; the
[Hermes Kanban DB module](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/kanban_db.py)
is **185,515 source bytes**, and the shipped dashboard
`dist/index.js` is about **210 KB**. This is not a thin,
host-independent TypeScript UI package. A source-bundle adapter may
still be useful for rich UX, but **net-maintenance benefit is
unproven**; a direct DB/dispatcher integration creates a second
authority.

**Security discrepancy:** the Kanban reference describes API
routes as session-token protected in its REST section, but its
Security model explicitly says HTTP middleware skips
`/api/plugins/` routes; source router functions do not
independently attach an HTTP authentication dependency. Treat the
actual effective protection as **unverified pending a live
request-level test**, and do not expose routes under System without
System's operator token, authorization and revision checks.
Its WebSocket uses a separate auth check.

### First-party DSH skills are useful but not automatically compatible

At the inspected DSH revision,
`@deepseek-ai/dsh-skill` and
`@deepseek-ai/dsh-skill-filesystem` report **0.2.2-alpha.2**
in their source package manifests. The latter needs a skill
registry and DSH filesystem/home-path services; the former
declares additional DSH scope/LLM peers.
System currently pins **Cordis 4.0.5-alpha.1** and DSH host
**0.2.1-alpha.2**, with a minimal composition. Do not assume
the first-party 0.2.2 packages are compatible with that host.

The [skill filesystem reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)
says skill bodies are **re-read on each load**, and can be discovered
from repository-local `.agents/skills` roots, which may be
untrusted. Reproducible System Worker briefs need a **content-hashed
snapshot pinned at admission**, with provenance and an explicit
scope/permission check, not unversioned live skill injection.
Whether native Claude/Codex skill facilities eliminate the need
for a System registry must be investigated first.

### Memory and notifications remain optional hypotheses

[Hermes memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)
automatically prefetches, injects and **syncs conversation turns**
when its provider is selected. System cannot simply inherit that
behavior: only opt-in, project-scoped, classified artifacts should
enter a knowledge backend, and retrieved text stays untrusted.
Compare a narrow direct provider API against doing nothing.

[Community dsh-kanban](https://github.com/FuncWei/dsh-kanban)
reuses Hermes DB/router/UI through a sidecar and supplies its own
dispatcher. This is a reference for the UI adapter, not a safe
drop-in for System Board.

[Community dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier)
targets DSH session/client services different from System's
minimal composition. If there is no concrete need for more
delivery channels, its whole runtime would be a regression.
Reusing a tiny outbound transport is more plausible.

## Ranked local-agent next steps

**P0 — Required source and baseline audit (no migration).**

1. Re-run the line counts, dependency graph and runtime bundle row
   counts on the then-current `dev` commit. Record which packages are
   configured disabled and which *actually mount* on the test host.
2. Trace `workflow` and `agent-workers` call graphs and run state
   ownership across `dispatch`, `tasks`, `landings`, `gate`,
   `worktrees`, `setup` and `checks`. Produce an explicit
   "mechanism -> one owner -> readers -> tests" inventory.
3. Measure LOC and tests separately; list directly removable dead
   paths and duplicates **without refactoring correctness yet**.

**P1 — Boundaries and lifecycle tests.**

4. Test project-scoped auth when `board`, `workflow`, `resources`
   or `approvals` are absent, disposed or not yet ready; verify
   fail-closed results and no cross-project data.
5. Test plugin on/off/reload with running workflow sessions,
   pending approvals, dispatch timers, worktree liveness and an
   in-progress landing. Assert no duplicate side effect.
6. Document explicit third-party preflight security requirements
   outside `plugin-host` manifest health.

**P2 — Only requested capability reuse, in isolation.**

7. Compare native SDK skills vs first-party DSH skills. Record
   exact peer versions; snapshot selected instructions into a
   reproducible, hash-pinned brief.
8. If a use case requires knowledge, compare direct memory backends
   on project-scoped and redacted fixtures, not ambient transcript
   syncing.
9. If demanded by operators, prototype a **read-only** Hermes Kanban
   projection or outbound-only notifications sink; reject it when
   the adapter/host cost exceeds the functionality gained.

**P3 — Decisions after evidence.**

10. Consider small deletion/splitting PRs when behavior is
    test-covered, no authoritative ownership is duplicated,
    and the measured maintenance cost improves. A guarantee-seam
    semantic change needs a new ADR. Respect parked-code deletion
    policy (no earlier than 2026-12-01, and only after live nonuse
    is verified).

## Specific conformance scenarios to add

| Scenario | Expected evidence |
|---|---|
| Missing board/workflow for a lead-scoped lookup | Denial, never another project's result |
| Board provider disabled then re-enabled during a held run | No duplicate accepted result; clear availability/reconciliation |
| Workflow disposed while recovery and dispatch timers are queued | All effects stop or reconcile under the new owner |
| Two competing run/landing attempts after process interruption | Exactly one side-effect owner, or explicit operator intervention |
| Untrusted repository skill changed between discovery and use | Admission-bound content hash and provenance; no silent instructions change |
| Hermes UI (read-only) against a System task under approval/review | No extra DB/dispatcher, no unauthenticated mutations |

These are **proposed tests**, not reported pass/fail results.
Prioritize reuse decisions through [PROP-0023](../proposals/0023-capability-reuse-and-deletion.md);
update canonical architecture/design documents only after a reviewed
implementation changes current or target truth.

## Findings vs confidence

| Finding | Confidence | Evidence still required |
|---|---|---|
| 43 System plugin rows, 10 shipped disabled | High | Actual mounted state of a live instance |
| Concentration of large source modules | High | Executable LOC/call graph and removability |
| Optional reverse service lookups | High | Hot-disable and cross-project tests |
| Plugin-host is not a preventive code-execution gate | High | Exact upstream loader behavior for a candidate |
| Hermes Python/DSH TypeScript plugin ABI mismatch | High | Narrow standalone reuse feasibility |
| Hermes Kanban's current UI is cheap to integrate | **Insufficient** | Real adapter spike, transitive dependency inventory |
| DSH Skills can run unmodified under System pins | **Insufficient** | Exact-version composition test |
| There is a concrete exploit or crash-replay bug | **Not established** | Reproduction/conformance evidence |

## Sources

- [System architecture and package dependency map](../architecture/README.md)
- [Plugin model and composition](../architecture/plugin-model.md)
- [Source package map](../architecture/packages.md)
- [System code-quality conventions](../engineering/code-quality.md)
- [System plugin-host documentation](../../packages/plugins/plugin-host/README.md)
- [System workflow implementation](../../packages/plugins/workflow/src/index.ts)
- [System approvals implementation](../../packages/plugins/approvals/src/index.ts)
- [System resources implementation](../../packages/plugins/resources/src/index.ts)
- [System worker sessions implementation](../../packages/plugins/worker-sessions/src/index.ts)
- [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DSH skill registry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill/README.md)
- [DSH filesystem skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)
- [Hermes plugin API](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
- [Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
- [Hermes memory providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)
