---
"@tsuuanmi/system-agent-runtime-core": minor
"@tsuuanmi/system-agent-workers": minor
"@tsuuanmi/system-approvals": minor
"@tsuuanmi/system-approvals-core": minor
"@tsuuanmi/system-libs": minor
"@tsuuanmi/system-runtime-claude-agent-sdk": minor
---

The autonomy policy can allow a sandboxed Bash call it does not forbid or ask for (PROP-0022 1b, ADR-0080, proposed). A quarter of agent runs ended on a Bash call that waited on the operator.
- `autonomy-policy@1.7` adds `sandboxedCommands`: `forbid` and `ask` command shapes (a program, the words after it, an `anyWord` pattern). In a `workspace-write` run whose runtime proved both confinements, a Bash call that no commands-list line, command rule, or shape names is `auto`. The order is forbid, ask, the rule, the class default. A call asking to run unsandboxed is never allowed, and a `forbid` of the `command` class still forbids. Each allowed call is an `autonomy` decision naming the rule.
- Only the studio policy grants the rule; a project policy only adds `forbid` and `ask` shapes.
- A new switch, `agent-workers.enforce.sandboxedCommands` (`off`, `warn`, `on`; default `warn`). `warn` records a `gate` decision with the verdict the rule would give, and the call still asks. `off` ignores the rule.
- The Claude Code runtime reports `sandboxedCommands` when its command probe proved the sandbox. A Codex Worker reports none and is unchanged.
- The shipped and live policy's rules are not changed: adding the rule and turning the switch `on` are the operator's decisions (D114).
