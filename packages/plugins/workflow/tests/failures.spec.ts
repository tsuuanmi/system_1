import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: failures', () => {
  it('never resends a submitted prompt: a timeout after sending fails the node, without a retry (INV-4)', async () => {
    const { ctx, fake } = await boot({ fake: { thinkMs: 20_000 }, turns: { turnTimeoutMs: 4000, stallTimeoutMs: 3500 }, workflow: { retryDelayMs: 100 } })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'ask', input: 'slow' }).runId, 60_000)
    expect(done).toMatchObject({ status: 'failed', error: { disposition: 'USER_ACTION' } })
    expect(fake.sent).toHaveLength(1)
    const record = ctx.workflow.records(done.runId)[0]!
    expect(ctx.artifacts.get(record.lastDecision!)?.body).toMatchObject({ decisionType: 'recovery', outcome: { option: 'fail' } })
  }, 90_000)

  it('fails closed with USER_ACTION when no account is ready, and sends nothing', async () => {
    const { ctx, fake } = await boot({ ready: false })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'ask', input: 'nobody' }).runId, 30_000)
    expect(done).toMatchObject({ status: 'failed', error: { kind: 'reauth_required', disposition: 'USER_ACTION' } })
    expect(ctx.artifacts.get(ctx.workflow.records(done.runId)[0]!.lastDecision!)?.body).toMatchObject({ decisionType: 'recovery', inputs: [expect.any(String)] })
    expect(fake.sent).toEqual([])
  }, 60_000)

  it('keeps local-private work off website Workers (REQ-WRK-7, MVP exit criterion 3)', async () => {
    const { ctx, fake } = await boot()
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'ask', input: 'my notes', classification: 'local-private' }).runId, 30_000)
    expect(done).toMatchObject({ status: 'failed', error: { kind: 'egress_denied' } })
    expect(fake.sent).toEqual([])
  }, 60_000)
})
