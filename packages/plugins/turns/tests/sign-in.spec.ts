import { contentId } from '@tsuuanmi/system-libs'
import { ProviderError } from '@tsuuanmi/system-provider-core'
import { AdmissionFailure, type WorkRequirement } from '@tsuuanmi/system-workers'
import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { account, ask, turnsStack } from './stack.ts'

const { boot } = turnsStack()

describe.runIf(canRunBrowser)('ctx.turns: an account\'s sign-in and its saved state', () => {

  it('takes every Worker of two accounts signed in as one person out of work, and sends nothing on a turn routed before (REQ-ACC-7)', async () => {
    const { ctx, fake } = await boot({ accounts: [account('chatgpt-main'), account('chatgpt-2')], ready: ['chatgpt-main', 'chatgpt-2'] })
    const statesOf = async (): Promise<string[]> => [...new Set((await ctx.workers.list()).map((w) => w.state))]
    expect(await statesOf()).toEqual(['ready'])
    const requirement: WorkRequirement = {
      schema: 'work-requirement@1.0', objective: 'x', capabilities: ['reason'], data: { classification: 'public', refs: [] }, egressPolicy: 'egress.classification-and-secrets',
      tier: { min: 'standard', source: 'default' }, acceptance: { contract: 'acceptance.answer' },
    }
    // Routed to chatgpt-main while the two were distinct; then chatgpt-2 is signed in as the same person.
    const admitted = await ctx.workers.route(requirement, { restrict: { workers: ['worker:chatgpt-main/standard'], reason: 'test' } })
    const saved = await ctx.accounts.get('chatgpt-2')
    await ctx.accounts.saveState('chatgpt-2', {
      state: { origins: [fake.origin], cookies: [], capturedAt: '2026-10-23T00:00:00Z' },
      identityHash: contentId({ provider: 'chatgpt-web', identity: `chatgpt-web:${fake.options.userId}` }), verifiedAt: '2026-10-23T00:00:00Z',
    }, saved.revision)
    expect(await ctx.accounts.duplicateIdentities()).toEqual([['chatgpt-main', 'chatgpt-2']])
    // Both entries, every tier: neither is a distinct account, and their status is untouched.
    expect(await statesOf()).toEqual(['unavailable'])
    expect((await ctx.accounts.list()).map((a) => a.status)).toEqual(['ready', 'ready'])
    await expect(ctx.workers.route(requirement)).rejects.toBeInstanceOf(AdmissionFailure)
    const started = ctx.turns.ask({ key: 'routed-before', worker: admitted.worker.worker, prompt: 'never sent', requirement, decisions: admitted.decisions })
    admitted.release()
    const turn = await ctx.turns.wait(started.turnId, 30_000)
    expect(turn).toMatchObject({ status: 'failed', submitted: false, error: { kind: 'reauth_required', disposition: 'USER_ACTION', message: expect.stringMatching(/chatgpt-main is signed in as the same person as chatgpt-2.*nothing was sent/) } })
    expect(fake.sent).toEqual([])
    // Signed in as another person, chatgpt-2 is a distinct account again, and both take work.
    await ctx.accounts.saveState('chatgpt-2', {
      state: { origins: [fake.origin], cookies: [], capturedAt: '2026-10-23T00:00:00Z' },
      identityHash: contentId({ provider: 'chatgpt-web', identity: 'chatgpt-web:someone-else' }), verifiedAt: '2026-10-23T00:00:00Z',
    })
    expect(await ctx.accounts.duplicateIdentities()).toEqual([])
    expect(await statesOf()).toEqual(['ready'])
  }, 90_000)

  it('signs in again only before anything was sent: a sign-out seen after the send fails the turn, never resent (INV-4)', async () => {
    const { ctx, fake } = await boot()
    await ctx.accounts.setCredentials('chatgpt-main', { email: fake.options.email, password: fake.options.password })
    // A driver that sends (its receipt is written), then finds itself signed out.
    const chatgpt = ctx.providers.get('chatgpt-web')
    let asks = 0
    const ask0 = chatgpt.ask.bind(chatgpt)
    chatgpt.ask = async (page, prompt, options) => {
      asks++
      await options.beforeSend?.({ previousResponse: null, mode: {} })
      throw new ProviderError('reauth_required', 'signed out after the send')
    }
    try {
      const turn = await ctx.turns.wait((await ask(ctx, { prompt: 'sent once' })).turnId, 60_000)
      expect(turn).toMatchObject({ status: 'failed', error: { kind: 'reauth_required' } })
      expect(asks).toBe(1)
    } finally {
      chatgpt.ask = ask0
    }
  }, 120_000)
})
