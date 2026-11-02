# ADR-0083: A budget line on a template counts every account's pool of it

- **Status:** Proposed
- **Date:** 2026-11-02
- **Related:** [PROP-0023](../../proposals/0023-worker-roles-and-token-budget.md) change 3, T388,
  [ADR-0047](0047-a-run-stops-at-a-boundary-once-its-task-budget-is-spent.md),
  [ADR-0052](0052-accounts-are-assigned-unless-pooling-is-recorded.md),
  [ADR-0065](0065-a-cap-fails-closed-on-usage-the-ledger-could-not-count.md),
  [INV-2](../../architecture/invariants.md#inv-2-fail-closed),
  [INV-9](../../architecture/invariants.md#inv-9-everything-is-bounded)

## Context

A board task's `budget` lines cap what its attempts draw, each line on one pool. A pool template
makes one pool per account, `<template>/<account>` (ADR-0052), so a limit on one account never
closes another's. The router picks the account at a step's start, after the budget is reserved, so
no line can name the pool a task will draw on: a line on `claude-code.agents/<one account>` caps
nothing the task draws on another account. No board task of the week of 2026-10-26 declared a
budget, and Claude usage was about 52 USD API-equivalent per accepted result
([token use](../../research/token-use-2026-11-02.md)).

## Options

1. **One line per account.** The task's lines cap each account apart, so the total is the sum of
   the caps and grows with every account added.
2. **A new kind of line naming a template** (`template` beside `pool`). A record shape change on
   `budgetLine` in `common@1`, the board, the ledger, and every reader of a line.
3. **A line on a name counts that pool and the pools named under it** (chosen): `covers(line,
   pool)` is `pool === line` or `pool` starts with `line/`. A template's pools are named
   `<template>/<account>`, so a line on the template's id counts all of them; a line on a concrete
   pool counts that pool only, since no pool is named under one.

## Decision

Option 3. In the ledger (`resources`):

- A cap counts its scope's usage records and unexpired holds of every pool its line covers.
- A line is available when its own pool is; a line on a name with no pool of its own is available
  when one pool under it is, and `not configured` when none is (fail closed, INV-2).
- Usage the ledger could not count (ADR-0065) is looked for in every known pool a cap covers.

In the engine, a task's start checks its budget's lines the same way. The board's configuration
gains `defaultBudget`, the lines a task gets when its proposal names none; empty by default, so
nothing changes until the operator sets it.

## Consequences

- One line, such as `{pool: claude-code.agents, unit: usd, amount: 6}`, caps a task whichever Claude
  account serves it.
- No line in use changes meaning: a pool id is never a prefix of another pool's id followed by `/`
  unless a template made it so.
- A pool configured by hand whose id has a `/` (`plan/acc-a`) is counted by a line on `plan` too,
  which is the same grouping a template makes.
- The engine still reserves the step's least amount on the line's own name, so the hold counts
  against the cap before any account is chosen.
