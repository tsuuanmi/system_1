import { AdmissionFailure } from '@tsuuanmi/system-workers'
import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { ask, turnsStack } from './stack.ts'

const { boot } = turnsStack()

describe.runIf(canRunBrowser)('ctx.turns: ask through a saved account', () => {

  it('checks egress before sending: credentials or local-private content never leave (INV-12)', async () => {
    const { ctx, fake } = await boot()
    const pem = String((await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }))
    const leaked = await ctx.turns.wait((await ask(ctx, { prompt: `why does this key fail?\n${pem}` })).turnId, 30_000)
    expect(leaked).toMatchObject({ status: 'failed', error: { kind: 'egress_denied', disposition: 'USER_ACTION' } })
    // Routing keeps local-private work off remote Workers; the turn's own egress check holds even if a caller skipped that.
    await expect(ask(ctx, { prompt: 'my notes', classification: 'local-private' })).rejects.toBeInstanceOf(AdmissionFailure)
    const admitted = await ask(ctx, { prompt: 'warm-up', classification: 'public' })
    const turn = await ctx.turns.wait(admitted.turnId, 30_000)
    const bypass = ctx.turns.ask({
      key: 'bypass', worker: turn.worker!, prompt: 'my notes', decisions: { tier: turn.tierDecision!, route: turn.routeDecision! },
      requirement: { schema: 'work-requirement@1.0', objective: 'test', egressPolicy: 'egress.classification-and-secrets', capabilities: ['reason'],
        data: { classification: 'local-private', refs: [] }, tier: { min: 'standard', source: 'caller' }, acceptance: { contract: 'acceptance.answer' } },
    })
    expect(await ctx.turns.wait(bypass.turnId, 30_000)).toMatchObject({ status: 'failed', error: { kind: 'egress_denied' } })
    expect(fake.sent.map((s) => s.prompt)).toEqual(['warm-up'])
    const fine = await ctx.turns.wait((await ask(ctx, { prompt: 'public question' })).turnId, 30_000)
    expect(fine.status).toBe('completed')
    expect(ctx.artifacts.get(fine.egressDecision!)?.body).toMatchObject({ decisionType: 'egress', outcome: { option: 'allow' } })
  }, 90_000)
})
