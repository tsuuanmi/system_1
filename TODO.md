# TODO: clean, lean documents

Temporary, with [PLAN.md](PLAN.md). Only the lead edits this file. Workers claim units on
the board (`board_claim`), never here. Each unit owns its files: no file is in two units.

States: `todo`, `inventory`, `decided`, `rewriting`, `review`, `landed`.

## Phase 0

| # | Item | State |
|---|---|---|
| 0.1 | worktree `system-wt-docs`, branch `docs/lean-docs`, draft PR | in progress |
| 0.2 | purpose P5 to P7 (artifacts and replaceable Workers, any workflow, the person decides only what matters); README "Why" | done |
| 0.3 | PLAN.md, TODO.md | done |
| 0.4 | board tasks A (Antigravity identity reader) and B (`credential` agent accounts) | todo |

## Units (phases 1 to 3)

Words are from dev `f5760d86`. ChatGPT Web takes about 24,000 characters per turn, so a
large file is inventoried by section, or by a Gemini API Worker (a large context).

| Unit | Files | Words | Inventory | Writer | Task | State |
|---|---|---|---|---|---|---|
| U1 | `requirements/`, `architecture/` (except `packages.md`, generated), `security/`, `governance/` | 37k | ChatGPT | Codex, standard tier | — | todo |
| U2 | `decisions/` (ADR index and files) | 79k | Gemini API | Codex | — | todo |
| U3 | `proposals/` and `roadmap.md` | 120k | Gemini API | Codex | — | todo |
| U4 | `research/`, `review/` | 55k | ChatGPT | Codex | — | todo |
| U5 | `design/workflow-engine.md` | 29k | Gemini API | Codex | — | todo |
| U6 | `design/agent-runtimes.md` | 26k | Gemini API | Codex | — | todo |
| U7 | `design/approvals.md`, `board.md`, `resources.md`, `routing.md`, `teams.md` | 38k | ChatGPT, by file | Codex | — | todo |
| U8 | the rest of `design/` except `handbook.md` (21 files) | 50k | ChatGPT | Codex | — | todo |
| U9 | `reference/` except generated `mcp-tools.md` and `configuration.md` | 41k | Gemini API | Codex | — | todo |
| U10 | `operations/runbooks.md` | 44k | Gemini API | Codex | — | todo |
| U11 | `operations/` except runbooks; `engineering/`; `validation/` except generated `traceability.md` | 38k | ChatGPT | Codex | — | todo |
| U12 | `design/handbook.md` | 12k | Gemini API | lead, last | — | todo |

## Phase 4 and later

| # | Item | State |
|---|---|---|
| 4.1 | indexes: `docs/README.md`, every area README, AGENTS.md | todo |
| 4.2 | code and script links to changed anchors (`git grep 'docs/'`) | todo |
| 4.3 | regenerate generated files; `pnpm check` | todo |
| 5.1 | cross-family team review of the whole diff | todo |
| 6.1 | measures in the PR; delete PLAN.md and TODO.md | todo |
