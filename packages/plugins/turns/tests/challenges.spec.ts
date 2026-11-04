import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { ask, notice, turnsStack } from './stack.ts'

const { bootBound } = turnsStack()

describe.runIf(canRunBrowser)('ctx.turns: a site\'s notice or check over a session-bound account\'s page waits for the operator (ADR-0030)', () => {
  it('fails a turn once at a terms notice over the input, with nothing sent: the account waits for the operator, and Save is refused while the notice shows (live 2026-10-17)', async () => {
    const { ctx, fake } = await bootBound()
    // Shown after Save, as the site showed it live.
    fake.options.termsNotice = true
    const message = notice
    const loads = fake.pageLoads.length
    const done = await ctx.turns.wait((await ask(ctx, { prompt: 'hello' })).turnId, 60_000)
    expect(done).toMatchObject({ status: 'failed', submitted: false, error: { kind: 'challenge', disposition: 'USER_ACTION', message } })
    expect(fake.sent).toEqual([])
    // One page, no retry on a new session.
    expect(fake.pageLoads.length - loads).toBe(1)
    expect((await ctx.accounts.get('gemini-main')).status).toBe('challenge')
    await expect(ctx.login.save('gemini-main')).rejects.toMatchObject({ kind: 'challenge', message })
  }, 180_000)
})
