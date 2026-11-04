# Resources

> Target state. Boundary: [routing](../architecture/components.md#routing), core component
> *resource ledger and metering*
> ([ADR-0036](../decisions/adr/0036-guarantee-core-and-capability-plugins.md)). Proposals:
> [PROP-0010](../proposals/0010-base-version.md),
> [PROP-0008](../proposals/0008-studio-operating-model.md#resource-management-and-token-optimization).
> Records: [`usage-record@1.0`](../reference/schemas.md#usage-record),
> [`limit-state@1.0`](../reference/schemas.md#limit-state),
> [`quota-draw@1.0`](../reference/schemas.md#quota-draw).
>
> Defined in [`resources-core`](../../packages/resources-core/README.md); provided by
> [`resources`](../../packages/plugins/resources/README.md) on `ctx.store`, with the MCP tools
> `resources_pools` and `resources_usage`. Agent Workers configured with a pool reserve, record,
> and observe through it ([agent runtimes](agent-runtimes.md#metering)), naming the board task
> their brief serves; the workflow engine reserves a board task's budget lines before each step of
> its run ([a task's budget](workflow-engine.md#a-tasks-budget)) and asks to fund a spent one by lines
> computed from the ledger's count of the task's usage
> ([funding a spent task](workflow-engine.md#funding-a-spent-task)). Differs from target: no
> other Worker source reports, no transcript is reconciled, the engine reserves only for a
> task that declares a budget, the bundle configures no pool, no metering oracle checks recorded
> usage, and usage the ledger cannot count counts as 0 against a cap: it is recorded and shown,
> and no cap fails closed on it ([usage the ledger cannot count](#usage-the-ledger-cannot-count)).

The ledger knows what each configured pool has left and what every run consumed. Its numbers come only
from objective sources (a runtime's result message, a provider's usage fields, an agent's session transcript,
a limit notice, an invoice), never a model's own report of its usage. Pools are operator configuration because
plan terms change: one account can have an interactive window, a programmatic credit, and an API key, and a
Claude Code Worker run through the Agent SDK may draw on a different pool than interactive use.

## Seam

`ctx.resources` (`Resources` in `@tsuuanmi/system-resources-core`), contract 1.3:

| Method | Does |
|---|---|
| `pools(filter?, at?)` | every configured pool (and every pool made from a template for a declared account), each window's latest reading, and whether it is available at `at` |
| `observe(reading)` | record a `limit-state` reading |
| `reserve(request, at?)` | reserve before a run; records a `budget` decision |
| `release(reservationId)` | release a reservation once the run's usage is recorded, or it never started |
| `record(usage)` | record one unit's `usage-record`, deduplicated. Contract 1.3 ([ADR-0065](../decisions/adr/0065-a-cap-fails-closed-on-usage-the-ledger-could-not-count.md)): a `usage-record@1.1` with `partial` is a lower bound, kept so, and blocks caps of its scope and pool until the run has a whole record there |
| `usage(filter?)` | the counted records and their totals per pool |
| `declare?(source, accounts)` | optional, 1.1 ([ADR-0052](../decisions/adr/0052-accounts-are-assigned-unless-pooling-is-recorded.md)): a Worker source's accounts, replacing its previous declaration; one pool per [template](#pool-templates) and account; returns their ids |
| `quota?()` | optional, 1.2 ([ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md)): the operator's [quota settings](#quota-settings), validated when the provider loaded |

## A run's budget

An engine or Worker source reserves (`reserve`; refused, nothing starts), starts the run only when reserved, records the runtime's result message as a `usage-record` (source `runtime-result`), then releases. A crashed run has no result message: its transcript is recorded later (source `transcript`). A limit notice is `observe`d as a `limited` reading with `cooldownUntil`.

| Step | Who | Records | On failure |
|---|---|---|---|
| observe | a Worker source or runtime, from a status line, limit notice, response headers, or result | the reading as an `evidence` artifact; the window's latest reading by `observedAt`; a `resources.pool.limited` event (pool, account, window, `until`, source, evidence) when the reading closes an open window, which [notifications](notifications.md) read | refused for a pool or window not configured (`unknown-pool`) |
| reserve | the engine before each step of a board task's run, or a Worker source before a run | a `budget` decision, `reserved` or `refused`, with a reason per pool or cap | refused for a pool not configured or unavailable, or a cap that would be exceeded |
| record | the Worker source, after the run | the record as a `receipt` artifact | refused for an unknown pool (`unknown-pool`), a schema violation, or cached input above the input (`invalid`) |
| release | whoever reserved | the hold is removed | an unknown reservation is refused; an expired one releases quietly |
| expiry | time | a hold nobody released (a crashed run) stops counting at its `expiresAt` (`holdSeconds`, default 4 hours) | — |

## Pools and availability

A pool is `available` while every window reads `ok` (or the pool is configured `unknown: available`), `limited` while a window reads limited (until the later of `cooldownUntil` and `resetsAt`), and `unknown` with no reading yet or a window that reads `unknown`.

A window with no reading yet is `unknown`, like an explicit `unknown` reading: missing telemetry is not
capacity. A pool with an unknown window is unavailable unless configured `unknown: available` (a pool that never
reports, such as a local model); a plan window that reports only after a first response needs that setting, or its
first reading comes from the runtime's result. Every reading field is optional.

### Pool templates

Accounts of one provider each have their own windows, so a limit on one never closes another's. The
operator configures a **template** once (`templates` on the `resources` row: `template`, `group`, `kind`,
`windows`, `unknown`), and a Worker source **declares** its accounts (`declare(source, [{ account, group }])`).
From every template whose `group` is the account's, the ledger makes the pool `<template>/<account>`, listed,
reserved, read, and recorded like any configured pool; `resources_pools` shows each account's own windows and
resets.

- A declaration replaces the source's previous one. A withdrawn account's pool is no longer listed, and a
  record or reading for it is refused (`unknown-pool`); its readings and records stay, and stand again once it
  is declared again.
- Declarations are in memory, so the source declares again after a restart. The `agents` source declares its
  ready assigned accounts of metered providers ([agent runtimes](agent-runtimes.md#workers--account--role)).
- Refused (`invalid`), changing nothing: an account that is not an id, or a group that is not a name; a pool
  that is configured or belongs to another source; more pools, configured and declared, than `resources_pools`
  lists (64). A template's id and group contain no `/` or `:`, so a pool id names one template and one account.

### Readings from an account's usage report

> Decision: [ADR-0059](../decisions/adr/0059-quota-readings-from-each-accounts-own-usage-report.md).
> Implemented in the agent runtimes' `limits` ([an account's usage report](agent-runtimes.md#an-accounts-usage-report))
> and the `agents` source ([`agent-workers`](../../packages/plugins/agent-workers/README.md)).

Each account's pool is fed by its own readings, so its windows show its own plan and use, with no plan
written into configuration:

| When | What is read | Recorded as |
|---|---|---|
| during a run | the runtime's own events (Claude Code's `rate_limit_event`; Codex's limit message) | readings of the mapped windows, `source: runtime-result` |
| after each run of a derived Worker on a declared pool, and after any run that hit a limit, once, before its usage is recorded and its reservation released | the account's usage report (`limits({ home })`: Claude Code's `get_usage`, the Codex app server's `account/rateLimits/read`, the Antigravity CLI's `/usage` JSON), in the run's home, without a model turn | `limit-state@1.0` readings of the mapped windows, `source: runtime-result`, after the run's own; with no pool, a rejected window's reset ends the account's cooldown |
| every `limitReadSeconds` (the provider entry; default 600, 60 to 86400, `0` off) for each ready, assigned account with a declared pool, unless a read is newer; one periodic read in flight per runtime | the same report | the same |

- **Pools come from enrollment.** A newly enrolled account assigned a role is declared, so it gets `<template>/<accountId>`, and its first report fills its windows. Nothing is configured per plan.
- **A Claude Code account is judged by its five-hour window only.** Its report gives no seven-day reading (null server-side), and a spent seven-day quota shows as an unusable five-hour window. A window never read is never headroom, so a Claude pool template declaring a seven-day window would fail closed and dispatch would never pick a Claude account: its template declares `five-hour` only, and its provider entry maps `five_hour` only.
- **Fail closed.** A report never opens a window a `limited` reading closed before the later of that reading's reset and cooldown (without end when it names neither; rule 2 below); that `ok` reading is not recorded, and is logged. A report that cannot be read, or is on a runtime version whose format was not checked, records nothing; the window keeps its last reading and `observedAt`. A report that says a window has nothing left closes it until its reset; one used up in a window the provider's `windows` does not map closes every window of the pool.
- **What stays unknown:** absolute amounts (reports give shares); windows a runtime does not report; API-key
  accounts (no plan windows); the Antigravity CLI beyond its one home; website accounts and the Gemini API, which
  tell a limit only when it is hit.
- - **The seam does not change** (ADR-0036): `observe` takes these readings as it takes a run's (contract 1.1, `limit-state@1.0`). The roster shows each window's `used`, `resets`, and `observedAt` (`mcp-roster@1.1`; [roster](roster.md#surfaces)).

### Quota settings

> Decision: [ADR-0064](../decisions/adr/0064-system-starts-ready-work-under-the-dispatch-action-class.md).
> Contract 1.2.

The `resources` row's `quota` holds what the quota score (`quota-score@2`, [routing](routing.md#quota-in-every-route)) reads besides the pools. Each value is a whole number, validated when the row loads; one out of range refuses the row with its path. The ledger reads them only through `quota()` and counts, reserves, and closes nothing by them. One implementation in `libs` turns them and the pools into each account's headroom and order ([ADR-0066](../decisions/adr/0066-every-route-orders-workers-by-their-accounts-quota-headroom.md)).

| Key | Default | Range | Meaning |
|---|---|---|---|
| `reservePercent` | 20 | 0 to 90 | share of every window kept for the operator's own use. Work System starts by itself never starts into it. Every route ranks a Worker whose account is over it (used above `100 − reservePercent` % of a window, or at its limit) last while another admitted Worker has headroom; it refuses nothing, a run that crosses into it keeps going, and such a Worker still takes work when no other can |
| `useSoonMinutes` | 90 | 0 to 1440 | a window that resets this soon, with headroom, is used first; 0 never |
| `minHeadroomPercent` | 10 | 1 to 100 | the headroom a window about to reset needs to be used first |
| `headroomBucketPercent` | 5 | 1 to 25 | headroom is compared in buckets this wide |
| `staleReadingSeconds` | 1800 | 60 to 86400 | a reading older than this leaves its window unknown, never capacity; keep it above `limitReadSeconds` (default 600) so the account's own report keeps windows fresh |

- A ledger without `quota()` keeps no reserve, so the dispatch pass finds no Worker free (INV-2); routing and the roster then read the defaults (the 20 % reserve).
- A window is not known if it has no reading, or a stale, `unknown`, or `limited` one, or no used share, or its reading predates its reset. A pool configured `unknown: available` is never read as having headroom. A pool with no reading at all is **unread**: dispatch admits its account at a bound (`dispatch.maxRunningUnreadPerAccount`, one run at a time), after every account with headroom, so a website Worker never read still takes work; a reading replaces the bound.
- **The canonical gauge** of an account is the windows its pool lists, which the operator configures; a Claude Code plan's pool lists only its five-hour window, and its weekly windows are not read into headroom ([read each account's quota](../operations/runbooks.md#read-each-accounts-quota)).
- A per-template reserve and dispatch onto metered pools are never done (PROP-0014; D65).

### Quota drawn per run

> Proposal: [PROP-0015](../proposals/0015-right-worker-right-job.md) E2. Record:
> [`quota-draw@1.0`](../reference/schemas.md#quota-draw).
> Implemented in the `agents` source ([`agent-workers`](../../packages/plugins/agent-workers/README.md)),
> the rule in [`libs`](../../packages/libs/README.md) (`drawEntries`, `drawFigures`), shown by `system usage`
> and the [report](reports.md#what-it-counts).

For each run of a derived Worker on a declared pool, the `agents` source keeps each window's latest reading (`pools()`) before the run is submitted, with the start of a watch of the other runs on the same account, and again after the run, once the account's usage report after it was recorded ([above](#readings-from-an-accounts-usage-report)), with how many other runs on the account overlapped it. Each window's two readings give one outcome:

| Outcome | When | Draw |
|---|---|---|
| `no-reading` | no reading before, none observed after the run ended (its report could not be read), or no used share | none (nothing is estimated, rule 3) |
| `reset-crossing` | the two readings do not name the same reset (the later of `resetsAt` and `cooldownUntil`, as `accountQuotaOf` reads it), or the share went down | none |
| `confounded` | another run on the account was in flight between the two readings (`overlapping` counts them) | kept, never in a figure |
| `clean` | otherwise | counts |

- **One entry per window**, never one figure for the account. A draw is the rise of the used share in **percentage points** of the window's allowance, so it compares with headroom (`100 − used − reservePercent`); never negative.
- The watch is in memory, so a run a restart interrupted gets no reading after, no record, and nothing is replayed (INV-4).
- **Recorded** as an `evidence` artifact under the run's workflow run and step, and one `quota.draw` event whose data is the record: the run, Worker, account, pool, the kind of work it was admitted for (`WorkRequirement.kind`), the template step it served (`WorkerStart.step`), its board task, and how it ended. A failure to record is logged and never changes the run's outcome.
- **Shown** per kind and window, and per kind, template step, and window: the clean draws counted, their median and 90th percentile (nearest rank), and the entries left out by state. `system usage` (MCP `usage`, `draws`) reads the latest 1,000 records; the report reads the period's (`mcp-report` 1.4, `usage.draws`).

## Counting

- One record per `(source, requestId)`; a duplicate is stored as an artifact but not counted.
- A unit is counted once across sources: a `transcript` record of a run that has a `runtime-result` record is a
  duplicate.
- **A usage record is the run's own spend** (`usage-record@1.2`). A runtime result may report its session's running totals, as the Claude Agent SDK's result on a resumed session does ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)). Such a source names the session in `sessionTotals`, and the ledger counts by the **difference rule**:
  - the run's own spend is the result minus the session's latest result already in the ledger, in every counter (tokens, per-model tokens and cost, turns, cost);
  - the first result of a session is counted as it is (from zero), unless a run of the session ended before it with no result: then the next two rules hold for it too;
  - a run of the session that ended with no result leaves its spend in the next difference, and that record says so (`includesUnrecorded`). This covers a run whose lower bound (`partial`) was counted since the session's latest result (or since it began), by its agent session or by the result's own run (a run the host's stop cut, then resumed), or one with no record at all, as the session's `usage.unknown` fact says (without the event log, the flag cannot be read, and the numbers are the same);
  - those lower bounds are taken from the difference, each counter floored at 0 (at most 100 of them), so they are not counted twice and the session totals its last result's;
  - a difference negative in any counter (a session that started over) is counted as the full result, `notDifferenced`, never negative or zero.

  The stored record keeps the original (`resource_usage.record`, and the `receipt` artifact). The counted columns, and the record `usage()` returns, are the run's own spend, without `sessionTotals`. A run the host's stop cut and ran again, whose result carries `sessionTotals`, is counted whole. A stored record without `sessionTotals` follows the same rule when its `runtime-result` id `<runtime>:<session>:<uuid>` names its runtime's result (also one whose only `partial` says it ran again after the host's stop); `<runtime>:<run>:again-<n>` and a streamed lower bound stay lower bounds.
- A cap counts, for its scope (a task, else a project), every counted record of its pool in its unit, plus every
  unexpired reservation held for that scope. Its pool is a name: it counts that pool and every pool named under it
  (`<name>/<account>`), so a line on a template's id counts every account's pool of it and a line on a concrete
  pool that pool alone; a line with no pool of its own is available while one pool under it is
  ([ADR-0083](../decisions/adr/0083-a-budget-line-on-a-template-counts-every-accounts-pool.md)). Units: `tokens` are
  input plus output, `usd` the record's cost, `turns` its turns, `runs` one per record, `minutes` its duration.
- A record counts for a task when it names the task (an agent Worker's record names the task its brief serves) or
  its run was reserved for it. A board task's brief counts more: the engine also reads the records of the runs that
  served the task and of the executions they started, each once
  ([usage spent on a task](workflow-engine.md#a-board-tasks-brief)); a cap does not.

## Usage the ledger cannot count

Some usage reaches no counted figure, or only a lower bound of one:

| Case | A cap of its scope and pool |
|---|---|
| a counted record without the figure of a cap's unit (no token counts, no `cost`, no `turns`, no `durationMs`) | counts 0 of that unit; the record's other figures, and `runs` 1 |
| a run that ended before its runtime's final count (a stop, a timeout, a drain at the host's stop, a deferred call) whose runtime reported some usage while it ran | its lower-bound record is counted, and the cap is refused until the run is reconciled |
| a run with no record at all: its runtime reported neither tokens nor turns (nor any number above 0), the host stopped it and no result came, the ledger refused its record (`unknown-pool`, `invalid`), or `record()` failed | refused until the run is reconciled |

**Why a run goes `not-reported`.** Its numbers come from its final message (the Claude Agent SDK's `result`, with its `modelUsage` and `num_turns`; Codex's `turn.completed` events). A run that ends before it (stopped by the operator, past its `runTimeoutMs`, stopped by the host or a drain, or at a deferred call) has none. What it reported while running is kept as a lower bound, marked `partial` with why, never as an estimate ([metering](agent-runtimes.md#metering)): the Claude Agent SDK provider sums the `usage` of the assistant messages it streamed (each response once, at its largest), and Codex sums the tokens of its completed turns.

**Codex's tokens.** A Codex record carries `turns` and token counts, never a `cost`. Its `cached_input_tokens` and `cache_write_input_tokens` are parts of `input_tokens`, and `reasoning_output_tokens` is a part of `output_tokens`; no part is added to its whole ([Codex metering](agent-runtimes.md#codex-metering)). Capacity is still judged by its windows; its per-run token totals are kept for a later forecast.

Unknown usage is never counted as 0, for every pool kind (INV-2, [ADR-0065](../decisions/adr/0065-a-cap-fails-closed-on-usage-the-ledger-could-not-count.md)). Each case is visible and durable:

- **A record without a figure** names its run, Worker, pool, and task, and lacks the missing figure. The [report](reports.md) counts the records without token counts, a cost, or turns per pool (an agent Worker's record always carries its duration).
- **A run with no counted record** is recorded by the Worker source that meters it as a `usage.unknown` event whose data is a [`usage-unknown@1.0`](../reference/schemas.md#usage-unknown) record: the run, Worker, pool, account, session, board task and project, how it ended, and its kind (`not-reported`, `interrupted`, `refused`, `failed`) with why. The reason says how the run ended and what its runtime reported. The event names the workflow run, whose view maps the run to its step. Nothing estimates usage. A run may get two (aborted by a stop, then found interrupted at restart): readers count it once, by its first.
- **A run the host's stop cut that runs again** (resumed in its native session, or started again in its worktree) keeps the fact its cut execution got. Its runtime reports only what it used since the restart, so its record is a lower bound (`partial`) and a unit of its own (its `requestId` is the run's with `:again-<n>`) and never reconciles the run; what it used before the stop is left to transcript reconciliation, never invented, unless its result reports `sessionTotals`, which makes the record whole and reconciles the run ([counting](#counting)).
- **A run with a lower bound counted** gets its record of that bound, `usage-record@1.1` whose `partial` says why, and a `not-reported` fact (`usage-unknown@1.1`) whose `partial` names that record. A partial report with no number above 0 gets no record: a reported 0 would read as known. The record never reconciles the run (a lower bound is not its usage) and marks itself one in the ledger's one write, so a crash or failed append never leaves it reading as the run's usage, even through a restart. If the fact cannot be appended, it is logged, and the record keeps the caps closed (health and the report, which read the facts, then do not name the run). A later `transcript` record of the same run duplicates its `runtime-result` one, so transcript reconciliation will have to replace the lower bound.
- **A cap fails closed** ([ADR-0065](../decisions/adr/0065-a-cap-fails-closed-on-usage-the-ledger-could-not-count.md)): the store-backed ledger refuses a reservation whose caps have a scope (a task, else a project) while a run of that scope has a fact in a capped pool that is not reconciled, or only lower bounds (`partial`) counted in a capped pool, fact or none (at most 100 such runs named). The `budget` decision names each run, its Worker, and why. It also refuses when no event log is loaded, when more than 10,000 `usage.unknown` entries are kept, or when an entry is not a valid record, since whether such a run exists is then unknown. Requests without caps, or caps without a scope, are not concerned. Nothing reconciles a run until transcript reconciliation exists, so the way out is the [runbook](../operations/runbooks.md#usage-the-ledger-could-not-count). Target: the seam's conformance suite gains this rule once its fake ledger reads the event log.
- **A failed `record()` is never lost silently.** A record refused as `invalid` with a per-model split is offered again with its totals alone, which are what a cap counts. Still refused, it is kept as an `evidence` artifact (when a valid `usage-record@1.0`) that the fact names, with the ledger's failure; a fact that cannot be appended is logged.
- **Reconciled:** a unit is reconciled once the ledger counts a usage record of its run in its pool that is not a lower bound (no `partial`; `countedWhole` in libs). Transcript reconciliation writes it (`source: transcript`).

## Fail-closed rules

1. No run starts without a reservation; with `ctx.resources` unavailable, none is made and no run starts (INV-2).
2. A limited pool admits no new work until its window resets, and a limit hit is never retried on the same pool
   (PROP-0008: switch account or wait). The wait lasts until the reset its runtime read from the agent's own report
   ([limit readings](agent-runtimes.md#limit-readings)), else for the Worker's cooldown; an unreadable reading never
   opens a pool.
3. Usage is never estimated from a model's own report. A missing number stays missing: a run whose usage the ledger
   could not count refuses a cap of its scope and pool until reconciled, and is recorded and shown
   ([above](#usage-the-ledger-cannot-count), ADR-0065).
4. Every cap is enforced before the run, never after, and every hold expires (INV-9).

## Conformance

[`resources-core/conformance/resources.ts`](../../packages/resources-core/conformance/resources.ts), 15 scenarios at
contract 1.2 (1.1 adds `templates-per-account`; 1.2 adds `quota-settings`, the settings in range and the defaults
when none is configured), run against the fake provider and the store-backed one. The metering oracle against
`ccusage --json` comes with the first Worker that reports usage (B2).
