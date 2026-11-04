import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard from '@tsuuanmi/system-board'
import type { BoardTask, TaskInput } from '@tsuuanmi/system-board-core'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { SchemaRegistry } from '@tsuuanmi/system-libs'
import StoreResources from '@tsuuanmi/system-resources'
import type { PoolConfig } from '@tsuuanmi/system-resources-core'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { CapabilityDescriptor, WorkerSandbox } from '@tsuuanmi/system-workers-core'
import { runSuite } from '../../../libs/conformance/runner.ts'
import { DISPATCH_ADVISOR_CONTRACT } from '@tsuuanmi/system-decision-core'
import { dispatchAdvisorSuite, type DispatchHarness } from '../../../decision-core/conformance/dispatch-advisor.ts'
import { dispatchHarness, type Placement } from '../conformance/advisor.ts'
import type { Advice, Advisor, AdvisorFeatures, AdvisorSignal } from '../src/index.ts'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import { activeProject, CONFIG, readyTask, ScriptedWorkers, TEMPLATES } from '../conformance/workflow.ts'
import Workflow, { type Config, type DispatchStatus } from '../src/index.ts'

// The dispatch pass end to end (ADR-0064, PROP-0014 D1) over the store-backed board, approval queue,
// and resource ledger, on one durable store; only Worker execution is scripted. A loaded host needs time.
vi.setConfig({ testTimeout: 120_000 })

const schemas = new SchemaRegistry()

/** `read` runs on auto; every other class, `dispatch` among them, takes the default: ask. */
const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }, { actionClass: 'workspace-write', mode: 'auto', requires: ['tests', 'lint'] }],
  default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

/** A template whose writing step proves develop, then a review on any Worker. */
const DEV = {
  dev: [
    { nodeId: 'develop:1', objective: 'Write it', prompt: '{{input}}', capabilities: ['develop'], tier: 'standard' as const, conversation: 'temporary' as const, acceptance: 'acceptance.answer' },
    { nodeId: 'review:1', objective: 'Review it', prompt: 'Review: {{node:develop:1}}', capabilities: ['reason'], tier: 'standard' as const, conversation: 'temporary' as const, acceptance: 'acceptance.answer', dependsOn: ['develop:1'] },
  ],
}

const FIVE_H = 5 * 3600
/** An agent Worker of an account (opaque ids and group), idle, one slot. */
const agent = (id: string, account: string, extra: Partial<CapabilityDescriptor> & { proves?: string[] } = {}): CapabilityDescriptor => worker(id, {
  schema: 'capability-descriptor@1.5', quotaClass: 'agent-plan', proves: ['reason', 'develop'], account: { id: account, group: 'g1', mode: 'assigned' },
  load: { running: 0, queued: 0, pending: 0, slots: 1 }, ...extra,
})
const pool = (account: string): PoolConfig => ({ pool: `plan/${account}`, account, kind: 'interactive', windows: [{ id: 'five-hour', kind: 'rolling', seconds: FIVE_H }] })

interface Booted {
  ctx: Context
  workers: ScriptedWorkers
  restartWorkflow: (config?: Config) => Promise<void>
  /** Read account's 5 h window as `used` percent, resetting in `resetsIn` minutes, observed `age` minutes ago. */
  read: (account: string, used: number, resetsIn?: number, age?: number) => Promise<void>
}

async function boot(options: { workflow?: Config; accounts?: string[]; sandbox?: (worker: string) => WorkerSandbox | undefined; policy?: AutonomyPolicy; quota?: Record<string, number>; availableUnknown?: string[] } = {}): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-dispatch-'))
  const ctx = new Context()
  const workers = new ScriptedWorkers()
  workers.reply = () => 'hold'
  const accounts = options.accounts ?? ['acc-a', 'acc-b']
  const config: Config = { ...CONFIG, ...options.workflow, templates: { ...TEMPLATES, ...DEV, ...options.workflow?.templates }, dispatch: { sweepSeconds: 3600, ...options.workflow?.dispatch } }
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => void c.workers.register({ ...workers.source(c), ...(options.sandbox ? { sandbox: options.sandbox } : {}) }) }),
    ctx.plugin(StoreApprovals, { policies: [options.policy ?? POLICY], sweepSeconds: 3600 }),
    ctx.plugin(StoreBoard, { sweepSeconds: 0 }),
    ctx.plugin(StoreResources, { pools: accounts.map((a) => ({ ...pool(a), ...(options.availableUnknown?.includes(a) ? { unknown: 'available' as const } : {}) })), ...(options.quota ? { quota: options.quota } : {}) }),
  ]
  await Promise.all(fibers)
  let engine = ctx.plugin(Workflow, config)
  await engine
  // The pass the engine makes at its start, before any task is ready.
  await ctx.workflow.sweepDispatch()
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  await activeProject(ctx)
  return {
    ctx, workers,
    restartWorkflow: async (next = config) => {
      await engine.dispose()
      engine = ctx.plugin(Workflow, next)
      await engine
      await ctx.workflow.sweepDispatch()
    },
    read: async (account, used, resetsIn = 300, age = 1) => {
      await ctx.resources.observe({
        schema: 'limit-state@1.0', pool: `plan/${account}`, account, window: { id: 'five-hour', kind: 'rolling', seconds: FIVE_H }, state: 'ok', usedPercentage: used,
        resetsAt: new Date(Date.now() + resetsIn * 60_000).toISOString(), source: 'runtime-result', observedAt: new Date(Date.now() - age * 60_000).toISOString(),
      })
    },
  }
}

const ready = (ctx: Context, title: string, extra: Partial<TaskInput> = {}): Promise<BoardTask> => readyTask(ctx, title, { template: 'dev', ...extra })
type Decision = { schema: string; decisionType: string; inputs: string[]; decider: { id: string; version: string }; outcome: { option: string; detail?: Record<string, unknown> }; candidates: Array<{ option: string; selected: boolean; reasons: string[] }> }
const decisionOf = (ctx: Context, id: string | undefined): Decision => {
  const body = ctx.artifacts.get(id as `sha256:${string}`)?.body as Decision
  expect(body, `decision ${id}`).toBeDefined()
  schemas.assertRecord(body)
  return body
}
const dispatchRequests = async (ctx: Context) => (await ctx.approvals.list({ states: ['open', 'batched', 'approved', 'rejected'] })).filter((r) => r.action.class === 'dispatch')
const approve = async (ctx: Context, requestId: string): Promise<void> => {
  const request = (await ctx.approvals.get(requestId))!
  const [result] = await ctx.approvals.decide([{ requestId, subject: request.subject, verdict: 'approved' }])
  expect(result?.refused).toBeUndefined()
}
const askOf = (status: DispatchStatus, taskId: string) => status.asks.find((a) => a.taskId === taskId)
const reasonOf = (status: DispatchStatus, taskId: string): string => status.lastPass?.tasks.find((t) => t.taskId === taskId)?.reason ?? '(none)'

describe('dispatch settings (ADR-0064)', () => {

  it('refuses the workflow row on a dispatch setting out of its range, so no engine runs on a value nobody chose (INV-2)', async () => {
    const ctx = new Context()
    const dir = mkdtempSync(join(tmpdir(), 'system-workflow-dispatch-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    const fibers = [ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}), ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {})]
    await Promise.all(fibers)
    onTestFinished(async () => {
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
    })
    const engine = ctx.plugin(Workflow, { ...CONFIG, maxActiveRuns: 4, dispatch: { maxRunning: 4 } })
    try {
      await engine
    } catch {
      // refused at load: the assertion below is what matters
    }
    expect(ctx.get('workflow')).toBeUndefined()
    await engine.dispose()
  })
})

describe('the dispatch pass (ADR-0064, REQ-WF-16)', () => {

  it('asks once: a pass repeated adopts its open ask, and one interrupted between the request and its record adopts the request (INV-4)', async () => {
    const { ctx, workers, read } = await boot()
    workers.extra = [agent('agent:acc-a/develop', 'acc-a')]
    await read('acc-a', 0)
    const task = await ready(ctx, 'once')
    // The queue takes the request, then the engine dies before it records it on its row.
    const request = ctx.approvals.request.bind(ctx.approvals)
    let crash = true
    ctx.approvals.request = async (...args) => {
      const made = await request(...args)
      if (crash) {
        crash = false
        throw new Error('the host died after the request was made')
      }
      return made
    }
    const interrupted = await ctx.workflow.sweepDispatch()
    expect(interrupted.state).toBe('waiting')
    expect(askOf(ctx.workflow.dispatchStatus(), task.taskId)).toMatchObject({ state: 'asking' })
    expect(await dispatchRequests(ctx)).toHaveLength(1)
    // The next pass finds the request on its subject, and asks nothing new.
    await ctx.workflow.sweepDispatch()
    await ctx.workflow.sweepDispatch()
    const [open] = await dispatchRequests(ctx)
    expect(await dispatchRequests(ctx)).toHaveLength(1)
    expect(askOf(ctx.workflow.dispatchStatus(), task.taskId)).toMatchObject({ state: 'asked', requestId: open!.requestId })
    expect(reasonOf(ctx.workflow.dispatchStatus(), task.taskId)).toMatch(/^an ask for attempt 1 is open/)
  })

  it('starts exactly the attempt and the Worker an approval names, through the engine\'s own start, and the run names why it started (INV-5, INV-13)', async () => {
    const { ctx, workers, read } = await boot()
    workers.extra = [agent('agent:acc-a/develop', 'acc-a'), agent('agent:acc-b/develop', 'acc-b')]
    await read('acc-a', 0, 30)
    await read('acc-b', 0, 600)
    const task = await ready(ctx, 'go')
    await ctx.workflow.sweepDispatch()
    const ask = askOf(ctx.workflow.dispatchStatus(), task.taskId)!
    expect(ask.worker).toBe('agent:acc-a/develop')
    // Meanwhile acc-b would score higher: the approval still starts the Worker it names.
    await read('acc-b', 0, 10)
    await approve(ctx, ask.requestId!)
    const pass = await ctx.workflow.sweepDispatch()
    expect(pass.took).toEqual([])
    const started = (await ctx.board.task(task.taskId))!
    expect(started.state).toBe('running')
    const runId = started.run!.runId
    await vi.waitFor(() => expect(workers.started.length).toBe(1), { timeout: 30_000 })
    expect(workers.started[0]).toMatchObject({ worker: 'agent:acc-a/develop', runId })
    expect(ctx.workflow.dispatchStatus().asks).toEqual([])
    // The run's admission names the dispatch decisions; explain shows them first, then the approval.
    const view = ctx.workflow.explain(runId)!
    expect(view.decisions!.slice(0, 4).map((d) => d.type)).toEqual(['admission', 'route', 'autonomy', 'approval'])
    const admission = ctx.artifacts.list({ kind: 'decision', decisionType: 'admission', runId, limit: 100 }).map((a) => a.body as Decision).find((d) => d.decider.id === 'workflow.task-admission')!
    expect(admission.inputs).toEqual(expect.arrayContaining(ask.decisions))
    expect(admission.candidates.find((c) => c.selected)!.reasons[0]).toMatch(/^dispatch chose its start/)
  })

  it('never counts an unknown, stale, or reserved window as free, and keeps the configured reserve (INV-2, D63)', async () => {
    const { ctx, workers, read } = await boot({ accounts: ['acc-a', 'acc-b', 'acc-c'], quota: { reservePercent: 30 } })
    workers.extra = ['acc-a', 'acc-b', 'acc-c'].map((acc) => agent(`agent:${acc}/develop`, acc))
    // acc-a: no reading; acc-b: stale (45 min old); acc-c: 70 % used, at the 30 % reserve.
    await read('acc-b', 0, 300, 45)
    await read('acc-c', 70)
    const task = await ready(ctx, 'none free')
    await ctx.workflow.sweepDispatch()
    expect(ctx.workflow.dispatchStatus().asks).toEqual([])
    const reason = reasonOf(ctx.workflow.dispatchStatus(), task.taskId)
    expect(reason).toMatch(/^no Worker is free for step develop:1/)
    expect(reason).toMatch(/no reading yet/)
    expect(reason).toMatch(/stale/)
    expect(reason).toMatch(/used 70 %, no headroom above the 30 % reserve/)
    expect(await dispatchRequests(ctx)).toHaveLength(0)
  })

  it('dispatches nothing under forbid, off, or paused; a pause withdraws its asks and holds across a restart', async () => {
    const forbid = await boot({ policy: { ...POLICY, rules: [...POLICY.rules, { actionClass: 'dispatch', mode: 'forbid' }] } })
    forbid.workers.extra = [agent('agent:acc-a/develop', 'acc-a')]
    await forbid.read('acc-a', 0)
    const f = await ready(forbid.ctx, 'forbidden')
    await forbid.ctx.workflow.sweepDispatch()
    expect(reasonOf(forbid.ctx.workflow.dispatchStatus(), f.taskId)).toMatch(/^the policy forbids dispatch in project p1/)
    expect(await dispatchRequests(forbid.ctx)).toHaveLength(0)
    expect(forbid.workers.started).toHaveLength(0)
    expect((await forbid.ctx.board.task(f.taskId))!.state).toBe('ready')
    const off = await boot({ workflow: { dispatch: { enabled: false } } })
    off.workers.extra = [agent('agent:acc-a/develop', 'acc-a')]
    await off.read('acc-a', 0)
    await ready(off.ctx, 'off')
    expect(await off.ctx.workflow.sweepDispatch()).toMatchObject({ state: 'off' })
    expect(await dispatchRequests(off.ctx)).toHaveLength(0)
    const paused = await boot()
    paused.workers.extra = [agent('agent:acc-a/develop', 'acc-a')]
    await paused.read('acc-a', 0)
    const p = await ready(paused.ctx, 'paused')
    await paused.ctx.workflow.sweepDispatch()
    const ask = askOf(paused.ctx.workflow.dispatchStatus(), p.taskId)!
    const status = paused.ctx.workflow.pauseDispatch('a quiet afternoon')
    expect(status.paused).toMatchObject({ reason: 'a quiet afternoon' })
    expect(decisionOf(paused.ctx, status.paused!.decision)).toMatchObject({ decisionType: 'gate', decider: { id: 'dispatch.pause' }, outcome: { option: 'pause' } })
    await paused.ctx.workflow.sweepDispatch()
    expect((await paused.ctx.approvals.get(ask.requestId!))).toMatchObject({ state: 'rejected', resolution: { cause: 'withdrawn' } })
    await paused.restartWorkflow()
    expect(await paused.ctx.workflow.sweepDispatch()).toMatchObject({ state: 'paused' })
    expect(paused.ctx.workflow.dispatchStatus().paused?.reason).toBe('a quiet afternoon')
    paused.ctx.workflow.resumeDispatch()
    await paused.ctx.workflow.sweepDispatch()
    expect(askOf(paused.ctx.workflow.dispatchStatus(), p.taskId)).toMatchObject({ state: 'asked' })
  })
})

/** The studio policy with `dispatch` at `mode`. */
const withDispatch = (mode: 'auto' | 'notify' | 'ask'): AutonomyPolicy => ({ ...POLICY, rules: [...POLICY.rules, { actionClass: 'dispatch', mode }] })
/** Every request the queue holds, in any of its states (a withdrawn or expired one is rejected), of the class `dispatch`. */
const everyDispatchRequest = dispatchRequests
/** The dispatch rows of a task, as the store keeps them. */
const rowsOf = (ctx: Context, taskId: string) => ctx.store.db.prepare('SELECT ask_id, state, mode, run_id, started_at FROM workflow_dispatch WHERE task_id = ? ORDER BY created_at').all(taskId) as Array<{ ask_id: string; state: string; mode: string; run_id: string | null; started_at: string | null }>

describe('dispatch starting by itself (PROP-0014 D2, ADR-0064)', () => {

  it('under ask keeps asking as before: one request, nothing started, and the start is listed only once approved', async () => {
    const { ctx, workers, read } = await boot({ policy: withDispatch('ask') })
    workers.extra = [agent('agent:acc-a/develop', 'acc-a')]
    await read('acc-a', 0)
    const task = await ready(ctx, 'asked')
    const pass = await ctx.workflow.sweepDispatch()
    expect(pass.took.map((t) => t.how)).toEqual(['asked'])
    const [request] = await dispatchRequests(ctx)
    expect(request).toMatchObject({ state: 'open', subject: { ref: `dispatch:${task.taskId}:attempt:0` } })
    expect(workers.started).toHaveLength(0)
    expect(ctx.workflow.dispatchStatus().started).toEqual([])
    expect(rowsOf(ctx, task.taskId)).toEqual([expect.objectContaining({ state: 'asked', mode: 'ask' })])
    await approve(ctx, request!.requestId)
    await ctx.workflow.sweepDispatch()
    const runId = (await ctx.board.task(task.taskId))!.run!.runId
    expect(ctx.workflow.dispatchStatus().started).toEqual([expect.objectContaining({ runId, mode: 'ask' })])
    expect(ctx.workflow.get(runId)!.task?.startedBy).toBe('dispatch')
    expect(ctx.eventLog.query({ type: 'workflow.dispatch.notice', limit: 10 })).toEqual([])
  })

  it('starts once when a restart comes in the middle of a start: the run the engine admitted is adopted, never started again (INV-4)', async () => {
    for (const rewound of ['starting', 'approved'] as const) {
      const { ctx, workers, read, restartWorkflow } = await boot({ policy: withDispatch('auto') })
      workers.extra = [agent('agent:acc-a/develop', 'acc-a')]
      await read('acc-a', 0)
      const task = await ready(ctx, `crash while ${rewound}`)
      await ctx.workflow.sweepDispatch()
      const runId = (await ctx.board.task(task.taskId))!.run!.runId
      await vi.waitFor(() => expect(workers.started.length).toBe(1), { timeout: 30_000 })
      // The host died after the engine admitted the run, before the row recorded it started.
      ctx.store.db.prepare('UPDATE workflow_dispatch SET state = ?, run_id = NULL, started_at = NULL, outcome = NULL WHERE task_id = ?').run(rewound, task.taskId)
      await restartWorkflow()
      await ctx.workflow.sweepDispatch()
      expect(rowsOf(ctx, task.taskId)).toEqual([expect.objectContaining({ state: 'started', mode: 'auto', run_id: runId, started_at: expect.any(String) })])
      const after = (await ctx.board.task(task.taskId))!
      expect(after).toMatchObject({ state: 'running', run: { runId }, attempts: { count: 1 } })
      expect(ctx.store.db.prepare('SELECT COUNT(*) AS n FROM workflow_tasks WHERE task_id = ?').get(task.taskId)).toEqual({ n: 1 })
      expect(workers.started).toHaveLength(1)
      expect(await everyDispatchRequest(ctx)).toHaveLength(0)
    }
  })
})

/** A node's row, as the store keeps it. */
const nodeRowOf = (ctx: Context, runId: string, nodeId: string) => ctx.store.db.prepare('SELECT state, worker, not_before, error, attempt FROM workflow_nodes WHERE run_id = ? AND node_id = ?').get(runId, nodeId) as { state: string; worker: string | null; not_before: string | null; error: string | null; attempt: number }

describe('every dispatched start stays explained (review T202 of PR #37)', () => {
  it('keeps a dispatched start on the Worker dispatch chose: refused at routing, the step waits for it within approvedHoldMinutes and never routes to another; past the hold the run fails with nothing sent (INV-13, ADR-0064)', async () => {
    const { ctx, workers, read, restartWorkflow } = await boot({ policy: withDispatch('auto'), workflow: { dispatch: { approvedHoldMinutes: 1 } } })
    workers.extra = [agent('agent:acc-a/develop', 'acc-a'), agent('agent:acc-b/develop', 'acc-b', { load: { running: 1, queued: 0, pending: 0, slots: 1 } })]
    await read('acc-a', 0)
    await read('acc-b', 0)
    // Between dispatch's choice and the engine's routing, the chosen Worker signs out, and another one is idle now.
    const route = ctx.workers.route.bind(ctx.workers)
    ctx.workers.route = async (...args) => {
      workers.extra = [agent('agent:acc-a/develop', 'acc-a', { state: 'unavailable' }), agent('agent:acc-b/develop', 'acc-b')]
      return route(...args)
    }
    const task = await ready(ctx, 'bound to its choice')
    const pass = await ctx.workflow.sweepDispatch()
    expect(pass.took.map((t) => [t.worker, t.how])).toEqual([['agent:acc-a/develop', 'started']])
    const runId = (await ctx.board.task(task.taskId))!.run!.runId
    await vi.waitFor(() => expect(workers.started.length + (nodeRowOf(ctx, runId, 'develop:1').error ? 1 : 0)).toBeGreaterThan(0), { timeout: 30_000 })
    // No Worker dispatch did not choose takes it: the step waits for the chosen one, nothing sent, no attempt spent.
    expect(workers.started).toEqual([])
    const waiting = nodeRowOf(ctx, runId, 'develop:1')
    expect(waiting).toMatchObject({ state: 'READY', worker: null, attempt: 0, not_before: expect.any(String) })
    expect(JSON.parse(waiting.error!).message).toMatch(/dispatch chose agent:acc-a\/develop for this step .*it waits for that Worker/)
    // Past the hold (the run started more than approvedHoldMinutes ago), the run fails on it, still with nothing sent.
    ctx.store.db.prepare('UPDATE workflow_runs SET created_at = ? WHERE run_id = ?').run(new Date(Date.now() - 2 * 60_000).toISOString(), runId)
    ctx.store.db.prepare('UPDATE workflow_nodes SET not_before = ? WHERE run_id = ?').run(new Date().toISOString(), runId)
    await restartWorkflow()
    await vi.waitFor(() => expect(ctx.workflow.get(runId)!.status).toBe('failed'), { timeout: 30_000 })
    expect(workers.started).toEqual([])
    expect(nodeRowOf(ctx, runId, 'develop:1').error).toMatch(/dispatch chose agent:acc-a\/develop for this step/)
  })
})

/** An advisor that records what it was given and answers with `answer`. */
class FakeAdvisor implements Advisor {
  readonly id = 'fake'
  readonly seen: AdvisorFeatures[] = []
  constructor(private readonly answer: (features: AdvisorFeatures, signal: AdvisorSignal) => Promise<Advice>) {}
  advise(features: AdvisorFeatures, signal: AdvisorSignal): Promise<Advice> {
    this.seen.push(features)
    return this.answer(features, signal)
  }
}
/** Advice that prefers every candidate but the chosen one (A): if shadow could change the choice, it would. */
const contrary = new FakeAdvisor(async (f) => ({
  status: 'advice', provider: 'fake', modelVersion: 'fake@1',
  candidates: f.candidates.map((c) => ({ alias: c.alias, accepted: c.alias === 'A' ? 0.01 : 0.99, limit: c.alias === 'A' ? 0.99 : 0.01, needsOperator: 0.5 })),
}))

/**
 * The dispatch the advisor seam's suite runs in: two free Workers on two accounts, acc-a's chosen
 * (more headroom, the sooner reset); the advisor put in place by `placement`.
 */
const advisorHarness = (placement: Placement) => async (): Promise<DispatchHarness> => {
  const { ctx, workers, read } = await boot({ accounts: ['acc-a', 'acc-b'] })
  workers.extra = [agent('agent:acc-a/develop', 'acc-a'), agent('agent:acc-b/develop', 'acc-b')]
  await read('acc-a', 10, 40)
  await read('acc-b', 30, 200)
  return dispatchHarness({ ctx, chosen: 'agent:acc-a/develop', hidden: ['acc-a', 'acc-b', 'agent:', 'p1'], ready: (title, goal) => ready(ctx, title, { goal }) }, placement)
}
// The seam's conformance suite (decision-core), run by every advisor System has, and by a fake (plugin
// rule 7): each set through setDispatchAdvisor, and each as the provider of ctx.dispatchAdvisor.
const ADVISORS: Array<[string, () => Advisor]> = [
  ['a fake whose advice is contrary to the choice', () => contrary],
]
const PLACEMENTS: Placement[] = ['setDispatchAdvisor', 'seam']
for (const [name, advisor] of ADVISORS) {
  for (const placement of PLACEMENTS) {
    const through = placement === 'seam' ? 'ctx.dispatchAdvisor' : 'setDispatchAdvisor'
    runSuite(dispatchAdvisorSuite, { contract: DISPATCH_ADVISOR_CONTRACT, name: `${name}, through ${through}`, boot: { advisor, dispatch: advisorHarness(placement) } })
  }
}
