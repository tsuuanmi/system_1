# TODO: clean, lean documents

Temporary, with [PLAN.md](PLAN.md). Only the lead edits this file. Workers claim units on
the board (`board_claim`), never here. Each unit owns its files: no file is in two units.

States: `todo`, `inventory`, `decided`, `rewriting`, `review`, `landed`.

Progress (2026-11-03): inventory by four Haiku subagents; the operator approved the deletion list;
deletions landed (fbec3bc9); a first rewrite pass by subagents, reviewed by the lead. Docs words:
584,577 (dev) to 480,771 (-17.8%). A second rewrite pass of the largest design and reference files
remains.

## Phase 0

| # | Item | State |
|---|---|---|
| 0.1 | worktree `system-wt-docs`, branch `docs/lean-docs`, draft PR #43 | done |
| 0.2 | purpose P5 to P7 (artifacts and replaceable Workers, any workflow, the person decides only what matters); README "Why" | done |
| 0.3 | PLAN.md, TODO.md | done |
| 0.4 | board tasks A `task-daf2792ab048` (Antigravity identity reader) and B `task-43609e954895` (`credential` agent accounts) | proposed |

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

## System defects found while running this work (separate tasks, after it)

| # | Defect | Evidence |
|---|---|---|
| S1 | Routing ranks load after quota class, so a queued subscription Worker wins over idle metered ones: five parallel economy `ask`s all queued on ChatGPT while seven Gemini Workers were free | runs `run_482254d60538648b` to `run_01115fa195636975` |
| S2 | Model Workers report no load and no quota, so every Gemini Worker ties and the id decides: every team member went to `model:gemini-2-std`, keys 3 and 4 were never used | `system usage`, 2026-11-03 10:05 to 10:15 UTC |
| S3 | A model Worker whose provider answers 429 `QUOTA` gets no cooldown: routing kept sending members to the exhausted key | `run_bd3027ed288d9064`, `run_f3c0438019b019dc` |
| S4 | A profile patch was reverted to an older backup by another session (16:09 local), silently undoing PROP-0023 change 1's roles | `cordis.patch.yml` against `cordis.patch.before-prop-0023-2026-11-03.yml` |
