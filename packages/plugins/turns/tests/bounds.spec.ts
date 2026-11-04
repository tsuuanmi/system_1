import { describe, expect, it, onTestFinished } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { ask, turnsStack } from './stack.ts'

const { boot } = turnsStack()

describe.runIf(canRunBrowser)('ctx.turns: within its bounds, and as the runtime stops', () => {
  it('bounds the turns it accepts (INV-9): beyond the limit it refuses with a back-off failure', async () => {
    const { ctx } = await boot({ fake: { thinkMs: 3000 }, turns: { maxPendingTurns: 1 } })
    const first = await ask(ctx, { prompt: 'one' })
    await expect(ask(ctx, { prompt: 'two' })).rejects.toMatchObject({ kind: 'overloaded', disposition: 'BACKOFF' })
    await ctx.turns.wait(first.turnId, 30_000)
    await ask(ctx, { prompt: 'three' })
  }, 90_000)

  it('never leaves a failure it cannot record unhandled: with its lease taken, the turn is looked at again, not overwritten (INV-4)', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    onTestFinished(() => void process.off('unhandledRejection', onUnhandled))
    const { ctx } = await boot({ fake: { thinkMs: 30_000, answer: 'late' } })
    const turn = await ask(ctx, { prompt: 'slow' })
    for (let t = Date.now(); ctx.turns.get(turn.turnId)?.status !== 'running' && Date.now() - t < 30_000;) await new Promise((resolve) => setTimeout(resolve, 100))
    // Another process took the turn (its lease moved on): this process may no longer write it.
    ctx.leases.invalidate(`turn:${turn.turnId}`)
    expect(ctx.turns.cancel(turn.turnId)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(unhandled).toEqual([])
    expect(ctx.turns.get(turn.turnId)?.status).toBe('running')
  }, 90_000)
})
