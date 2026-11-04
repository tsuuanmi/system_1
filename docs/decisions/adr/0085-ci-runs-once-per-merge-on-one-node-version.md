# ADR-0085: CI runs once per merge, on one Node version, in parallel jobs

- **Status:** Accepted
- **Date:** 2026-11-04
- **Related:** [ADR-0026](0026-versioned-releases-with-provenance.md) (supersedes in part its
  "Supported runtime" CI matrix), [ADR-0084](0084-browser-backed-tests-are-release-checks.md),
  [CON-2](../../requirements/constraints.md), [CI gates](../../engineering/testing.md#ci-gates)

## Context

CI ran on every pull request, every push to `main` and `dev`, and nightly, each time on three Node
versions (24.18.1, the latest 24, the latest 26), with the check, the suite, e2e, and crash
injection one after another in one job: 25 to 27 minutes a run, and three runs' runner minutes.
The suite alone took 14 to 24 minutes on a 4-vCPU runner. The operator asked for CI only on a merge,
on one stable Node version, and faster.

## Decision

1. **Merges only.** CI, CodeQL, and the audit run on a push to `dev` (every merge into it), on a
   release tag through the release workflow, and by hand (`workflow_dispatch`). A commit or a pull
   request runs none; the author runs `pnpm check` and the affected test groups locally. The audit
   and CodeQL keep their schedules (an advisory or a query arrives without a commit).
2. **One Node version**, the latest 24, inside CON-2's range. `engines` and the start-up check still
   name the whole range; ADR-0026's CI matrix over it is superseded. A runtime outside the tested line
   is the operator's to verify on their host.
3. **Parallel jobs**: `check`, the suite in four shards (`vitest --shard`), `e2e`, and `crash
   injection` start together; `ci gate` needs them all and succeeds only when each did.
4. **One required check on `main`**: `ci gate` (with CodeQL and the audit). A `dev` → `main` pull
   request's head is `dev`'s tip, so the checks that ran on `dev` satisfy it.

## Consequences

- A run takes about as long as its longest job (crash injection, about 9 minutes), not the sum.
- A regression only on Node 26 or on the 24.18.1 floor is not caught by CI.
- A pull request into `dev` is merged on the author's local gate alone; a red `dev` is found by the
  merge's run, and fixed forward.
