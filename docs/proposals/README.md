# Proposals

Proposals describe **changes under consideration**. They are evolutionary, not
current truth.

## Lifecycle

```text
draft -> proposed -> accepted -> implementing -> implemented
                  \-> rejected
accepted/implemented -> superseded
```

A proposal that is implemented, abandoned, or superseded in whole is deleted; Git keeps it
([rule](../governance/documentation.md#deleting-what-is-no-longer-current)). What it decided
lives in the design documents and ADRs. Status and remaining work live in the
[roadmap](roadmap.md) and the [ADR index](../decisions/adr/README.md).

- [Research](../research/README.md) provides evidence. A proposal frames a concrete change,
  its alternatives, validation, rollout, and risks.
- Accepting a proposal does not change production behaviour by itself. Current truth changes
  only when requirements, design, source, and tests change.

## Proposals

- [PROP-0005: Session-bound website accounts](0005-session-bound-website-accounts.md)
- [PROP-0008: `system` as a startup template](0008-studio-operating-model.md)
- [PROP-0010: The Base version](0010-base-version.md)
- [PROP-0011: Feedback loop](0011-feedback-loop.md)
- [PROP-0012: Agent accounts](0012-agent-accounts.md)
- [PROP-0013: Feedback from work](0013-feedback-from-work.md)
- [PROP-0014: Dispatch by quota](0014-dispatch-by-quota.md)
- [PROP-0015: Right worker, right job](0015-right-worker-right-job.md)
- [PROP-0016: Operating model](0016-operating-model.md)
- [PROP-0017: GitHub as System's front door](0017-github-front-door.md)
- [PROP-0018: Lean code](0018-lean-code.md)
- [PROP-0019: The lead is a session; its logic lives in System](0019-lead-logic-in-system.md)
- [PROP-0022: Lean core](0022-lean-core.md)
- [PROP-0023: Worker roles and a token budget](0023-worker-roles-and-token-budget.md)

Use [0000-template.md](0000-template.md) for new proposals. The [roadmap](roadmap.md) is a
non-normative queue of milestones, not a substitute for a reviewed proposal.
