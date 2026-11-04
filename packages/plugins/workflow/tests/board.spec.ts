import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard, { type Config as BoardConfig } from '@tsuuanmi/system-board'
import { type ArtifactRef, type BoardTask, type BudgetLine, fundingVersion, type TaskInput } from '@tsuuanmi/system-board-core'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { captureGitSubject, contentId, SchemaRegistry, sha256 } from '@tsuuanmi/system-libs'
import StoreResources from '@tsuuanmi/system-resources'
import { type UsageRecord } from '@tsuuanmi/system-resources-core'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { WorkerExecution } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { FakeResources } from '../../../resources-core/conformance/resources.ts'
import { activeProject, CONFIG, readyTask, ScriptedWorkers, TEMPLATES } from '../conformance/workflow.ts'
import Workflow, { type Config, type RunView, WorkflowFailure } from '../src/index.ts'

// End to end over the store-backed board and approval queue and the engine, on one durable store;
// only Worker execution is scripted. A loaded host needs time.
vi.setConfig({ testTimeout: 120_000 })

const schemas = new SchemaRegistry()

/** `read` runs on auto; `workspace-write` on auto once tests and lint pass; everything else asks. */
const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }, { actionClass: 'workspace-write', mode: 'auto', requires: ['tests', 'lint'] }],
  default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

/**
 * Scripted Workers that answer as an agent in a git working tree: each result is an
 * `agent-result@1.1` naming the workspace and the subject the tree is at when the engine reads it
 * (or `stale`, a version the tree never had).
 */
class AgentWorkers extends ScriptedWorkers {
  stale = false
  private readonly results = new Map<string, ArtifactRef>()
  constructor(private readonly workspace: string, private readonly artifacts: () => Context['artifacts']) {
    super()
  }

  override get(id: string): WorkerExecution | undefined {
    const execution = super.get(id)
    if (!execution?.result) return execution
    if (!this.results.has(id)) {
      const text = (this.artifacts().get(execution.result)!.body as { text: string }).text
      const { subject } = captureGitSubject(this.workspace)!
      this.results.set(id, this.artifacts().put({
        kind: 'report', bodySchema: 'agent-result@1.1', classification: 'public', producer: { type: 'worker', ref: 'w:standard' },
        body: { schema: 'agent-result@1.1', worker: 'w:standard', runtime: 'scripted', runId: 'agent-run', promptHash: sha256(text), sandbox: 'workspace-write', text, workspace: this.workspace, subject: this.stale ? { ...subject, version: 'stale' } : subject },
      }).id as ArtifactRef)
    }
    return { ...execution, result: this.results.get(id)! }
  }
}

/** A git working tree with a commit and a change on top. */
function workingTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-tree-'))
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { stdio: 'ignore' })
  git('init', '-q')
  writeFileSync(join(dir, 'kernel.c'), 'int main(void) { return 0; }\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'kernel.c'), 'int main(void) { return 1; }\n')
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** The store-backed board under a short lease cap (as `leases.maxTtlMs` would set it, without the engine's own run lease), counting renewals. */
class ShortLeaseBoard extends StoreBoard {
  static readonly CAP_MS = 3000
  renewals = 0
  override async claim(taskId: string, owner: string, ttlMs: number, at?: Date) {
    return super.claim(taskId, owner, Math.min(ttlMs, ShortLeaseBoard.CAP_MS), at)
  }

  override async renew(taskId: string, generation: number, ttlMs: number, at?: Date) {
    this.renewals++
    return super.renew(taskId, generation, Math.min(ttlMs, ShortLeaseBoard.CAP_MS), at)
  }
}

interface Booted {
  ctx: Context
  workers: ScriptedWorkers
  /** Stop the engine alone, run `between` while it is down (the board, the queue, and the store stay), then start it again. */
  restartWorkflow: (between?: () => void | Promise<void>) => Promise<void>
  /** Stop the board alone (a host that died), then start it again over the same store, as a restart does. */
  restartBoard: () => Promise<void>
}

/** The store-backed ledger's one pool, as the ledger fake configures it. */
const POOLS = [{ pool: 'max.programmatic', account: 'max', kind: 'programmatic' as const, windows: [{ id: 'monthly', kind: 'credit' as const }] }]

async function boot(options: { workflow?: Config; board?: boolean | 'short'; boardConfig?: BoardConfig; workspace?: string; resources?: boolean | 'store'; resourcesConfig?: Record<string, unknown>; policy?: AutonomyPolicy } = {}): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-board-'))
  const ctx = new Context()
  const workers = options.workspace ? new AgentWorkers(options.workspace, () => ctx.artifacts) : new ScriptedWorkers()
  const config: Config = { ...CONFIG, ...options.workflow, templates: { ...TEMPLATES, ...options.workflow?.templates } }
  const boardPlugin = options.board === 'short' ? ShortLeaseBoard : StoreBoard
  const boardConfig: BoardConfig = { ...options.boardConfig, sweepSeconds: 0 }
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => void c.workers.register(workers.source(c)) }),
    ...(options.board === false ? [] : [ctx.plugin(StoreApprovals, { policies: [options.policy ?? POLICY], sweepSeconds: 3600 })]),
  ]
  const boardAt = fibers.length
  if (options.board !== false) fibers.push(ctx.plugin(boardPlugin, boardConfig))
  if (options.resources === 'store') fibers.push(ctx.plugin(StoreResources, { pools: POOLS, ...options.resourcesConfig }))
  else if (options.resources) fibers.push(ctx.plugin(FakeResources))
  await Promise.all(fibers)
  let engine = ctx.plugin(Workflow, config)
  await engine
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  return {
    ctx, workers,
    restartWorkflow: async (between) => {
      await engine.dispose()
      await between?.()
      engine = ctx.plugin(Workflow, config)
      await engine
    },
    restartBoard: async () => {
      await fibers[boardAt]!.dispose()
      fibers[boardAt] = ctx.plugin(boardPlugin, boardConfig)
      await fibers[boardAt]
    },
  }
}

const project = (ctx: Context): Promise<void> => activeProject(ctx)
/** The fake ledger's `max.programmatic` pool reads ok, so a budget on it can be reserved (a window with no reading is unknown, INV-2). */
const poolOpen = async (ctx: Context, observedAt = new Date()): Promise<void> => {
  await ctx.resources.observe({ schema: 'limit-state@1.0', pool: 'max.programmatic', account: 'max', window: { id: 'monthly', kind: 'credit' }, state: 'ok', source: 'runtime-result', observedAt: observedAt.toISOString() })
}
const ready = (ctx: Context, title: string, extra: Partial<TaskInput> = {}): Promise<BoardTask> => readyTask(ctx, title, extra)
/** Usage the ledger counts for a task, as earlier work recorded it on `max.programmatic`: one run of one turn. */
const drew = (ctx: Context, taskId: string, requestId: string, extra: Partial<UsageRecord> = {}): Promise<unknown> => ctx.resources.record({
  schema: 'usage-record@1.0', requestId, source: 'runtime-result', observedAt: new Date().toISOString(), account: 'max', pool: 'max.programmatic', taskId, turns: 1, ...extra,
})

const settled = async (ctx: Context, runId: string): Promise<RunView> => {
  const view = await ctx.workflow.wait(runId, 60_000)
  expect(view.status, `run ${runId} finished`).not.toBe('running')
  return view
}

const until = (check: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> => vi.waitFor(async () => {
  if (!(await check())) throw new Error(`timed out waiting for ${what}`)
}, { timeout: ms, interval: 25 })

/** The run's outcome reached its task. */
const reported = async (ctx: Context, runId: string): Promise<RunView> => {
  await until(() => ctx.workflow.get(runId)?.task?.phase === 'reported', `run ${runId}'s report`)
  return ctx.workflow.get(runId)!
}

type Decision = { decisionType: string; inputs: string[]; decider: { id: string }; outcome: { option: string; detail?: Record<string, unknown> }; candidates: Array<{ option: string; selected: boolean; reasons: string[] }> }
const decisionOf = (ctx: Context, ref: string | undefined): Decision => {
  expect(ref, 'a decision').toBeDefined()
  const envelope = ctx.artifacts.get(ref as ArtifactRef)
  expect(envelope?.kind).toBe('decision')
  schemas.assertRecord(envelope!.body as { schema: string })
  return envelope!.body as Decision
}
const decisionsOf = (ctx: Context, type: string, deciderId: string): Decision[] =>
  ctx.artifacts.list({ kind: 'decision', decisionType: type, limit: 1000 }).map((a) => a.body as Decision).filter((d) => d.decider.id === deciderId)

const refusalOf = async (call: () => Promise<unknown>): Promise<string> => {
  try {
    await call()
    return 'admitted'
  } catch (error) {
    return error instanceof WorkflowFailure ? `${error.kind}: ${error.message}` : `untyped: ${String(error)}`
  }
}

describe('ctx.workflow serves board tasks over the store-backed board and approval queue', () => {
  it('takes a ready task, records the run on the board before any step runs, then submits and accepts its result: done', async () => {
    const { ctx, workers } = await boot()
    await project(ctx)
    const task = await ready(ctx, 'answer')
    // When the first step starts, the board already records this run (run first, then work).
    const seen: Array<BoardTask['state'] | undefined> = []
    workers.reply = () => 'hold'
    const run = await ctx.workflow.start({ template: 'solo', input: 'the question', classification: 'public', task: { taskId: task.taskId } })
    expect(run.task).toMatchObject({ taskId: task.taskId, claim: 'own', phase: 'started', generation: 1 })
    await until(() => workers.started.length === 1, 'the step started')
    const running = (await ctx.board.task(task.taskId))!
    seen.push(running.state)
    expect(running).toMatchObject({ state: 'running', run: { runId: run.runId }, holder: { owner: `workflow:${run.runId}`, generation: 1 }, attempts: { count: 1 } })
    expect(workers.started[0]!.runId).toBe(run.runId)
    workers.release(workers.started[0]!.id, { text: 'the answer' })

    const done = await settled(ctx, run.runId)
    expect(done).toMatchObject({ status: 'completed', answer: 'the answer' })
    const view = await reported(ctx, run.runId)
    expect(view.task?.outcome).toMatchObject({ status: 'accepted', state: 'done' })
    const board = (await ctx.board.task(task.taskId))!
    schemas.assertRecord(board)
    expect(seen).toEqual(['running'])
    expect(board).toMatchObject({ state: 'done', result: { artifacts: [done.result], subject: { type: 'artifact', ref: done.result } } })
    // The acceptance binds to the exact result: the task, its subject, and every artifact among its inputs.
    const acceptance = decisionOf(ctx, board.result!.acceptance)
    expect(acceptance).toMatchObject({ decisionType: 'acceptance', outcome: { option: 'accept', detail: { taskId: task.taskId, runId: run.runId, subject: { type: 'artifact', ref: done.result }, checks: {} } } })
    expect(acceptance.inputs).toEqual([done.result])
    expect(board.lastDecision).toBe(board.result!.acceptance)
    // The engine's choice to claim it is a decision, with a reason for every candidate (INV-13).
    const [taken] = decisionsOf(ctx, 'admission', 'workflow.task-admission')
    expect(taken).toMatchObject({ outcome: { option: 'claim', detail: { taskId: task.taskId } } })
    expect(taken!.candidates.every((c) => c.reasons.length > 0)).toBe(true)
    const events = ctx.eventLog.query({ runId: run.runId, limit: 100 }).map((e) => e.type)
    expect(events).toEqual(expect.arrayContaining(['workflow.run.started', 'workflow.run.completed', 'workflow.task.reported']))
    // The started event names the task and who started the run (PROP-0016 I4: a lead's start is a touch).
    const [started] = ctx.eventLog.query({ runId: run.runId, type: 'workflow.run.started', limit: 1 })
    expect(started?.data).toMatchObject({ template: 'solo', taskId: task.taskId, startedBy: 'lead' })
  })

  it('names in its failure the run a start the board did not answer admitted, which waits starting for the board\'s record, nothing of it run (T127 item 13, INV-2, INV-4)', async () => {
    const { ctx, workers } = await boot()
    await project(ctx)
    const task = await ready(ctx, 'unanswered')
    const original = { start: ctx.board.start.bind(ctx.board), task: ctx.board.task.bind(ctx.board) }
    let asked = false
    ctx.board.start = (async () => {
      asked = true
      throw new Error('the board store is busy')
    }) as never
    ctx.board.task = (async (taskId: string) => {
      if (asked) throw new Error('the board store is busy')
      return original.task(taskId)
    }) as never
    onTestFinished(() => {
      ctx.board.start = original.start
      ctx.board.task = original.task
    })
    const failure = await ctx.workflow.start({ template: 'solo', input: 'x', classification: 'public', task: { taskId: task.taskId } }).then(() => undefined, (error: unknown) => error as WorkflowFailure)
    expect(failure).toBeInstanceOf(WorkflowFailure)
    expect(failure).toMatchObject({ kind: 'overloaded', runId: expect.stringMatching(/^run_/), message: expect.stringMatching(/the run starts only once the board shows it recorded$/) })
    expect(ctx.workflow.get(failure!.runId!)).toMatchObject({ status: 'running', task: { taskId: task.taskId, phase: 'starting' } })
    expect(workers.started).toEqual([])
    // A refusal names no run: nothing was admitted.
    expect(await ctx.workflow.start({ template: 'solo', input: 'y', task: { taskId: 'task-unknown' } }).then(() => undefined, (error: unknown) => (error as WorkflowFailure).runId)).toBeUndefined()
  })

  it('serves one attempt with one run: concurrent starts on one claim admit one run, and a repeated clientRequestId returns it (INV-15, INV-4)', async () => {
    const { ctx, workers } = await boot()
    await project(ctx)
    const task = await ready(ctx, 'raced')
    const claim = await ctx.board.claim(task.taskId, 'lead', 120_000)
    const input = { template: 'solo', input: 'q', classification: 'public' as const, task: { taskId: task.taskId, holder: 'lead', generation: claim.generation } }
    const outcomes = await Promise.allSettled([ctx.workflow.start(input), ctx.workflow.start(input)])
    const admitted = outcomes.filter((o): o is PromiseFulfilledResult<RunView> => o.status === 'fulfilled')
    expect(admitted).toHaveLength(1)
    const refused = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected')!.reason as WorkflowFailure
    expect(refused).toBeInstanceOf(WorkflowFailure)
    expect(refused.kind).toBe('invalid_input')
    const run = admitted[0]!.value
    expect((await reported(ctx, run.runId)).task?.outcome).toMatchObject({ status: 'accepted', state: 'done' })
    expect(workers.started).toHaveLength(1)
    expect(ctx.workflow.usage()).toHaveLength(1)

    const next = await ready(ctx, 'keyed')
    const keyed = { template: 'solo', input: 'k', classification: 'public' as const, clientRequestId: 'k-1', task: { taskId: next.taskId } }
    const first = await ctx.workflow.start(keyed)
    expect((await ctx.workflow.start(keyed)).runId).toBe(first.runId)
    expect(await refusalOf(() => ctx.workflow.start({ ...keyed, task: { taskId: task.taskId } }))).toMatch(/clientRequestId was reused/)
    expect(decisionsOf(ctx, 'admission', 'workflow.task-admission').filter((d) => d.outcome.detail?.['taskId'] === next.taskId)).toHaveLength(1)
  })

  it('after a restart, reconciles a run whose holder was lost and reports it with reconcileRun, starting nothing new', async () => {
    const { ctx, workers, restartWorkflow } = await boot()
    await project(ctx)
    const task = await ready(ctx, 'restart')
    workers.reply = () => 'hold'
    const run = await ctx.workflow.start({ template: 'chain', input: 'q', classification: 'public', task: { taskId: task.taskId } })
    await until(() => workers.started.length === 1, 'step a started')
    await restartWorkflow(async () => {
      // The host was down past the lease: the board's sweep finds the holder lost mid-run and asks the operator.
      ctx.store.db.prepare('UPDATE leases SET expires_at = 1 WHERE resource = ?').run(`board-task:${task.taskId}`)
      await ctx.board.sweep(new Date())
      expect(await ctx.board.task(task.taskId)).toMatchObject({ state: 'waiting-for-approval', waiting: { reason: 'reconciliation-failed' } })
      // Step a's execution finished while the engine was down.
      workers.release(workers.started[0]!.id, { text: 'alpha' })
    })
    const view = await reported(ctx, run.runId)
    // Reconciled, never replayed: step a's result is taken, and step b never starts without the holder.
    expect(workers.started).toHaveLength(1)
    expect(view).toMatchObject({ status: 'failed', error: { kind: 'holder_lost' } })
    expect(view.nodes.map((n) => n.state)).toEqual(['COMPLETED', 'FAILED'])
    expect(view.task?.outcome).toMatchObject({ status: 'reconciled', state: 'ready' })
    expect(decisionOf(ctx, view.task!.lost)).toMatchObject({ decisionType: 'recovery', outcome: { option: 'wind-down' } })
    // The holder lapsed while the host was down: the host's failure, not the attempt's (ADR-0069).
    expect(decisionOf(ctx, view.task!.outcome!.decision)).toMatchObject({ outcome: { option: 'report', detail: { status: 'failed', infrastructure: { kind: 'host-stopped' } } } })
    const after = (await ctx.board.task(task.taskId))!
    expect(after).toMatchObject({ state: 'ready', attempts: { count: 0 } })
    // The pending reconciliation request was withdrawn once the move committed.
    expect((await ctx.approvals.list({ states: ['open', 'batched'] })).length).toBe(0)
  })

  it('fails a run whose result names a version of the written tree it is no longer at, and reports it failed (INV-5)', async () => {
    const tree = workingTree()
    const booted = await boot({ workspace: tree })
    ;(booted.workers as AgentWorkers).stale = true
    const { ctx } = booted
    await project(ctx)
    const { subject } = captureGitSubject(tree)!
    const task = await ready(ctx, 'stale tree', { writes: { type: 'git-head', ref: subject.ref } })
    const run = await ctx.workflow.start({ template: 'solo', input: 'change it', classification: 'public', task: { taskId: task.taskId } })
    expect(await settled(ctx, run.runId)).toMatchObject({ status: 'failed', error: { kind: 'stale_subject', message: expect.stringMatching(/is no longer git-head/) } })
    expect((await reported(ctx, run.runId)).task?.outcome).toMatchObject({ status: 'reconciled', state: 'ready' })
  })

  it('asks to fund a spent budget by lines computed from the ledger\'s count, which the operator sees and approves in the queue; the board raises exactly those, and the next attempt reserves on the store-backed ledger and runs (PROP-0010, INV-5, INV-13)', async () => {
    const { ctx, workers } = await boot({ resources: 'store' })
    await project(ctx)
    await poolOpen(ctx)
    const budget: BudgetLine[] = [{ pool: 'max.programmatic', unit: 'runs', amount: 2 }, { pool: 'max.programmatic', unit: 'usd', amount: 3 }]
    const task = await ready(ctx, 'spent', { budget })
    // What earlier work drew, as the ledger counts it for the task: both runs, and half a dollar past the usd line.
    await drew(ctx, task.taskId, 'r-1', { cost: { amount: 2, currency: 'USD', basis: 'runtime-estimate' } })
    await drew(ctx, task.taskId, 'r-2', { cost: { amount: 1.5, currency: 'USD', basis: 'runtime-estimate' } })
    const run = await ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: task.taskId } })
    expect(await settled(ctx, run.runId)).toMatchObject({ status: 'failed', error: { kind: 'budget_spent', message: expect.stringMatching(/asking to raise the budget by \+1 runs of max.programmatic, \+1.5 usd of max.programmatic/) } })
    expect(workers.started).toHaveLength(0)
    // Each spent line: what the task overdrew it by, plus one attempt's share of it (the line over its 3 attempts), at the unit's precision.
    const ask: BudgetLine[] = [{ pool: 'max.programmatic', unit: 'runs', amount: 1 }, { pool: 'max.programmatic', unit: 'usd', amount: 1.5 }]
    expect((await reported(ctx, run.runId)).task).toMatchObject({ budget: { state: 'refused', spent: true, blocked: true, funding: ask }, outcome: { status: 'blocked', state: 'waiting-for-approval' } })
    const blocked = (await ctx.board.task(task.taskId))!
    schemas.assertRecord(blocked)
    expect(blocked).toMatchObject({ schema: 'board-task@1.1', state: 'waiting-for-approval', waiting: { reason: 'budget-spent', funding: ask }, budget, attempts: { count: 1 } })

    // The operator reads the lines in the queue, and the verdict binds to exactly them (INV-5).
    const request = (await ctx.approvals.get(blocked.waiting!.approvalRequest!))!
    expect(request).toMatchObject({ action: { class: 'funding' }, subject: { type: 'content', ref: `board-task:${task.taskId}:attempt:1`, version: fundingVersion(contentId(ask)) } })
    expect(request.action.summary).toBe('budget-spent: spent; raise its budget by +1 runs of max.programmatic, +1.5 usd of max.programmatic')
    expect(request.action.consequences).toMatch(/^Approved: the board adds exactly \+1 runs of max.programmatic, \+1.5 usd of max.programmatic to the task's budget, which becomes 3 runs of max.programmatic, 4.5 usd of max.programmatic, and attempt 2 of 3/)
    const [verdict] = await ctx.approvals.decide([{ requestId: request.requestId, subject: request.subject, verdict: 'approved' }])
    expect(verdict?.refused).toBeUndefined()
    await ctx.board.sweep(new Date())
    const funded = (await ctx.board.task(task.taskId))!
    schemas.assertRecord(funded)
    expect(funded).toMatchObject({ state: 'ready', attempts: { count: 1 }, budget: [{ pool: 'max.programmatic', unit: 'runs', amount: 3 }, { pool: 'max.programmatic', unit: 'usd', amount: 4.5 }] })
    expect(funded.funding).toEqual([{ lines: ask, approval: verdict!.approval, decision: expect.stringMatching(/^sha256:/), at: expect.any(String) }])
    const raise = decisionOf(ctx, funded.funding![0]!.decision)
    expect(raise).toMatchObject({ decisionType: 'board', outcome: { option: 'funded', detail: { approvalRequest: request.requestId, funding: ask } } })
    const resolution = (await ctx.approvals.get(request.requestId))!.resolution!
    expect(raise.inputs).toEqual(expect.arrayContaining([resolution.decision, resolution.approval]))
    // Raised before the gate: the next attempt's readiness names the raise.
    expect(decisionOf(ctx, funded.lastDecision).inputs).toContain(funded.funding![0]!.decision)

    // The next attempt reserves within the raised lines, and runs.
    workers.reply = () => ({ text: 'funded work' })
    const second = await ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: task.taskId } })
    expect(await settled(ctx, second.runId)).toMatchObject({ status: 'completed', answer: 'funded work' })
    const view = await reported(ctx, second.runId)
    expect(view.task?.outcome).toMatchObject({ status: 'accepted', state: 'done' })
    expect(decisionOf(ctx, view.task!.budget!.decision)).toMatchObject({ decisionType: 'budget', outcome: { option: 'reserved', detail: { caps: funded.budget } } })
    expect(workers.started).toHaveLength(1)
    const brief = ctx.artifacts.get(workers.started[0]!.brief!)!.body as { budget: { remaining: unknown[] } }
    expect(brief.budget.remaining).toEqual([{ pool: 'max.programmatic', unit: 'runs', amount: 1 }, { pool: 'max.programmatic', unit: 'usd', amount: 1 }])
    expect(await ctx.board.task(task.taskId)).toMatchObject({ state: 'done', attempts: { count: 2 } })
  })

  it('refuses the next step on a spent budget across a restart of the engine while the first step runs: its reservation is kept, never made twice, and on the task\'s last attempt the run ends with no funding asked (retries-spent) (ADR-0047, ADR-0044, INV-4)', async () => {
    const { ctx, workers, restartWorkflow } = await boot({ resources: 'store' })
    await project(ctx)
    await poolOpen(ctx)
    const budget: BudgetLine[] = [{ pool: 'max.programmatic', unit: 'runs', amount: 1 }]
    const task = await ready(ctx, 'last two steps', { budget, maxAttempts: 1 })
    workers.reply = () => 'hold'
    const run = await ctx.workflow.start({ template: 'chain', input: 'q', classification: 'public', task: { taskId: task.taskId } })
    await until(() => workers.started.length === 1, 'the first step started')
    const holdsOf = (): Array<{ step: string; reservationId: string }> | undefined => (JSON.parse((ctx.store.db.prepare('SELECT budget FROM workflow_tasks WHERE run_id = ?').get(run.runId) as { budget: string }).budget) as { holds?: Array<{ step: string; reservationId: string }> }).holds
    const before = holdsOf()
    expect(before).toEqual([expect.objectContaining({ step: 'a:1:0', nodeId: 'a' })])
    const budgets = (): string[] => ctx.artifacts.list({ kind: 'decision', decisionType: 'budget', limit: 100 }).map((a) => a.body as Decision).filter((d) => d.outcome.detail?.['runId'] === run.runId).map((d) => d.outcome.option)

    // The engine stops while the step runs and starts again: the step is still in flight, so its hold stays, and nothing is reserved again.
    await restartWorkflow(async () => {
      await drew(ctx, task.taskId, 'step-a', { runId: workers.started[0]!.id })
    })
    await until(async () => (await ctx.workflow.wait(run.runId, 50)).status === 'running' && ctx.workflow.get(run.runId)!.task!.phase === 'started', 'the run resumed')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(holdsOf()).toEqual(before)
    expect(budgets()).toEqual(['reserved'])
    workers.release(workers.started[0]!.id, { text: 'the first half' })

    const failed = await settled(ctx, run.runId)
    expect(failed).toMatchObject({ status: 'failed', error: { kind: 'budget_spent', disposition: 'USER_ACTION' } })
    expect(failed.error!.message).toMatch(/no step of this run started after the 1 that ran before the refusal; it was the task's last attempt \(attempt 1 of 1\), so no funding was asked/)
    expect(workers.started).toHaveLength(1)
    expect(budgets()).toEqual(['reserved', 'refused'])
    await expect(ctx.resources.release(before![0]!.reservationId)).rejects.toMatchObject({ failure: 'unknown-reservation' })
    const view = await reported(ctx, run.runId)
    expect(view.task?.budget).toMatchObject({ state: 'refused', spent: true, lastAttempt: expect.any(String) })
    expect(view.task?.budget).not.toHaveProperty('blocked')
    expect(view.task?.outcome).toMatchObject({ status: 'reconciled', state: 'waiting-for-input' })
    expect((await ctx.board.task(task.taskId))!).toMatchObject({ state: 'waiting-for-input', waiting: { reason: 'retries-spent' }, attempts: { count: 1, max: 1 } })
    expect((await ctx.approvals.list({ states: ['open', 'batched', 'approved', 'rejected'] })).filter((r) => r.requester.taskId === task.taskId)).toEqual([])
  })

  it('reconciles a crash between the operator\'s approval and the board\'s move: the raise is applied once, adopting the request the dead move left, and the next attempt reserves and runs (INV-4)', async () => {
    const { ctx, workers, restartBoard } = await boot({ resources: 'store' })
    await project(ctx)
    await poolOpen(ctx)
    // A merge task asks before every attempt, so going on opens a request of its own.
    const proposed = await ctx.board.propose({ projectId: 'p1', title: 'merge it', goal: 'merge', acceptance: [{ id: 'a1', statement: 'merged' }], actionClass: 'merge', budget: [{ pool: 'max.programmatic', unit: 'runs', amount: 1 }] })
    await ctx.board.sweep(new Date())
    const approve = async (requestId: string): Promise<void> => {
      const request = (await ctx.approvals.get(requestId))!
      const [result] = await ctx.approvals.decide([{ requestId, subject: request.subject, verdict: 'approved' }])
      expect(result?.refused).toBeUndefined()
    }
    await approve((await ctx.board.task(proposed.taskId))!.waiting!.approvalRequest!)
    await ctx.board.sweep(new Date())
    await drew(ctx, proposed.taskId, 'r-merge')
    const run = await ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: proposed.taskId } })
    expect(await settled(ctx, run.runId)).toMatchObject({ status: 'failed', error: { kind: 'budget_spent' } })
    await reported(ctx, run.runId)
    const funding = (await ctx.board.task(proposed.taskId))!.waiting!
    expect(funding).toMatchObject({ reason: 'budget-spent', funding: [{ pool: 'max.programmatic', unit: 'runs', amount: 1 }] })
    await approve(funding.approvalRequest!)

    // The board's move dies after the queue took the next attempt's request and before the move committed.
    const request = StoreApprovals.prototype.request
    const died = vi.spyOn(StoreApprovals.prototype, 'request').mockImplementationOnce(async function (this: StoreApprovals, ...args: Parameters<typeof request>) {
      await request.apply(this, args)
      throw new Error('the host died before the board committed its move')
    })
    await ctx.board.sweep(new Date())
    died.mockRestore()
    expect((await ctx.board.task(proposed.taskId))!).toMatchObject({ state: 'waiting-for-approval', waiting: { reason: 'budget-spent' }, budget: [{ amount: 1 }] })
    const orphans = (await ctx.approvals.list({ states: ['open', 'batched'] })).filter((r) => r.requester.taskId === proposed.taskId)
    expect(orphans.map((r) => r.subject)).toEqual([{ type: 'content', ref: `board-task:${proposed.taskId}:attempt:1`, version: 'approval-needed' }])

    // Restarted, the board finds the approval still standing: it raises the budget once, and its gate adopts the request the dead move left.
    await restartBoard()
    await ctx.board.sweep(new Date())
    const funded = (await ctx.board.task(proposed.taskId))!
    schemas.assertRecord(funded)
    expect(funded).toMatchObject({ state: 'waiting-for-approval', waiting: { reason: 'approval-needed', approvalRequest: orphans[0]!.requestId }, budget: [{ amount: 2 }] })
    expect(funded.funding).toHaveLength(1)
    expect(await ctx.board.sweep(new Date())).toEqual({ tasks: [], projects: [] })
    expect((await ctx.approvals.list({ states: ['open', 'batched'] })).filter((r) => r.requester.taskId === proposed.taskId).map((r) => r.requestId)).toEqual([orphans[0]!.requestId])

    await approve(orphans[0]!.requestId)
    await ctx.board.sweep(new Date())
    expect((await ctx.board.task(proposed.taskId))!).toMatchObject({ state: 'ready', budget: [{ amount: 2 }] })
    workers.reply = () => ({ text: 'merged' })
    const second = await ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: proposed.taskId } })
    expect(await settled(ctx, second.runId)).toMatchObject({ status: 'completed', answer: 'merged' })
    expect(decisionOf(ctx, (await reported(ctx, second.runId)).task!.budget!.decision)).toMatchObject({ outcome: { option: 'reserved' } })
    expect(workers.started).toHaveLength(1)
  })

  it('refuses a task with a budget before taking it when no ledger is loaded, or its pool is not configured or not available, with nothing started (INV-2)', async () => {
    const bare = await boot()
    await project(bare.ctx)
    const unledgered = await ready(bare.ctx, 'no ledger', { budget: [{ pool: 'max.programmatic', unit: 'runs', amount: 3 }] })
    expect(await refusalOf(() => bare.ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: unledgered.taskId } }))).toMatch(/^config_error: task \S+ declares a budget, and no resource ledger is loaded/)

    const { ctx, workers } = await boot({ resources: true })
    await project(ctx)
    const unknown = await ready(ctx, 'unknown pool', { budget: [{ pool: 'nowhere', unit: 'runs', amount: 3 }] })
    expect(await refusalOf(() => ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: unknown.taskId } }))).toMatch(/^config_error: .*draws on pool nowhere, which the resource ledger does not configure/)
    // No reading yet: missing telemetry is not capacity.
    const unread = await ready(ctx, 'unread pool', { budget: [{ pool: 'max.programmatic', unit: 'runs', amount: 3 }] })
    expect(await refusalOf(() => ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: unread.taskId } }))).toMatch(/^overloaded: pool max.programmatic of task \S+'s budget is unavailable/)
    expect(workers.started).toHaveLength(0)
    expect(bare.workers.started).toHaveLength(0)
    for (const [c, t] of [[bare.ctx, unledgered], [ctx, unknown], [ctx, unread]] as const) expect(await c.board.task(t.taskId)).toMatchObject({ state: 'ready', attempts: { count: 0 } })
    expect(decisionsOf(ctx, 'admission', 'workflow.task-admission').filter((d) => d.outcome.option === 'refuse')).toHaveLength(2)
  })
})

describe('an attempt is not spent on an infrastructure failure (ADR-0069, D82 #3)', () => {
  /** The run's report to its task: its `reconciliation` decision, and the board's decision on the move it made. */
  const report = async (ctx: Context, runId: string): Promise<{ reported: Decision; board: Decision; task: BoardTask }> => {
    const view = await reported(ctx, runId)
    const task = (await ctx.board.task(view.task!.taskId))!
    return { reported: decisionOf(ctx, view.task!.outcome!.decision), board: decisionOf(ctx, task.lastDecision), task }
  }
  const chosen = (d: Decision): string => d.candidates.find((c) => c.selected)!.reasons.join(' ')

  it('keeps free retries within the board\'s bound: past it the failure counts, and a persistent one ends waiting for input with the reason (INV-9)', async () => {
    const { ctx, workers } = await boot({ boardConfig: { maxFreeRetries: 1 } })
    await project(ctx)
    const task = await ready(ctx, 'persistent', { maxAttempts: 1 })
    workers.reply = () => ({ fail: 'reauth_required', disposition: 'USER_ACTION', sent: false })
    const first = await ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: task.taskId } })
    const free = await report(ctx, first.runId)
    expect(free.task).toMatchObject({ state: 'ready', attempts: { count: 0 } })
    expect(free.board.outcome.detail).toMatchObject({ freeRetry: { used: 1, max: 1, counted: false } })
    const second = await ctx.workflow.start({ template: 'solo', input: 'q', classification: 'public', task: { taskId: task.taskId } })
    const counted = await report(ctx, second.runId)
    expect(counted.reported.outcome.detail).toMatchObject({ infrastructure: { kind: 'unsent' } })
    expect(counted.task).toMatchObject({ state: 'waiting-for-input', waiting: { reason: 'retries-spent' }, attempts: { count: 1, max: 1 } })
    expect(counted.board.outcome.detail).toMatchObject({ infrastructure: { kind: 'unsent' }, freeRetry: { used: 1, max: 1, counted: true } })
    expect(chosen(counted.board)).toMatch(/the task's 1 free retry is used \(board.maxFreeRetries; INV-9\), so this failure only on the infrastructure counts \(unsent: nothing of run /)
    // Each run's step tried its Worker twice (the engine's own attempts), sending nothing.
    expect(workers.started).toHaveLength(4)
  })
})
