---
"@tsuuanmi/system-board": minor
"@tsuuanmi/system-profile-software-development": minor
---

`board_propose_plan` (`mcp-board` 1.6) proposes a plan's tasks at once, every one or none: each item names a `key`, and its `dependsOn` names other items by key or the project's tasks by id; a cycle, a key named twice, an unknown dependency, or two items writing one subject is refused before anything is stored, and a retry under `clientRequestId` returns the tasks the first call proposed. The software-development profile adds the `decompose` template: one step that needs only `reason`, so a website Worker takes it first, splits a goal into small, independently testable tasks, and answers with that tool's input for the lead to file (PROP-0023 change 5).
