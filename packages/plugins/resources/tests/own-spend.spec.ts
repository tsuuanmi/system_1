// A run's own spend (PROP-0022 change 2): a result that reports a session's running totals is
// counted as its difference from the session's latest result already in the ledger, so the
// ledger's totals of a session are its last result's, counted once.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Artifacts from '@tsuuanmi/system-artifacts'
import EventLog from '@tsuuanmi/system-event-log'
import type { PoolConfig, UsageRecord } from '@tsuuanmi/system-resources-core'
import Store from '@tsuuanmi/system-store'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import StoreResources, { MIGRATION_1, recomputeOwnSpend } from '../src/index.ts'

const POOLS: PoolConfig[] = [{ pool: 'a.programmatic', account: 'a', kind: 'programmatic', windows: [{ id: 'monthly', kind: 'credit' }] }]
const T0 = new Date('2026-10-22T09:00:00Z')
const at = (minutes: number): string => new Date(T0.getTime() + minutes * 60_000).toISOString()

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'system-own-spend-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function open(dir: string, before?: (ctx: Context) => void) {
  const ctx = new Context()
  const fibers = [ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {})]
  await Promise.all(fibers)
  before?.(ctx)
  fibers.push(ctx.plugin(StoreResources, { pools: structuredClone(POOLS) }))
  await fibers.at(-1)
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  return ctx
}

/** A result of runtime session `s1` (agent session `sess-1`): the session's running totals at that result. */
const result = (n: number, cost: number, input: number, extra: Partial<UsageRecord> = {}): UsageRecord => ({
  schema: 'usage-record@1.2', requestId: `claude:s1:u${n}`, source: 'runtime-result', observedAt: at(n), account: 'a', pool: 'a.programmatic',
  runId: `r${n}`, sessionId: 'sess-1', sessionTotals: 's1', usage: { inputTokens: input, outputTokens: input / 10 }, turns: n, cost: { amount: cost, currency: 'USD', basis: 'runtime-estimate' }, ...extra,
})
/** The lower bound of run `r<n>` of the session, stopped before its result. */
const lowerBound = (n: number, input: number, cost: number): UsageRecord => ({
  schema: 'usage-record@1.1', requestId: `claude:r${n}`, source: 'runtime-result', observedAt: at(n), account: 'a', pool: 'a.programmatic',
  runId: `r${n}`, sessionId: 'sess-1', usage: { inputTokens: input, outputTokens: 1 }, cost: { amount: cost, currency: 'USD', basis: 'runtime-estimate' }, partial: 'stopped before its result',
})

describe('a resumed session\'s results', () => {
  it('records 4.49, 0.86, 1.07 and the token differences for three successive results (delta)', async () => {
    const ctx = await open(tempDir())
    for (const r of [result(1, 4.49, 1000), result(2, 5.35, 2500), result(3, 6.42, 4000)]) await ctx.resources.record(r)
    const { records, totals } = await ctx.resources.usage()
    expect(records.map((r) => r.cost?.amount)).toEqual([4.49, 0.86, 1.07])
    expect(records.map((r) => r.usage?.inputTokens)).toEqual([1000, 1500, 1500])
    expect(records.map((r) => r.usage?.outputTokens)).toEqual([100, 150, 150])
    expect(records.map((r) => r.turns)).toEqual([1, 1, 1])
    // The session counted once: its last result's totals.
    expect(totals).toMatchObject([{ costUsd: 6.42, usage: { inputTokens: 4000, outputTokens: 400 }, turns: 3 }])
  })

  it('records the first result of a session as it is, with no flag', async () => {
    const ctx = await open(tempDir())
    await ctx.resources.record(result(1, 4.49, 1000))
    const [first] = (await ctx.resources.usage()).records
    expect(first).toMatchObject({ schema: 'usage-record@1.2', cost: { amount: 4.49 }, usage: { inputTokens: 1000 }, turns: 1 })
    expect(first).not.toHaveProperty('sessionTotals')
    expect(first).not.toHaveProperty('includesUnrecorded')
    expect(first).not.toHaveProperty('notDifferenced')
  })

  it('says includesUnrecorded when a run of the session counted only a lower bound before the next result, and counts the session once', async () => {
    const ctx = await open(tempDir())
    await ctx.resources.record(result(1, 4.49, 1000))
    await ctx.resources.record(lowerBound(2, 10, 0.03))
    await ctx.resources.record(result(3, 6.42, 4000))
    const { records, totals } = await ctx.resources.usage()
    // The difference less what the lower bound already counted.
    expect(records[2]).toMatchObject({ cost: { amount: 1.9 }, usage: { inputTokens: 2990, outputTokens: 299 }, includesUnrecorded: true })
    expect(records[0]).not.toHaveProperty('includesUnrecorded')
    expect(totals).toMatchObject([{ costUsd: 6.42, usage: { inputTokens: 4000, outputTokens: 400 } }])
  })

  it('takes a lower bound counted before the session\'s first result from that result, and says includesUnrecorded: the session totals its first result', async () => {
    const ctx = await open(tempDir())
    // The session's first run was stopped (a drain at the host's stop): only its lower bound is counted.
    await ctx.resources.record(lowerBound(1, 10, 0.03))
    await ctx.resources.record(result(2, 4.49, 1000))
    const { records, totals } = await ctx.resources.usage()
    expect(records[1]).toMatchObject({ cost: { amount: 4.46 }, usage: { inputTokens: 990, outputTokens: 99 }, turns: 2, includesUnrecorded: true })
    expect(totals).toMatchObject([{ costUsd: 4.49, usage: { inputTokens: 1000, outputTokens: 100 } }])
  })

  it('takes the lower bound of the same run, cut by the host\'s stop and resumed, from its first result even without an agent session', async () => {
    const ctx = await open(tempDir())
    const { sessionId: _a, ...cut } = lowerBound(1, 10, 0.03)
    const { sessionId: _b, ...resumed } = { ...result(2, 4.49, 1000), runId: 'r1' }
    await ctx.resources.record(cut)
    await ctx.resources.record(resumed)
    const { records, totals } = await ctx.resources.usage()
    expect(records[1]).toMatchObject({ cost: { amount: 4.46 }, usage: { inputTokens: 990 }, includesUnrecorded: true })
    expect(totals).toMatchObject([{ costUsd: 4.49, usage: { inputTokens: 1000 } }])
  })

  it('says includesUnrecorded on the session\'s first result when a run of it ended before with no record at all', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(new Date(at(1)))
    const ctx = await open(tempDir())
    ctx.eventLog.append({ type: 'usage.unknown', sessionId: 'sess-1', data: { schema: 'usage-unknown@1.0', runId: 'r1', kind: 'interrupted', account: 'a', pool: 'a.programmatic', sessionId: 'sess-1', observedAt: at(1), reason: 'the host stopped while it ran, so no result came' } })
    vi.setSystemTime(new Date(at(2)))
    await ctx.resources.record(result(2, 4.49, 1000))
    expect((await ctx.resources.usage()).records[0]).toMatchObject({ cost: { amount: 4.49 }, usage: { inputTokens: 1000 }, includesUnrecorded: true })
  })

  it('says includesUnrecorded when a run of the session ended with no record at all, as its usage.unknown fact says', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(new Date(at(1)))
    const ctx = await open(tempDir())
    await ctx.resources.record(result(1, 4.49, 1000))
    // A later run of the session reported nothing: no record, only its fact.
    vi.setSystemTime(new Date(at(2)))
    ctx.eventLog.append({ type: 'usage.unknown', sessionId: 'sess-1', data: { schema: 'usage-unknown@1.0', runId: 'r2', kind: 'interrupted', account: 'a', pool: 'a.programmatic', sessionId: 'sess-1', observedAt: at(2), reason: 'the host stopped while it ran, so no result came' } })
    // Another session's fact is that session's, not this one's or a third's.
    ctx.eventLog.append({ type: 'usage.unknown', sessionId: 'sess-9', data: { schema: 'usage-unknown@1.0', runId: 'r9', kind: 'interrupted', account: 'a', pool: 'a.programmatic', sessionId: 'sess-9', observedAt: at(2), reason: 'the host stopped while it ran, so no result came' } })
    vi.setSystemTime(new Date(at(3)))
    await ctx.resources.record(result(3, 6.42, 4000))
    await ctx.resources.record({ ...result(4, 1, 100), requestId: 'claude:s9:u4', sessionId: 'sess-9', sessionTotals: 's9' })
    await ctx.resources.record({ ...result(5, 1, 100), requestId: 'claude:s8:u5', sessionId: 'sess-8', sessionTotals: 's8' })
    const { records, totals } = await ctx.resources.usage()
    expect(records[1]).toMatchObject({ cost: { amount: 1.93 }, usage: { inputTokens: 3000 }, includesUnrecorded: true })
    expect(records[2]).toMatchObject({ cost: { amount: 1 }, includesUnrecorded: true })
    expect(records[3]).not.toHaveProperty('includesUnrecorded')
    expect(totals).toMatchObject([{ costUsd: 8.42, usage: { inputTokens: 4200 } }])
  })

  it('records the full result, flagged notDifferenced, when a counter went down', async () => {
    const ctx = await open(tempDir())
    await ctx.resources.record(result(1, 4.49, 5000))
    // Cost grew, input went down (a session that started over): never negative, never zero.
    await ctx.resources.record(result(2, 5.0, 800))
    const [, second] = (await ctx.resources.usage()).records
    expect(second).toMatchObject({ cost: { amount: 5 }, usage: { inputTokens: 800, outputTokens: 80 }, turns: 2, notDifferenced: true })
    // The next difference starts from that result.
    await ctx.resources.record(result(3, 5.5, 1000))
    expect((await ctx.resources.usage()).records[2]).toMatchObject({ cost: { amount: 0.5 }, usage: { inputTokens: 200 }, turns: 1 })
  })

  it('counts the results of a session that is not resumed (no running totals) as reported', async () => {
    const ctx = await open(tempDir())
    for (const n of [1, 2]) {
      const { sessionTotals: _totals, ...rest } = result(n, 2, 1000)
      await ctx.resources.record({ ...rest, schema: 'usage-record@1.0', requestId: `codex:r${n}` })
    }
    const { records, totals } = await ctx.resources.usage()
    expect(records.map((r) => r.cost?.amount)).toEqual([2, 2])
    expect(totals).toMatchObject([{ costUsd: 4, usage: { inputTokens: 2000 } }])
  })
})

describe('the migration', () => {
  /** Stored as the ledger stored it before this change: the counted columns are the originals'. */
  const legacy = (ctx: Context, record: UsageRecord, seq: number): void => {
    const u = record.usage
    ctx.store.db.prepare(`INSERT INTO resource_usage (seq, source, request_id, observed_ms, account, pool, run_id, input_tokens, output_tokens, turns, cost_usd, record, artifact, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sha256:x', ?)`).run(seq, record.source, record.requestId, Date.parse(record.observedAt), record.account, record.pool, record.runId ?? null,
      u?.inputTokens ?? null, u?.outputTokens ?? null, record.turns ?? null, record.cost?.amount ?? null, JSON.stringify(record), at(0))
  }
  const dump = (ctx: Context) => ctx.store.db.prepare('SELECT * FROM resource_usage ORDER BY seq').all()
  const asStored = (r: UsageRecord): UsageRecord => {
    const { sessionTotals: _totals, ...rest } = r
    return { ...rest, schema: r.partial ? 'usage-record@1.1' : 'usage-record@1.0' }
  }

  it('recomputes stored records from their originals, keeps the originals, and changes nothing the second time', async () => {
    // Another runtime's record, of no session: counted as given.
    const { sessionId: _session, ...other } = { ...result(5, 1, 100), requestId: 'codex:run_9' }
    const originals = [result(1, 4.49, 1000), result(2, 5.35, 2500), lowerBound(3, 10, 0.03), result(4, 6.42, 4000), other].map(asStored)
    // The store before the change: the first migration only, the numbers counted as the sources reported them.
    const ctx = await open(tempDir(), (c) => {
      c.store.migrate('resources', [MIGRATION_1])
      originals.forEach((r, i) => legacy(c, r, i + 1))
    })
    const stored = dump(ctx) as Array<{ cost_usd: number; input_tokens: number; record: string }>
    expect(stored.map((r) => r.cost_usd)).toEqual([4.49, 0.86, 0.03, 1.04, 1])
    expect(stored.map((r) => r.input_tokens)).toEqual([1000, 1500, 10, 1490, 100])
    // The originals stay in the record column.
    expect(stored.map((r) => JSON.parse(r.record))).toEqual(originals)
    const { records, totals } = await ctx.resources.usage()
    expect(records[3]).toMatchObject({ schema: 'usage-record@1.2', includesUnrecorded: true })
    expect(totals).toMatchObject([{ costUsd: 7.42, usage: { inputTokens: 4100 } }])
    // Idempotent: running it again changes nothing.
    const after = dump(ctx)
    ctx.store.transaction((db) => recomputeOwnSpend(db))
    expect(dump(ctx)).toEqual(after)
  })

  it('counts a stored run the host\'s stop cut and resumed, whose id names its session\'s result, as a whole result, as the live rule does; a streamed lower bound stays one', async () => {
    const AGAIN = 'it ran again after the host\'s stop cut it (1 time(s)): this counts only what it used since; what it used before the stop is left to transcript reconciliation'
    // As the agents source stored it before `sessionTotals`: the resumed run's result, marked partial, its id the runtime's result id.
    const { sessionId: _s, ...resumed } = { ...asStored(result(2, 5, 2500)), schema: 'usage-record@1.1' as const, partial: AGAIN }
    // A resumed run that ended before its result: what it streamed, under the run's own again id.
    const streamed: UsageRecord = { ...asStored(lowerBound(3, 10, 0.03)), requestId: 'claude:r3:again-1', partial: `stopped before its result; ${AGAIN}` }
    const originals = [asStored(result(1, 4, 1000)), resumed, streamed, asStored(result(4, 6, 4000))]
    const ctx = await open(tempDir(), (c) => {
      c.store.migrate('resources', [MIGRATION_1])
      originals.forEach((r, i) => legacy(c, r, i + 1))
    })
    const stored = dump(ctx) as Array<{ cost_usd: number; input_tokens: number; record: string }>
    expect(stored.map((r) => r.cost_usd)).toEqual([4, 1, 0.03, 0.97])
    expect(stored.map((r) => r.input_tokens)).toEqual([1000, 1500, 10, 1490])
    expect(stored.map((r) => JSON.parse(r.record))).toEqual(originals)
    const { records, totals } = await ctx.resources.usage()
    // Read as the whole result it is: no longer a lower bound, so its run is reconciled.
    expect(records[1]).toMatchObject({ schema: 'usage-record@1.2', cost: { amount: 1 } })
    expect(records[1]).not.toHaveProperty('partial')
    expect(records[2]).toMatchObject({ partial: expect.any(String) })
    expect(totals).toMatchObject([{ costUsd: 6, usage: { inputTokens: 4000 } }])
  })

  it('takes a lower bound stored before a session\'s first result from that result', async () => {
    const originals = [lowerBound(1, 10, 0.03), result(2, 4.49, 1000)].map(asStored)
    const ctx = await open(tempDir(), (c) => {
      c.store.migrate('resources', [MIGRATION_1])
      originals.forEach((r, i) => legacy(c, r, i + 1))
    })
    expect((dump(ctx) as Array<{ input_tokens: number }>).map((r) => r.input_tokens)).toEqual([10, 990])
    expect((await ctx.resources.usage()).records[1]).toMatchObject({ includesUnrecorded: true })
    expect((await ctx.resources.usage()).totals).toMatchObject([{ costUsd: 4.49, usage: { inputTokens: 1000 } }])
  })
})
