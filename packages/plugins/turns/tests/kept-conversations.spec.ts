import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { ask, liveChecked, turnsStack } from './stack.ts'

const { boot } = turnsStack()

describe.runIf(canRunBrowser)('ctx.turns: a released conversation kept, or failing to delete (PROP-0004 Phase 5)', () => {
  it('fails closed on a driver that cannot say its delete flow is checked, and keeps a conversation no driver can delete', async () => {
    const { ctx, fake } = await boot()
    liveChecked(ctx)
    const driver = ctx.providers.get('chatgpt-web') as unknown as Record<string, unknown>
    const turn = await ctx.turns.wait((await ask(ctx, { prompt: 'unchecked', persist: true })).turnId, 30_000)
    const method = driver.deletionUnverified
    // An own property hides the prototype's method, as a driver without it would.
    driver.deletionUnverified = undefined
    ctx.turns.release([turn.sessionId!], 'run run_e deleted')
    await ctx.turns.deleteConversations()
    expect(ctx.turns.conversations({ sessionId: turn.sessionId! })[0]).toMatchObject({ state: 'due', reason: expect.stringMatching(/^unverified-map: \(the driver does not report its delete flow as checked\)/) })
    driver.deletionUnverified = method
    driver.deleteConversation = undefined
    await ctx.turns.deleteConversations()
    expect(ctx.turns.conversations({ sessionId: turn.sessionId! })[0]).toMatchObject({ state: 'kept', reason: 'chatgpt-web cannot delete a conversation' })
    expect(fake.deleteRequests).toEqual([])
  }, 120_000)
})
