# ADR-0080: A sandboxed Bash call the policy does not name runs without the operator

- **Status:** Proposed (turning the rule on is the operator's own decision, D114)
- **Date:** 2026-11-01
- **Related:** T363, PROP-0022 change 1b, D113, D114,
  [ADR-0038](0038-confined-commands-for-claude-code-workers.md),
  [ADR-0078](0078-a-plugin-or-a-mechanism-is-turned-off-at-runtime.md),
  [INV-2](../../architecture/invariants.md#inv-2-fail-closed),
  [INV-6](../../architecture/invariants.md#inv-6-authority-comes-from-trusted-envelopes),
  [INV-13](../../architecture/invariants.md#inv-13-every-decision-is-an-artifact),
  [INV-14](../../architecture/invariants.md#inv-14-every-record-has-a-versioned-schema)

## Context

A quarter of agent runs end because a Bash call waits on the operator
([research](../../research/lean-core-2026-11-01.md), section 3). ADR-0038 split the work: the
sandbox confines where a command can act, the policy decides whether it should. A call the sandbox
would refuse (a write outside the worktree, a connection) fails inside it and the model sees the
failure; asking the operator about it adds a wait and no safety. But the policy has no way to say
"every other call is fine here": a Bash call it does not name is the `command` class, which asks.

## Options

1. **Keep asking.** Safe, and the cost measured above.
2. **The sandbox as the authority** (the first draft of PROP-0022): reverses ADR-0038. Rejected.
3. **A rule in the policy** (chosen): the policy allows what it does not forbid or ask for, in a run
   whose confinements were proved.

## Decision

Option 3. `autonomy-policy@1.7` adds one optional field, `sandboxedCommands`:
`{ id, forbid?, ask?, note }`, where each `forbid` and `ask` entry is a command shape (`id`,
`program`, literal `words` after it, an `anyWord` regular expression, `note`).

- **When it applies.** To a Bash call of the `command` class that no commands-list line and no command
  rule allows, in a `workspace-write` run whose runtime proved both confinements
  (`RuntimeEvidence.sandboxedCommands` with `readsConfined`): the host's read confinement, and an SDK
  sandbox that writes to the worktree only, has no network, and allows no unsandboxed command
  (`allowUnsandboxedCommands: false`). A read-only run, an unproved run, a review member's, a
  research run, and a Codex Worker (it keeps `approvalPolicy: never` inside its own sandbox and
  reports no such evidence) are never reached.
- **The order** is the policy's own: `forbid`, then `ask`, then the rule (`auto`), then the class
  default. A shape matches by the program's base name, its literal words, and any word. A `command`
  mode of forbid still forbids. A call that asks to run unsandboxed is never allowed by the rule: the
  gate refuses the `dangerouslyDisableSandbox` field outright (`unsupported-field`).
- **Only the studio grants.** The rule is in force when the studio policy holds it; a project policy
  that carries it only adds `forbid` and `ask` shapes (it can narrow, never widen).
- **Recorded.** The gate asks the policy with `sandboxed: true`, and the `autonomy` decision names
  the rule (`sandboxedCommand: { rule, outcome, by? }`), as it names a command rule.
- **The switch** `agent-workers.enforce.sandboxedCommands` (ADR-0078; mechanism `sandboxed-commands`):
  `on` applies the rule, `warn` (the start mode) records, as a `gate` decision of rule
  `agent-workers.tool-gate`, the verdict the rule would give (`sandboxedWould`, `sandboxedRule`,
  `sandboxedBy`, the command) and the call still asks, `off` ignores the rule.
- **Taking effect** is two operator acts, neither made by this change: the studio policy gains the
  rule through a policy change, and the switch goes `on` (D114). The shipped and live policies' rules
  are not changed here.

## Consequences

- With the rule held and the switch `on`, a proved run's unlisted Bash call runs without waiting; the
  shapes in `ask` (a push, a download, a path outside the worktree) still wait, and `forbid` still denies.
- The shapes are guard rails over the sandbox, not the boundary: `env git push` is no shape of
  `git push`, and fails in the sandbox for want of a network. The sandbox stays the bound.
- `warn` shows the operator which calls the rule would allow before the policy change.
- `Approvals` gains an optional `Action.sandboxed`; a provider that ignores it asks as before.
- **Measure:** agent runs that end on an approval, command requests a week, and the `warn` records.
- Revisit if a shape language this small proves too narrow for the asks the operator wants.
