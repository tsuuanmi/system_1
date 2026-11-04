import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import type { RunView } from '../src/types.ts'
import { ballot, browserStack, isProposal, proposal, until } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: a team\'s tie, its debate, and the deciding vote', () => {

  it('keeps a tie through the operator\'s stop and continue, and through a supersede that splits the vote again; a late or misdirected vote is refused', async () => {
    const { ctx, gemini } = await boot({
      fake: { answer: (prompt) => (isProposal(prompt) ? proposal('Ship now') : ballot('O1', ['O2 delays the release'])) },
      gemini: { answer: (prompt) => (isProposal(prompt) ? proposal('Ship next week') : ballot('O2', ['O1 skips the tests'])) },
    })
    const run = ctx.workflow.start({ template: 'brainstorm', input: 'When do we ship?' })
    const tied = await ctx.workflow.wait(run.runId, 120_000)
    expect(tied.blocked).toMatchObject({ kind: 'tie' })
    // Stop, then continue: the decision is promoted again and blocks on the same tie; no Worker is asked.
    await ctx.workflow.stop(run.runId)
    // The tally and the decision are the engine's: no supersede.
    await expect(ctx.workflow.supersede(run.runId, 'brainstorm:tally:1', { text: 'x' })).rejects.toThrow('which the engine computes')
    const before = gemini!.sent.length
    ctx.workflow.continue(run.runId)
    await until(() => ctx.workflow.get(run.runId)!.blocked?.kind === 'tie', 30_000)
    expect(gemini!.sent).toHaveLength(before)
    // Supersede m1's first ballot: the tally runs again, and its new debate gets ids of a new generation.
    await ctx.workflow.stop(run.runId)
    await ctx.workflow.supersede(run.runId, 'brainstorm:m1:ballot:1', { text: ballot('O1', ['O2 still delays the release']) })
    await until(() => ctx.workflow.get(run.runId)!.blocked?.kind === 'tie', 120_000)
    const ids = ctx.workflow.get(run.runId)!.nodes.map((n) => `${n.nodeId} ${n.state}`)
    expect(ids).toEqual(expect.arrayContaining(['brainstorm:m1:debate:1 RETIRED', 'brainstorm:tally:2 RETIRED', 'brainstorm:m1:debate:1:g2 COMPLETED', 'brainstorm:tally:2:g2 COMPLETED', 'brainstorm BLOCKED']))
    // A vote after the deadline ends the tie by rule and is refused.
    const tie = ctx.workflow.get(run.runId)!.blocked as Extract<RunView['blocked'], { kind: 'tie' }>
    ctx.store.db.prepare("UPDATE workflow_nodes SET not_before = '2000-01-01T00:00:00.000Z' WHERE run_id = ? AND node_id = 'brainstorm'").run(run.runId)
    expect(() => ctx.workflow.vote(run.runId, { decision: tie.decision, option: 'O1', rationale: 'late', by: 'client' })).toThrow('it has ended inconclusive')
    await until(() => ctx.workflow.get(run.runId)!.status === 'completed', 30_000)
    expect(ctx.workflow.get(run.runId)!.answer).toMatch(/^outcome: inconclusive; method: inconclusive;/)
  }, 300_000)
})
