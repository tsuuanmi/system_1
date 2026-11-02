/**
 * A run's own spend in the ledger's table (docs/design/resources.md#counting): the counted columns of
 * a session's result hold its difference from the session's latest result, `own` holds the record as
 * it is read, and `record` keeps the original as the source gave it. One rule for a record as it is
 * counted and for the migration that recomputes the stored ones.
 */
import type { DatabaseSync } from 'node:sqlite'
import { ownSpend, type UsageRecord } from '@tsuuanmi/system-resources-core'

/** Lower bounds of a session one difference takes from its result, at most (INV-9). */
const MAX_LOWER_BOUNDS = 100
/**
 * SQL: the stored record (of the table `alias`, with its dot) is a whole count, not a lower bound
 * (`usage-record@1.1`'s `partial`), as it is read: a session's result (`own`) is whole, even one stored
 * before `sessionTotals` whose original says `partial` (a run that ran again after the host's stop).
 */
export const whole = (alias = ''): string => `json_extract(COALESCE(${alias}own, ${alias}record), '$.partial') IS NULL`

/**
 * Whether a run of agent session `sessionId` ended with no result between two instants (ms), as a
 * `usage.unknown` fact of the session says: a run with no record at all is seen only there.
 */
export type UnrecordedFacts = (sessionId: string, sinceMs: number, untilMs: number) => boolean

/**
 * The `partial` the agents source gave, before `sessionTotals` existed, to a run the host's stop cut
 * and that ran again (T283), and nothing else: its numbers were its runtime's result, so the session's
 * running totals when its id names that result. A stopped run's streamed lower bound says more.
 */
const AGAIN_ONLY = /^it ran again after the host's stop cut it \(\d+ time\(s\)\): this counts only what it used since; what it used before the stop is left to transcript reconciliation$/

/**
 * The runtime session a record is a result of: its `sessionTotals`; a lower bound (`partial`) is
 * never a result. A record stored before `sessionTotals` existed (`legacy`) is read by the rule the
 * live path now follows (agents source, PROP-0022): it names its session in its id, as the agents source
 * names a runtime's result `<runtime>:<resultId>`, and the one runtime whose results are running totals
 * gives `resultId` `<session>:<uuid>`. No other id of that source has that form: `<runtime>:<run>`, and
 * `<runtime>:<run>:again-<n>` (a run that ran again without a result id), which is never a result. Such a
 * result is one whether or not its run had an agent session, and also when its only `partial` is the one
 * a run that ran again after the host's stop got ({@link AGAIN_ONLY}): those numbers are the session's
 * running totals too, which the live path now counts whole.
 */
export function totalsSession(record: UsageRecord, legacy = false): string | undefined {
  if (!legacy || record.sessionTotals !== undefined) return record.partial === undefined ? record.sessionTotals : undefined
  if (record.source !== 'runtime-result') return undefined
  if (record.partial !== undefined && !AGAIN_ONLY.test(record.partial)) return undefined
  const id = /^[^:]+:([^:]+):([^:]+)$/.exec(record.requestId)
  return id && !/^again-\d+$/.test(id[2]!) ? id[1] : undefined
}

/**
 * The record `usage` counts as when it is a session's result (`session`), from the rows counted
 * before `beforeSeq`: the session's latest result, and what its agent session had since its own
 * latest result (of any runtime session), or since it began when it has none, the first result too:
 * its lower bounds (`partial`), with those of the result's own run (a run the host's stop cut, then
 * resumed, may have no agent session), and whether a run of it ended with no record (`facts`).
 */
export function ownOf(db: DatabaseSync, usage: UsageRecord, session: string, beforeSeq: number, facts?: UnrecordedFacts): UsageRecord {
  type Row = { seq: number; observed_ms: number; record: string }
  const latest = db.prepare('SELECT seq, observed_ms, record FROM resource_usage WHERE totals_session = ? AND seq < ? ORDER BY seq DESC LIMIT 1').get(session, beforeSeq) as Row | undefined
  const since = usage.sessionId === undefined ? latest
    : db.prepare('SELECT seq, observed_ms FROM resource_usage WHERE session_id = ? AND totals_session IS NOT NULL AND seq < ? ORDER BY seq DESC LIMIT 1').get(usage.sessionId, beforeSeq) as Row | undefined
  const lowerBounds = (db.prepare(`SELECT record FROM resource_usage WHERE (session_id = ? OR run_id = ?) AND seq > ? AND seq < ? AND NOT ${whole()} ORDER BY seq LIMIT ${MAX_LOWER_BOUNDS}`)
    .all(usage.sessionId ?? null, usage.runId ?? null, since?.seq ?? 0, beforeSeq) as Array<{ record: string }>).map((r) => JSON.parse(r.record) as UsageRecord)
  const unrecorded = usage.sessionId !== undefined && !!facts?.(usage.sessionId, since?.observed_ms ?? 0, Date.parse(usage.observedAt))
  return ownSpend(usage, latest ? JSON.parse(latest.record) as UsageRecord : undefined, { lowerBounds, unrecorded })
}

/** The counted columns of a record, in their order in `resource_usage`. */
export const countedOf = (r: UsageRecord): Array<number | null> => [
  r.usage?.inputTokens ?? null, r.usage?.outputTokens ?? null, r.usage?.cacheReadInputTokens ?? null, r.usage?.cacheCreationInputTokens ?? null,
  r.usage?.reasoningOutputTokens ?? null, r.turns ?? null, r.cost?.amount ?? null,
]

/**
 * Recompute every stored record's own spend from the original in `record`, in the order counted
 * (store migration 2 of `resources`): each row is read one at a time (INV-9), and only `record` is
 * read of a row's own, so running it again changes nothing. A record that is no session's result is
 * counted as given.
 */
export function recomputeOwnSpend(db: DatabaseSync, facts?: UnrecordedFacts): void {
  const update = db.prepare(`UPDATE resource_usage SET session_id = ?, totals_session = ?, own = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?,
    cache_creation_tokens = ?, reasoning_tokens = ?, turns = ?, cost_usd = ? WHERE seq = ?`)
  const last = (db.prepare('SELECT MAX(seq) AS seq FROM resource_usage').get() as { seq: number | null }).seq ?? 0
  const next = db.prepare('SELECT seq, record FROM resource_usage WHERE seq > ? ORDER BY seq LIMIT 1')
  for (let row = next.get(0) as { seq: number; record: string } | undefined; row && row.seq <= last; row = next.get(row.seq) as typeof row) {
    const original = JSON.parse(row.record) as UsageRecord
    const session = totalsSession(original, true)
    // A session's result is read whole, as the live path records it: a stored run that ran again keeps its `partial` in `record` only.
    const { partial: _again, ...result } = original
    const own = session === undefined ? undefined : ownOf(db, { ...result, sessionTotals: session }, session, row.seq, facts)
    update.run(original.sessionId ?? null, session ?? null, own ? JSON.stringify(own) : null, ...countedOf(own ?? original), row.seq)
  }
}
