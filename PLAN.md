# PLAN: clean, lean documents

Temporary. Deleted before the last change of this work lands. Owner: the lead.
Approved by the operator on 2026-11-03.

## Goal

The documentation holds only current truth, once. History is in Git. Every fact has
one canonical home, and other documents link to it.

Baseline (dev `f5760d86`): about 578,000 words under `docs/` in 223 files. A target is
set once the inventory is in: what the inventory shows can go, not a fixed number.

## What stays, what goes

Measure each document against [purpose](docs/requirements/purpose.md) (P1 to P7) and
the authority table in [docs/README.md](docs/README.md).

| Area | Rule |
|---|---|
| requirements, architecture, reference, schemas | keep; trim repetition; current target only |
| design | keep the mechanism; delete status narrative, history, and anything stated in another document (link instead) |
| decisions (ADR) | keep `Accepted` ADRs unchanged; delete ADRs `Superseded` whole and `Proposed` ADRs no longer pursued; an ADR superseded in part stays |
| proposals | delete every implemented or abandoned proposal; keep open ones and the roadmap; the roadmap keeps only what remains |
| research | delete, except evidence an open proposal cites (`lean-core-2026-11-01`, `token-use-2026-11-02`) |
| `docs/review/` | delete |
| operations | keep runbooks for the built system; delete one-time upgrade procedures already done (for example "Update the live install from e218ae7 to the Base release") |
| validation | keep the release checklist and traceability (generated); trim the rest |
| package READMEs | out of scope (a later change) |

Governance changes with this work: AGENTS.md and [governance](docs/governance/README.md)
say "a superseded record is deleted; Git keeps its history" in place of "supersede,
never rewrite" for deletion. An accepted ADR is still never edited in place.

## Constraints (do not break)

- **Anchors code links to.** About 297 source and script files link to headings under
  `docs/`. Before a heading is renamed or deleted, `git grep` for its path and anchor,
  and update every link in the same change. Most linked: `design/workflow-engine.md`,
  `design/handbook.md`, `design/approvals.md`, `operations/runbooks.md`,
  `design/agent-runtimes.md`.
- **`design/handbook.md` reaches Worker briefs.** Changing it changes Worker
  behaviour. It is edited by the lead only, last.
- **Generated files** are regenerated, never hand-edited:
  `docs/reference/mcp-tools.md`, `docs/reference/configuration.md`,
  `docs/architecture/packages.md`, `docs/validation/traceability.md`
  (`pnpm gen:reference`, `gen:packages`, `gen:traceability`).
- **The seam catalog** in `architecture/plugin-model.md` feeds `check:manifests`.
- **Gates:** `pnpm check` (`check:docs` checks every relative link and anchor) passes
  on every landed change.
- **One writer per file** (INV-15): a file is in exactly one unit below.
- **No status words** in design documents; status lives in the roadmap, the ADR
  index, and package READMEs ([status ownership](docs/README.md#status-ownership)).

## Phases

| Phase | Who | Output |
|---|---|---|
| 0 Prepare | lead | this plan, [TODO.md](TODO.md), purpose P5 to P7 |
| 1 Inventory | read-only Workers, economy tier | one inventory artifact per unit: each file `keep`, `trim`, `merge→<file>`, or `delete`, with why; repeated facts and their canonical home; anchors code links to |
| 2 Decide | lead, then the operator once | one deletion and merge list, approved in one decision |
| 3 Rewrite | writer Workers, economy tier, one unit each | the unit's files trimmed, merged, or deleted, with every link to them fixed |
| 4 Cross-links | one writer | indexes (`docs/README.md`, area READMEs, AGENTS.md), code links |
| 5 Review | a team of two families other than the writers' | findings on the whole diff; fixes |
| 6 Measure | lead | words before and after; cost, tier, and Worker kind per step (`system usage`); time per task; operator decisions; reported in the PR |

## Workers

Changed by the operator on 2026-11-03: the work runs directly, not through System, after phase 1
on System stalled on Gemini free-tier quota (20 requests a day per key and model) and routing
defects (TODO.md, S1 to S4). No System Worker runs in this work.

| Who | Model | Work |
|---|---|---|
| inventory subagents, one per area, read-only | Haiku | phase 1: a verdict per file or section, with evidence and inbound links |
| the lead | — | checks every delete and merge verdict, phase 2's list, rewrites, links, the gate |

## Handoff

Every unit's state is on the board. A Worker continues a unit from its task's
artifacts (inventory, brief, dossier) by id, never from another Worker's session.
