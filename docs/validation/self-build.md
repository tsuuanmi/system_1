# System building System

`system` is built with `system`. Its development is a software-development workflow of the kind
the [`algorithm-development` template](../reference/workflow-templates.md#algorithm-development) runs: a lead splits work into
briefs, Workers change code in worktrees of their own, a team reviews the exact change, findings
are fixed, checks validate, and the operator approves. When that loop runs through `system` and
holds, it is evidence that `system` works; where it breaks, it is a defect to fix first.

The measured version of this evidence is the [pilot](../operations/pilot.md) and its
[baseline report](../design/reports.md).

## Before the pilot: team reviews of its own code

`system`'s own `review` template (one member per provider family, quotes checked against the files
read, sealed ballots) reviews security-relevant code of `system` at a pinned commit of this public
repository. The lead checks each finding against the code before any change. Only the findings that
hold are fixed, each with a test that fails on the code before the fix.

## Not yet through system

The rest of the loop has not yet run through `system`: its leads, Workers, and approvals ran outside
it. Each part has a counterpart built (the board and briefs, Claude Code Workers with a worktree per
run and confined commands, remediation and approvals on the queue, the report). The next evidence is
the pilot: the same work run through the board, measured by `system report` against Claude Code alone
([read the baseline](../operations/pilot.md#read-the-baseline)).
