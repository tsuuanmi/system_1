import type { TokenUsage, UsageRecord } from './index.ts'

const TOKEN_KEYS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'reasoningOutputTokens'] as const
type Model = NonNullable<UsageRecord['models']>[number]
/** Money at a millionth: a difference of decimal amounts is never 0.8600000000000003. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** `current - previous` in every token counter `current` has; undefined when any is negative. */
function tokensDifference(current: TokenUsage, previous: TokenUsage | undefined): TokenUsage | undefined {
  const out: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  for (const key of TOKEN_KEYS) {
    if (current[key] === undefined) continue
    const d = current[key] - (previous?.[key] ?? 0)
    if (d < 0) return undefined
    out[key] = d
  }
  return out
}

/** `usage` less what `counted` already counted, each counter floored at 0. */
function less(usage: TokenUsage, counted: readonly (TokenUsage | undefined)[]): TokenUsage {
  const out: TokenUsage = { ...usage }
  for (const key of TOKEN_KEYS) {
    if (out[key] === undefined) continue
    out[key] = Math.max(0, out[key] - counted.reduce((n, c) => n + (c?.[key] ?? 0), 0))
  }
  return out
}

/** The sum of the models' usage, in the counters `shape` has. */
function sumOf(models: readonly Model[], shape: TokenUsage): TokenUsage {
  const out: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  for (const key of TOKEN_KEYS) if (shape[key] !== undefined) out[key] = models.reduce((n, m) => n + (m.usage[key] ?? 0), 0)
  return out
}

/** What the ledger knows of a session since its latest result, as {@link ownSpend} reads it. */
export interface SessionSince {
  /** The lower bounds (`partial`) of the session the ledger counted since its latest result: their spend is in the next difference too. */
  lowerBounds: readonly UsageRecord[]
  /** A run of the session ended with no result since its latest result: a lower bound counted, or no record (its `usage-unknown` fact). */
  unrecorded: boolean
}

/**
 * A run's own spend (`usage-record@1.2`; docs/design/resources.md#counting): the record a result of a
 * session's running totals (`sessionTotals`) counts as. `current` is the result as its source gave
 * it; `previous` is the session's latest result already in the ledger, as it was given. Every counter
 * (tokens, per-model tokens and cost, turns, cost) is the result minus the previous one, less what the
 * lower bounds of the session counted since (each counter floored at 0), so the session is counted
 * once. The first result of a session (no `previous`) is so counted from zero: as it is, unless a run
 * of the session ended before it with no result, whose lower bounds are taken too; when any counter
 * of the difference would be negative (a session that started over), the record is the full result,
 * `notDifferenced`, never a negative or zero figure. `includesUnrecorded` says a run with no result is
 * in the difference. The record returned carries no `sessionTotals`.
 */
export function ownSpend(current: UsageRecord, previous: UsageRecord | undefined, since: SessionSince = { lowerBounds: [], unrecorded: false }): UsageRecord {
  const { sessionTotals: _totals, ...rest } = current
  const full: UsageRecord = { ...rest, schema: 'usage-record@1.2' }
  const own: UsageRecord = { ...full }
  const notDifferenced: UsageRecord = { ...full, notDifferenced: true }
  const counted = since.lowerBounds
  if (current.models) {
    // A model the previous result named and this one does not: the session started over.
    if ((previous?.models ?? []).some((p) => !current.models!.some((m) => m.model === p.model))) return notDifferenced
    const models: Model[] = []
    for (const m of current.models) {
      const before = previous?.models?.find((p) => p.model === m.model)
      const d = tokensDifference(m.usage, before?.usage)
      const cost = m.costUsd === undefined ? undefined : round6(m.costUsd - (before?.costUsd ?? 0))
      if (!d || (cost !== undefined && cost < 0)) return notDifferenced
      const lower = counted.map((r) => r.models?.find((x) => x.model === m.model))
      const spent = cost === undefined ? undefined : Math.max(0, round6(cost - lower.reduce((n, x) => n + (x?.costUsd ?? 0), 0)))
      models.push({ model: m.model, usage: less(d, lower.map((x) => x?.usage)), ...(spent !== undefined ? { costUsd: spent } : {}) })
    }
    own.models = models
  }
  // A lower bound counted without its split per model cannot be taken from each model: the record keeps the totals only.
  if (own.models && counted.some((r) => r.usage && !r.models)) delete own.models
  if (current.usage) {
    const d = tokensDifference(current.usage, previous?.usage)
    if (!d) return notDifferenced
    // With models, the totals are their sum (`usage-record`: each count of `usage` is the sum over `models`).
    own.usage = own.models ? sumOf(own.models, d) : less(d, counted.map((r) => r.usage))
  }
  if (current.turns !== undefined) {
    const d = current.turns - (previous?.turns ?? 0)
    if (d < 0) return notDifferenced
    own.turns = Math.max(0, d - counted.reduce((n, r) => n + (r.turns ?? 0), 0))
  }
  if (current.cost) {
    const d = round6(current.cost.amount - (previous?.cost?.amount ?? 0))
    if (d < 0) return notDifferenced
    own.cost = { ...current.cost, amount: Math.max(0, round6(d - counted.reduce((n, r) => n + (r.cost?.amount ?? 0), 0))) }
  }
  return since.unrecorded || counted.length ? { ...own, includesUnrecorded: true } : own
}
