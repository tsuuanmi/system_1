// A lead's token reaches only its own project (T285, ADR-0076): over the store-backed board, the
// engine, and the Worker sessions on one store, the tools a lead calls refuse another project's task,
// run, and Workers with the reason, and the same calls on its own project pass.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard from '@tsuuanmi/system-board'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import { McpTools, type ToolContext, type ToolHandler, type ToolSpec } from '@tsuuanmi/system-gateway-core'
import Leases from '@tsuuanmi/system-leases'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { activeProject, CONFIG, readyTask, ScriptedWorkers, TEMPLATES } from '../conformance/workflow.ts'
import Workflow from '../src/index.ts'

// End to end over real plugins on one durable store; a loaded host needs time.
vi.setConfig({ testTimeout: 120_000 })

/** `read` runs on auto; everything else (a charter) asks. */
const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }],
  default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

class RecordingMcp extends McpTools {
  readonly tools = new Map<string, { spec: ToolSpec; handler: ToolHandler }>()
  tool(name: string, spec: ToolSpec, handler: ToolHandler): void {
    this.tools.set(name, { spec, handler })
  }
}

type Reply = { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> }

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-lead-'))
  const ctx = new Context()
  const workers = new ScriptedWorkers()
  // Every step holds: the runs stay running, and the calls below read them as they stand.
  workers.reply = () => 'hold'
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(RecordingMcp), ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => void c.workers.register(workers.source(c)) }),
    ctx.plugin(StoreApprovals, { policies: [POLICY], sweepSeconds: 3600 }),
  ]
  await Promise.all(fibers)
  const board = ctx.plugin(StoreBoard, { sweepSeconds: 0 })
  await board
  fibers.push(board)
  const engine = ctx.plugin(Workflow, { ...CONFIG, templates: { ...TEMPLATES } })
  await engine
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  const mcp = (ctx as unknown as { mcp: RecordingMcp }).mcp
  const call = (name: string, args: Record<string, unknown>, context: ToolContext): Promise<Reply> => mcp.tools.get(name)!.handler(args, context) as unknown as Promise<Reply>
  return { ctx, workers, call }
}

const asLead = (project: string): ToolContext => ({ scope: 'client', lead: project })
const OPERATOR: ToolContext = { scope: 'operator' }
const refusal = (own: string, other: string | undefined) => new RegExp(`the lead token of project ${own} reaches only project ${own}; .* belongs to ${other === undefined ? 'no project' : `project ${other}`}`)

describe('a lead token reaches only its own project (T285)', () => {
  it('runs a board task of its own project, and refuses another project\'s task before anything starts', async () => {
    const { ctx, workers, call } = await boot()
    await activeProject(ctx, 'p1')
    await activeProject(ctx, 'p2')
    const mine = await readyTask(ctx, 'mine', { projectId: 'p1' })
    const theirs = await readyTask(ctx, 'theirs', { projectId: 'p2' })
    const refused = await call('run', { template: 'solo', input: 'x', waitSeconds: 0, task: { taskId: theirs.taskId } }, asLead('p1'))
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toMatch(refusal('p1', 'p2'))
    expect((await ctx.board.task(theirs.taskId))!.state).toBe('ready')
    expect(workers.started).toHaveLength(0)
    expect(ctx.workflow.usage()).toHaveLength(0)
    const passed = await call('run', { template: 'solo', input: 'x', waitSeconds: 0, task: { taskId: mine.taskId } }, asLead('p1'))
    expect(passed.isError, passed.content[0]?.text).toBeFalsy()
    expect(passed.structuredContent).toMatchObject({ template: 'solo', task: { taskId: mine.taskId } })
    // The operator's token, with no project, reaches both.
    expect((await call('run', { template: 'solo', input: 'x', waitSeconds: 0, task: { taskId: theirs.taskId } }, OPERATOR)).isError).toBeFalsy()
  })
})
