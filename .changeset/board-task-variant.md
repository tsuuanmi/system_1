---
"@tsuuanmi/system-board-core": minor
"@tsuuanmi/system-board": minor
"@tsuuanmi/system-workflow": minor
---

A board task may name a template `variant` (`board-task@1.5`, `mcp-board` 1.7, on `board_propose` and each item of `board_propose_plan`; it needs `template`). Dispatch resolves the task's writing step in that variant, so its kind of work chooses the Worker (a `docs` or `tests` task goes to the Workers given that kind), and starts the run in it; a start that names another variant, or none, is refused. A record with a variant keeps `@1.4` through its later moves (PROP-0023 change 1).
