import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack, until } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: the operator stops a run or supersedes a result', () => {
  it('lets the operator stop a run: running work is cancelled, nothing else starts, nothing is resent (REQ-WF-7)', async () => {
    const { ctx, fake } = await boot({ fake: { thinkMs: 20_000 } })
    const run = ctx.workflow.start({ template: 'deep-research', input: 'long one' })
    await until(() => ctx.workflow.get(run.runId)?.nodes[0]?.state === 'RUNNING' && fake.sent.length === 1)
    const stopped = await ctx.workflow.stop(run.runId, 'not needed any more')
    expect(stopped).toMatchObject({ status: 'failed', error: { kind: 'stopped', disposition: 'NONE' } })
    expect(stopped.nodes.map((n) => n.state)).toEqual(['FAILED', 'FAILED'])
    const turn = await ctx.turns.wait(stopped.nodes[0]!.executionId!, 10_000)
    expect(turn).toMatchObject({ status: 'failed', error: { kind: 'aborted' } })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(fake.sent).toHaveLength(1)
    await expect(ctx.workflow.stop(run.runId)).rejects.toThrow(/not running/)
  }, 90_000)
})
