import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack } from './stack.ts'
import { TEST_TEMPLATES } from './templates.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: a result its acceptance contract rejects', () => {
  it('fails the run when a result is rejected by its acceptance contract, and never runs the next node (REQ-WRK-3, INV-3)', async () => {
    // A deployment that requires cited reports.
    const cited = TEST_TEMPLATES['deep-research']!.map((node) => ({ ...node, acceptance: 'acceptance.cited' }))
    const { ctx, fake } = await boot({ fake: { report: 'A report without any source.' }, workflow: { templates: { 'deep-research': cited } } })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'deep-research', input: 'q' }).runId, 60_000)
    expect(done).toMatchObject({ status: 'failed', error: { kind: 'acceptance_rejected', disposition: 'NONE' } })
    expect(done.nodes.map((n) => n.state)).toEqual(['FAILED', 'WAITING'])
    expect(fake.sent).toHaveLength(1)
  }, 90_000)
})
