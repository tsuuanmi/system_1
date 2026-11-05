# ADR-0086: Production (v1.0) is the lean core, hardened, and judged by reliability targets

- **Status:** Proposed
- **Date:** 2026-11-05
- **Related:** [PROP-0022](../../proposals/0022-lean-core.md),
  [ADR-0011](0011-mvp-integration-via-mcp.md) (supersedes in part: the gateways no longer come in
  v1.0), [ADR-0036](0036-guarantee-core-and-capability-plugins.md),
  [CON-6](../../requirements/constraints.md), [purpose](../../requirements/purpose.md),
  [release scope](../../requirements/release-scope.md#production-ready-v10)

## Context

Release scope defined v1.0 as the complete target architecture: both model gateways, the
scientific-research profile, a published bundle, A2A when a peer appears, and every requirement in
the SRS. Since then the live install has shown that the parts in use are smaller than the parts
built ([lean core research](../../research/lean-core-2026-11-01.md)): website Workers carry 3 % of
the work, the two gateways served 16 conversations, a task takes a median of 1.6 hours, 6.5 % of
tasks finish unattended, the operator makes about 116 decisions a day, and the ledger counts about
3.9 times the real spend. On 2026-11-01 the operator froze new features (PROP-0022). On 2026-11-03
the operator stated what System is for: work state in artifacts, so any replaceable Worker can
continue it; any workflow; and the person decides only what matters.

The operator answered the production-direction questions on 2026-11-05.

## Decision

1. **One operator per install.** v1.0 stays a hardened per-user deployment (CON-6): no shared
   server, no multi-user tenancy, no OAuth. A team install is reconsidered only after the Base
   pilot proves the loop.
2. **v1.0 is the lean core, hardened.** It holds what PROP-0022 keeps: routing to the right Worker,
   durable runs that survive a restart, independent review, required checks before landing, and
   right usage and quota figures, with the operational readiness that makes them dependable. The
   gateways, the scientific-research profile, the published bundle, A2A, and the feedback loop's
   F3 to F7 move to 1.x ([release scope](../../requirements/release-scope.md#after-v10-1x)).
3. **The purpose leads with handoff.** System's centre is artifact-based handoff between
   replaceable Workers (P5), for any workflow (P6), with the person deciding only what matters
   (P7). Website Workers stay a first-class kind of Worker, and P1 to P4 are what a mix of Workers
   buys; they are no longer the reason System exists.
4. **System stays on DSH core.** The [capability reuse audit](https://github.com/tsuuanmi/system/pull/42)
   decides, plugin by plugin, what is deleted or replaced by an existing DSH or other capability.
   It does not change the foundation.
5. **Reliability targets are the exit criteria.** v1.0 is judged by measured targets on the live
   install, not by a list of features
   ([exit criteria](../../requirements/release-scope.md#production-ready-exit-criteria)). The
   baseline is the week PROP-0022 measured. Speed and cost come second: they are reported, and
   they do not gate.
6. **The feature freeze holds until v1.0.** Work until then is fixes, deletions, switching an
   existing part on or off, and measurement. The operator may grant an exception case by case,
   only for a change that directly moves one of the reliability targets; the grant is a recorded
   decision.

## Consequences

- REQ-GW-1, REQ-GW-2, REQ-GW-5, REQ-HOST-3, and REQ-WF-9 no longer gate v1.0. The built
  gateways stay, off by default, under the freeze; whether they are parked is PROP-0022 change 6's
  decision.
- v1.0 no longer tests P6 with a second, non-code workflow; the scientific-research profile is the
  first 1.x item to test it.
- A milestone or increment that moves no target waits until after v1.0, even when it is accepted.
  The [roadmap](../../proposals/roadmap.md) marks which work moves a target.
- The targets need their measures on the live install. Where the store does not hold the measure
  yet, adding it is work that moves a target and is inside the freeze.
- The purpose identifiers P1 to P7 do not change, so links and traceability keep working.
