# Evaluations

The evaluation engine judges a pre-registered experiment offline. It runs paired trials in a seeded order, measures each trial with the collectors the contract names and the resource ledger, analyses once at the horizon, and records a deterministic `verdict` decision. It promotes nothing: a supported verdict is evidence that a promotion request cites, and the operator decides.

Parked (row off, package frozen) by PROP-0022 change 6; see [docs/proposals/0022-lean-core.md](../proposals/0022-lean-core.md).

## An evaluation

An evaluation checks its pins, seals, judge, families, and measurements before any trial starts, then ends once its horizon, budget, or a broken constraint is reached.

### The schedule

The schedule is a seeded shuffle of the case-and-arm pairs, so the same cases, repetitions, and seed always give the same order.

## The verdict rule

The verdict is `invalid`, `refuted`, `supported`, or `inconclusive`, fixed by pre-registered thresholds read once at the horizon.

## Fail-closed rules

A missing value is never a pass, and a moved pin or seal makes an evaluation `invalid`.
