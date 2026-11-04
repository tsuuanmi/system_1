import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: explain, and MCP', () => {
  it('explains a run: egress, tier, route, and acceptance for every node (REQ-ART-3)', async () => {
    const { ctx } = await boot()
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'deep-research', input: 'why' }).runId, 60_000)
    const explained = ctx.workflow.explain(done.runId)!
    expect(explained.nodes.map((n) => [n.nodeId, n.decisions.map((d) => [d.type, d.outcome])])).toEqual([
      ['research:1', [['egress', 'allow'], ['tier', 'frontier'], ['route', 'worker:chatgpt-main/frontier'], ['acceptance', 'accept']]],
      ['compact:1', [['egress', 'allow'], ['tier', 'economy'], ['route', 'worker:chatgpt-main/economy'], ['acceptance', 'accept']]],
    ])
    expect(explained.nodes[1]!.decisions[3]!.reasons).toEqual(['the answer has text'])
    // Runs outlive their turns: the chain survives the turn runtime's retention.
    ctx.store.db.prepare('DELETE FROM turns').run()
    expect(ctx.workflow.explain(done.runId)!.nodes.map((n) => n.decisions.length)).toEqual([4, 4])
  }, 90_000)
})
