import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: where a member runs, what it may be sent, and what is refused before anything is sent', () => {

  it('refuses material too long for a member to read whole, before anything is sent', async () => {
    const { ctx, fake } = await boot({ fake: { answer: 'x' }, gemini: { answer: 'x' }, workflow: { repositories: { maxSourceChars: 2000 } } })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'review', input: 'Review this:\n' + 'line of the change\n'.repeat(200) }).runId, 60_000)
    expect(done).toMatchObject({ status: 'failed', error: { kind: 'invalid_input', message: expect.stringMatching(/over the 2000 a member takes/) } })
    expect(fake.sent).toEqual([])
  }, 90_000)

  it('refuses a repository on a host it may not read, before anything is sent', async () => {
    const { ctx, fake } = await boot({ fake: { answer: 'x' }, gemini: { answer: 'x' } })
    const run = ctx.workflow.start({ template: 'review', input: 'Is it safe?', repository: { url: 'https://gitlab.com/a/b' } })
    const done = await ctx.workflow.wait(run.runId, 60_000)
    expect(done).toMatchObject({ status: 'failed', error: { kind: 'invalid_input', message: expect.stringMatching(/not an allowed repository host/) } })
    expect(fake.sent).toEqual([])
    expect(() => ctx.workflow.start({ template: 'brainstorm', input: 'q', repository: { url: 'https://github.com/a/b' } })).toThrow('template brainstorm reads no repository')
  }, 90_000)
})
