---
"@tsuuanmi/system-schemas": minor
"@tsuuanmi/system-resources-core": minor
"@tsuuanmi/system-resources": minor
"@tsuuanmi/system-ledger-core": minor
"@tsuuanmi/system-store": minor
"@tsuuanmi/system-agent-runtime-core": minor
"@tsuuanmi/system-runtime-claude-agent-sdk": patch
"@tsuuanmi/system-agent-workers": patch
---

The ledger counts a resumed session's spend once (PROP-0022 change 2, T361).

- Why: a Claude Agent SDK result on a resumed session reports the session's running totals, and `meteringFrom` recorded them as the run's own spend, so `resources` summed them again (the week of 2026-10-25 read 8,176 USD where the sessions grew 2,094).
- `usage-record@1.2` (additive): `sessionTotals` (given by a source: the numbers are the session's running totals), `includesUnrecorded` and `notDifferenced` (set by the ledger). `RunMetering.sessionTotals` carries it from the runtime; the agents source writes it, and a run the host's stop cut whose result carries it is counted whole.
- The ledger counts a run's own spend: the result minus the session's latest result already in the ledger, less the session's lower bounds counted since (by its agent session or its own run), the first from zero, so as it is unless a run of the session ended before it with no result; `includesUnrecorded` when a run of the session ended with no result (a lower bound, or a `usage.unknown` fact of the session); the full result, `notDifferenced`, when a counter would go negative. The original stays in `resource_usage.record`.
- `resources` store migration 2 recomputes the stored records from their originals, one row at a time, idempotently. `Migration` gains an optional `run` step in the same transaction.
- A conformance scenario (`resources.resumed-session-own-spend`, contract 1.3) holds every provider to it; `FakeResources` passes it.
