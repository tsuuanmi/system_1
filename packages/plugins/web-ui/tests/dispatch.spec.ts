import type { Context } from '@deepseek-ai/cordis'
import type { PoolConfig } from '@tsuuanmi/system-resources-core'
import { describe, expect, it, vi } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import { activeProject, readyTask } from '../../workflow/conformance/workflow.ts'
import { boot } from './store-backed.ts'

// Home's "Starts awaiting approval" (ADR-0064, PROP-0014 D1) over the store-backed board, approval queue,
// resource ledger, and engine, under the bundle's own studio policy (dispatch takes its default: ask).
vi.setConfig({ testTimeout: 120_000 })

const POOLS: PoolConfig[] = [{ pool: 'plan/max', account: 'max', kind: 'interactive', windows: [{ id: 'five-hour', kind: 'rolling', seconds: 18_000 }] }]

/** One Worker of the pooled account, idle, its 5 h window read just now at `used` percent. */
async function freeWorker(ctx: Context, workers: { extra: unknown[] }, used = 0): Promise<void> {
  workers.extra = [worker('w:max', { schema: 'capability-descriptor@1.5', tier: 'standard', quotaClass: 'agent-plan', proves: ['reason'], account: { id: 'max', group: 'g', mode: 'assigned' }, load: { running: 0, queued: 0, pending: 0, slots: 1 } })]
  await ctx.resources.observe({
    schema: 'limit-state@1.0', pool: 'plan/max', account: 'max', window: { id: 'five-hour', kind: 'rolling', seconds: 18_000 }, state: 'ok', usedPercentage: used,
    resetsAt: new Date(Date.now() + 40 * 60_000).toISOString(), source: 'runtime-result', observedAt: new Date().toISOString(),
  })
}

describe('web UI: the starts System proposes, on Home (ADR-0064)', () => {
  it('serves dispatch to the operator only: its settings, the asks with their Worker and windows, the bounds, and the last pass', async () => {
    const { ctx, call, client, workers } = await boot({ pools: POOLS })
    await activeProject(ctx)
    await freeWorker(ctx, workers)
    const task = await readyTask(ctx, 'Write the release notes', { template: 'solo' })
    await ctx.workflow.sweepDispatch()
    expect((await call('dispatch', undefined, client)).status).toBe(401)
    const read = await call('dispatch')
    expect(read.status).toBe(200)
    expect(read.value).toMatchObject({
      enabled: true, settings: { maxOpenAsks: 4, maxRunningPerAccount: 1 },
      bounds: { openAsks: { used: 1, max: 4 }, running: { used: 1, max: 8 } },
      asks: [{ taskId: task.taskId, title: 'Write the release notes', state: 'asked', worker: 'w:max', attempt: 1, windows: [{ name: '5 h', used: 0, headroom: 80, reserve: 20 }] }],
      lastPass: { state: 'ran', took: [{ taskId: task.taskId, worker: 'w:max', how: 'asked' }] },
      // PROP-0014 D2: nothing started by itself yet, no project paused, the hour's starts.
      started: [], pausedProjects: [],
    })
    expect((read.value['bounds'] as { hour?: unknown }).hour).toEqual({ used: 0, max: 6 })
    expect((await call('dispatch', {})).status).toBe(405)
  })
})
