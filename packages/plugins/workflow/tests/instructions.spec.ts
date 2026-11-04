import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Artifacts from '@tsuuanmi/system-artifacts'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CONFIG, ScriptedWorkers } from '../conformance/workflow.ts'
import Workflow, { type NodeTemplate, type RunView } from '../src/index.ts'

// A step's instructions (docs/design/workflow-engine.md#briefs): the engine fills every placeholder
// of a template's text, or no Worker starts (INV-2); text it never expands is data, sent as it is.
vi.setConfig({ testTimeout: 60_000 })

const step = (nodeId: string, extra: Partial<NodeTemplate> = {}): NodeTemplate => ({
  nodeId, objective: `Do ${nodeId}`, prompt: '{{input}}', capabilities: ['reason'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', ...extra,
})
const CHAIN = [step('a', { prompt: 'A: {{input}}' }), step('b', { prompt: 'B: {{node:a}}', dependsOn: ['a'] })]

/** The engine over scripted Workers, with `templates` configured. */
async function boot(templates: Record<string, NodeTemplate[]>): Promise<{ ctx: Context; workers: ScriptedWorkers }> {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-instructions-'))
  const ctx = new Context()
  const workers = new ScriptedWorkers()
  const fibers = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => void c.workers.register(workers.source(c)) }),
    ctx.plugin(Workflow, { ...CONFIG, templates }),
  ]
  await Promise.all(fibers)
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  return { ctx, workers }
}

const until = <T>(read: () => T | undefined, what: string, ms = 30_000): Promise<T> => vi.waitFor(() => {
  const value = read()
  if (!value) throw new Error(`timed out waiting for ${what}`)
  return value
}, { timeout: ms, interval: 25 })

const finished = (ctx: Context, runId: string): Promise<RunView> => until(() => {
  const view = ctx.workflow.get(runId)
  return view && view.status !== 'running' ? view : undefined
}, `run ${runId} to finish`)



describe('a step\'s instructions (INV-2)', () => {
  it('refuses a template whose text holds a placeholder the engine does not fill, at load and on the profiles seam, before any Worker starts', async () => {
    const { ctx, workers } = await boot({ chain: CHAIN, typo: [step('ask:1', { prompt: 'Answer {{inptu}}' })], spaced: [step('a', { prompt: 'Answer {{ input }}' })] })
    expect(ctx.workflow.refusedTemplates()).toEqual(expect.arrayContaining([
      { name: 'typo', reason: 'node ask:1 uses {{inptu}}, which is not a placeholder the engine fills: a prompt may use {{input}}, {{node:<id>}} of a node it depends on, and {{grown}} after a planner' },
      { name: 'spaced', reason: expect.stringMatching(/^node a uses \{\{ input \}\}, which is not a placeholder/) },
    ]))
    expect(() => ctx.workflow.start({ template: 'typo', input: 'q', classification: 'public' })).toThrow(/was refused at load: node ask:1 uses \{\{inptu\}\}/)
    // A profile's template is checked the same way; a team's ballot prompt is the engine's own.
    expect(() => ctx.workflow.template('unclosed', [step('x', { prompt: 'Do {{input' })])).toThrow(/node x uses \{\{input…?, which is not a placeholder/)
    expect(() => ctx.workflow.template('teamless', [step('x', { prompt: '{{team}}' })])).toThrow(/node x uses \{\{team\}\}/)
    expect(ctx.workflow.templateNames()).not.toContain('unclosed')
    expect(workers.started).toEqual([])
    // The engine and every other template keep working.
    expect((await finished(ctx, ctx.workflow.start({ template: 'chain', input: 'q', classification: 'public' }).runId)).status).toBe('completed')
  })
})
