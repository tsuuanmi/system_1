---
"@tsuuanmi/system-resources": minor
"@tsuuanmi/system-board": minor
"@tsuuanmi/system-workflow": patch
---

A budget line on a name counts that pool and every pool named under it, `<template>/<account>` (ADR-0083): one line on a template's id caps a task whichever account serves it, and a line with no pool of its own is available while one pool under it is. The board's `defaultBudget` gives a task whose proposal names no budget its lines (empty by default, so nothing changes until it is set). A task's start checks its budget the same way (PROP-0023 change 3).
