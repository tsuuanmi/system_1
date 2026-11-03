# Research

Research is **non-normative**. It records evidence that an open proposal cites. Nothing here
changes `system` behavior until it is promoted into requirements, decisions, architecture, or design.

| Document | Subject | Analysed revision |
|---|---|---|
| [jev-decision-model.md](jev-decision-model.md) | TypeSafe Jev decision model: routing decisions, prior art, brainstorm D1–D8 | 2026-10-11 (early access) |
| [efficient-system-inputs-2026-10-25.md](efficient-system-inputs-2026-10-25.md) | System's own research, brainstorm and audit runs on quota-aware assignment, Worker strengths, operator communication, handoffs, and Jev (inputs to PROP-0015) | 2026-10-25 |
| [design-review-2026-10-22.md](design-review-2026-10-22.md) | review of the current design; production multi-agent lessons (Anthropic, Cognition, Manus, MAST); neighbouring projects (PAL MCP, claude-code-router, RouteLLM, LiteLLM…); token economics and optimization plugins (RTK, context-mode, Serena, caveman) | 2026-10-22 |
| [ecosystem-for-base-2026-10-22.md](ecosystem-for-base-2026-10-22.md) | existing projects, Claude Code primitives, and open standards for each core component of the Base version: adopt, adapt, or avoid (Agent SDK usage and hooks, sandbox-runtime, ccusage, Backlog.md, A2A, DBOS, OTel GenAI, MCP manifests) | 2026-10-22 |
| [provider-context-and-caching.md](provider-context-and-caching.md) | how context windows, prompt caching, and thinking tokens work at Claude, OpenAI, and Gemini, and the rules for `system` | 2026-10-22 |
| [statistics-tooling-2026-10-23.md](statistics-tooling-2026-10-23.md) | statistics and experiment tooling for the feedback loop (SciPy, statsmodels, GrowthBook `gbstats`, MLflow, Optuna, Ax/BoTorch, PyMC): what PROP-0011's F2 reuses and builds | 2026-10-23 |
| [model-routing.md](model-routing.md) | cost and value of each algorithm-development step by tier and Worker family, the cause of the fix rate, an A/B design for self-review, ranked recommendations; the per-step store pull it still needs | 2026-10-28 |
| [lean-core-2026-11-01.md](lean-core-2026-11-01.md) | where a task's time, tokens and the operator's attention go (live store, one week), the ledger's double count of resumed sessions, the gate ending a quarter of agent runs, what is used, the SDK and review evidence, the options four System runs chose for PROP-0022 | 2026-11-01 |
| [token-use-2026-11-02.md](token-use-2026-11-02.md) | where an accepted task's Claude tokens go (live store, one week, each session counted once): cost by step and tier, sessions re-read on every resume, prompt sizes, who does the work, and the System brainstorm on Worker roles for PROP-0023 | 2026-11-02 |

Research that no open proposal cites is deleted. Git keeps it.
