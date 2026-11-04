import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: static DAGs on the single engine', () => {

  it('refuses a configured template that fails its check, alone: the engine and every other template keep working (INV-2)', async () => {
    const old = [{ nodeId: 'panel', objective: 'Answer as a panel', prompt: '{{input}}', capabilities: ['reason'], tier: 'standard', conversation: 'temporary',
      acceptance: 'acceptance.team-synthesis', team: { members: 2, rounds: 2, distinctAccounts: true, lead: {} } }]
    const { ctx } = await boot({ workflow: { templates: { 'panel-led': old } } })
    expect(ctx.workflow.refusedTemplates()).toEqual([{ name: 'panel-led', reason: expect.stringMatching(/^node panel: team must be \{kind: brainstorm \| review/) }])
    expect(ctx.workflow.templateNames()).toEqual(expect.arrayContaining(['ask', 'brainstorm', 'review']))
    expect(ctx.workflow.templateNames()).not.toContain('panel-led')
    // What a served template runs, step by step, for a person to read before a start; none for a refused one (T116).
    expect(ctx.workflow.templateSteps('panel-led')).toBeUndefined()
    expect(ctx.workflow.templateSteps('toString')).toBeUndefined()
    expect(ctx.workflow.templateSteps('ask')).toEqual([expect.objectContaining({ capabilities: expect.arrayContaining(['reason']), tier: expect.any(String) })])
    expect(ctx.workflow.templateSteps('brainstorm')!.find((s) => s.team)).toMatchObject({ team: { kind: 'brainstorm', members: expect.any(Number) } })
    expect(() => ctx.workflow.start({ template: 'panel-led', input: 'q' })).toThrow(/workflow template panel-led was refused at load: node panel: team must be/)
    expect((await ctx.workflow.wait(ctx.workflow.start({ template: 'ask', input: 'hi' }).runId, 60_000)).status).toBe('completed')
  }, 90_000)
})
