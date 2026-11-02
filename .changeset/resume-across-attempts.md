---
"@tsuuanmi/system-workflow": minor
---

`workflow.resumeAcrossAttempts` (default true, as before): off, a board task's next attempt starts a fresh session from its brief and the task's dossier instead of resuming the previous attempt's session, recorded as the `workflow.task-session` decision's `fresh` with that reason (T369, PROP-0022 change 4).
