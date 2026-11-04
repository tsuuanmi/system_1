---
"@tsuuanmi/system-ui-ops": patch
"@tsuuanmi/system-digest": patch
"@tsuuanmi/system-egress": patch
"@tsuuanmi/system-provider-chatgpt-web": patch
"@tsuuanmi/system-provider-gemini-web": patch
"@tsuuanmi/system-runtime-claude-agent-sdk": patch
"@tsuuanmi/system-turns": patch
"@tsuuanmi/system-workflow": patch
---

Clean-up (operator's decision, 2026-11-04): unused code removed.
- `feedback-core` (the parked `experiments` and `evaluations` seam definitions and the statistics library) is deleted, with its SciPy goldens script. Nothing imported it, and no bundle row mounted it. The seam catalog lists both seams as planned.
- The never-run helpers `scripts/experiments/workflow-eval.ts` and `scripts/experiments/worker-agnosticism.ts` are deleted, with their experiments' pages and records. So is `scripts/live-auto-update.sh` (no timer ran it; the live install is updated by hand with `scripts/live-update.sh --stage`).
- Ten unused dependency declarations are dropped: packages that reached `display-virtual`, `egress`, `mcp-server`, `provider-core`, `agent-runtimes`, or `patchright-core` only through another package's test helper.
