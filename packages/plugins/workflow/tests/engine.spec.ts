import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Artifacts from '@tsuuanmi/system-artifacts'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import type { ModelEntry } from '@tsuuanmi/system-models-core'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { FakeModels, type FakeScript } from '../../../models-core/conformance/models.ts'
import { ModelWorkers } from '../../models/src/index.ts'
import Workflow from '../src/index.ts'
import type { RunView } from '../src/types.ts'
import { TEST_TEMPLATES } from './templates.ts'

const CATALOG: ModelEntry[] = [{ id: 'fast', tier: 'standard', quotaClass: 'metered', locality: 'remote', maxTokens: 64 }]

/**
 * The engine over a fake model Worker: no browser, so faults are injected deterministically. On
 * `dir`, another boot's store: a restart. `stop` stops it, once (the test's end stops it otherwise).
 */
async function boot(script: FakeScript = {}, workflow: Record<string, unknown> = {}, catalog: ModelEntry[] = CATALOG, dir = mkdtempSync(join(tmpdir(), 'system-engine-'))) {
  const ctx = new Context()
  const fibers = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(FakeModels, { catalog, script }),
    ctx.plugin(ModelWorkers, { callTimeoutMs: 60_000 }), ctx.plugin(WorkerSessions, {}), ctx.plugin(Workflow, { retryDelayMs: 100, ...workflow }),
  ]
  await Promise.all(fibers)
  // Start-up recovery has run, so nothing scheduled then can take a run back by chance.
  await new Promise((resolve) => setTimeout(resolve, 200))
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => (stopping ??= (async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })())
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(stop)
  return { ctx, stop, dir }
}

describe('ctx.workflow: the engine under injected faults', () => {


  it('fails the node a scheduler exception happened on, so the operator can continue it once fixed', async () => {
    const { ctx } = await boot()
    const accept = ctx.workers.accept.bind(ctx.workers)
    ctx.workers.accept = (() => {
      throw new Error('a defect in acceptance')
    }) as typeof accept
    const run = ctx.workflow.start({ template: 'ask', input: 'q', classification: 'public' })
    expect(await ctx.workflow.wait(run.runId, 20_000)).toMatchObject({
      status: 'failed', nodes: [{ state: 'FAILED', error: { kind: 'internal', disposition: 'CODE_FIX', message: 'a defect in acceptance' } }],
    })
    // The fix lands; continuing reopens the failed node instead of refusing a run with none.
    ctx.workers.accept = accept
    ctx.workflow.continue(run.runId)
    expect(await ctx.workflow.wait(run.runId, 20_000)).toMatchObject({ status: 'completed', answer: 'echo: q' })
  }, 60_000)

  it('says why it refuses a start: an unknown template, a request key reused for another request, a host that drains until it resumes (INV-2, REQ-HOST-1)', async () => {
    const { ctx } = await boot({ holdMs: 2000 })
    expect(() => ctx.workflow.start({ template: 'nope', input: 'x', classification: 'public' })).toThrow(/unknown workflow template nope/)
    const once = ctx.workflow.start({ template: 'ask', input: 'once', classification: 'public', clientRequestId: 'req-1' })
    expect(() => ctx.workflow.start({ template: 'ask', input: 'other', classification: 'public', clientRequestId: 'req-1' })).toThrow(/clientRequestId was reused with a different request/)
    await vi.waitFor(() => expect(ctx.workflow.get(once.runId)?.nodes[0]?.state).toBe('RUNNING'))
    expect(ctx.workflow.drain()).toEqual({ draining: true, active: [once.runId] })
    expect(() => ctx.workflow.start({ template: 'ask', input: 'new work', classification: 'public' })).toThrow(/the host is draining/)
    await vi.waitFor(() => expect(ctx.workflow.drain().active).toEqual([]), { timeout: 30_000 })
    expect(ctx.workflow.get(once.runId)).toMatchObject({ status: 'completed' })
    expect(ctx.workflow.resume()).toEqual({ draining: false, active: [] })
    expect(ctx.workflow.start({ template: 'ask', input: 'after resume', classification: 'public' }).status).toBe('running')
  }, 60_000)




  it('closes a gate nobody decided within gateTimeoutHours, failing the run by rule and saying why; continue waits again, and an approval in time runs the plan (INV-9)', async () => {
    const gated = TEST_TEMPLATES.investigate!.map((n) => (n.grows ? { ...n, grows: { maxNodes: 2, approvalRequired: ['reason'] } } : n))
    const answer = (prompt: string): string => (prompt.includes('Plan how to answer')
      ? '```json\n{"confidence":"high","nodes":[{"id":"only","objective":"o","prompt":"the step","capabilities":["reason"],"tier":"economy"}]}\n```'
      : prompt.includes('<findings>') ? 'final' : 'step done')
    const { ctx } = await boot({ answer }, { templates: { gated }, gateTimeoutHours: 0.0008 })
    const models = ctx.models as FakeModels
    const run = ctx.workflow.start({ template: 'gated', input: 'q', classification: 'public' })
    await vi.waitFor(() => expect(ctx.workflow.get(run.runId)?.blocked).toBeDefined(), { timeout: 30_000 })
    const blocked = ctx.workflow.get(run.runId)!.blocked as Extract<RunView['blocked'], { kind: 'gate' }>
    expect(Date.parse(blocked.until!) - Date.now()).toBeLessThanOrEqual(3000)
    // Nobody approves: the gate closes by rule, the run fails saying why, and the plan's step never ran.
    await vi.waitFor(() => expect(ctx.workflow.get(run.runId)!.status).toBe('failed'), { timeout: 30_000 })
    expect(ctx.workflow.get(run.runId)).toMatchObject({ status: 'failed', error: { kind: 'gate_timeout', message: expect.stringMatching(/^no verdict on plan sha256:[0-9a-f]{64} arrived by .* \(gateTimeoutHours 0.0008\); continue the run to wait again$/) } })
    expect(models.calls).toHaveLength(1)
    const gate = ctx.workflow.explain(run.runId)!.nodes.find((n) => n.nodeId === 'plan:1:gate')!
    expect(gate.decisions.at(-1)).toMatchObject({ type: 'gate', outcome: 'closed' })
    expect(ctx.artifacts.get(gate.decisions.at(-1)!.id)!.body).toMatchObject({ decider: { type: 'rule', id: 'workflow.gate-timeout' }, deterministic: true })
    // Continued, it waits again with a new deadline, and an approval in time runs the plan.
    ctx.workflow.continue(run.runId)
    await vi.waitFor(() => expect(ctx.workflow.get(run.runId)?.blocked).toBeDefined(), { timeout: 30_000 })
    expect((ctx.workflow.get(run.runId)!.blocked as { until: string }).until > blocked.until!).toBe(true)
    ctx.workflow.approve(run.runId, { verdict: 'approved' })
    await vi.waitFor(() => expect(ctx.workflow.get(run.runId)!.status).not.toBe('running'), { timeout: 30_000 })
    expect(ctx.workflow.get(run.runId)).toMatchObject({ status: 'completed', answer: 'final' })
  }, 60_000)
})
