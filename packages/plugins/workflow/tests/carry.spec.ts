import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard from '@tsuuanmi/system-board'
import type { ArtifactRef, BoardTask, TaskInput } from '@tsuuanmi/system-board-core'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { SchemaRegistry, sha256 } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { Carried, CarryStep, ExecutionInfrastructure, LandStep } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { activeProject, CONFIG, readyTask, type Rendered, type Reply, ScriptedWorkers } from '../conformance/workflow.ts'
import Workflow, { type NodeTemplate, type RunView, type TaskCarry } from '../src/index.ts'

// The engine's side of starting a board task's next attempt from its previous attempt's work
// (ADR-0061) over the store-backed board and approval queue; the source that holds the trees is
// scripted, so each answer to a carry is the test's.
vi.setConfig({ testTimeout: 60_000 })

const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  // A workspace write runs with lint required at acceptance (checks.spec's studio policy), so acceptance can send an attempt back.
  rules: [{ actionClass: 'read', mode: 'auto' }, { actionClass: 'workspace-write', mode: 'auto', requires: ['lint'] }, { actionClass: 'merge', mode: 'ask' }],
  default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

/** A writing step, then a step after it whose Worker may fail: T110a's develop and review, in miniature. */
const RELAY: NodeTemplate[] = [
  { nodeId: 'develop:1', objective: 'Change the tree', prompt: '{{input}}', capabilities: ['develop'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer' },
  { nodeId: 'check:1', objective: 'Check the change', prompt: 'Check the change', capabilities: ['reason'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', dependsOn: ['develop:1'] },
]

/**
 * A source that holds no Worker and carries as its script says; every step it is asked is kept. It
 * keeps an ended attempt's tree (the landing's `commit` step) only when `keeps`, else holds none; and
 * it runs a run's required checks, its lint as `lint` says.
 */
class Carrier {
  readonly steps: CarryStep[] = []
  /** The `commit` steps it was asked, to keep an ended attempt's tree. */
  readonly kept: LandStep[] = []
  /** The runs and worktrees it was asked to run required checks on. */
  readonly checked: Array<{ runId: string; workspace: string }> = []
  keeps = false
  lint: 'passed' | 'failed' = 'passed'
  answer: (step: CarryStep) => Carried | undefined | Promise<Carried | undefined> = (step) => ({
    outcome: 'carried', repository: '/repo', from: { branch: `system/run/${step.from.runId}`, commit: 'c'.repeat(40) },
    base: step.from.subject.ref, branch: `system/run/${step.runId}`, worktree: `/worktrees/${step.runId}`, carried: true,
  })

  register(ctx: Context): void {
    ctx.workers.register({
      name: 'carrier', describe: async () => [],
      start: () => {
        throw new Error('the carrier runs nothing')
      },
      get: () => undefined, wait: () => Promise.reject(new Error('the carrier runs nothing')),
      carry: async (step) => {
        this.steps.push(step)
        return this.answer(step)
      },
      land: async (step) => {
        if (step.step !== 'commit' || !this.keeps) return undefined
        this.kept.push(step)
        return { outcome: 'committed', repository: '/repo', branch: `system/run/${step.runId}`, head: 'e'.repeat(40), committed: true, base: { branch: 'main', sha: step.subject.ref }, contained: false, stat: '' }
      },
      check: async (step) => {
        this.checked.push({ runId: step.runId, workspace: step.workspace })
        const results = step.checks.map((check) => ({ check, outcome: this.lint, exitCode: this.lint === 'passed' ? 0 : 1, reason: `exited ${this.lint === 'passed' ? 0 : 1}` }))
        const evidence = ctx.artifacts.put({
          kind: 'evidence', bodySchema: 'check-run@1.0', classification: step.classification, producer: { type: 'system', ref: 'carrier' }, runId: step.runId,
          body: { schema: 'check-run@1.0', runId: step.runId, repository: step.workspace, workspace: step.workspace, subject: { type: 'git-head', ...step.subject }, setup: sha256('setup'), checks: results },
        }).id
        return { outcome: 'checked', results, evidence }
      },
    })
  }
}

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-carry-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  const repository = join(dir, 'repo')
  const git = (...args: string[]): string => execFileSync('git', ['-C', repository, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { encoding: 'utf8' }).trim()
  execFileSync('git', ['init', '-q', repository])
  writeFileSync(join(repository, 'a.c'), 'int a;\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  const ctx = new Context()
  const workers = new ScriptedWorkers()
  workers.worktreePerRun = { repository, runs: join(dir, 'runs') }
  const carrier = new Carrier()
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => {
      c.workers.register(workers.source(c))
      carrier.register(c)
    } }),
    ctx.plugin(StoreApprovals, { policies: [POLICY], sweepSeconds: 3600 }), ctx.plugin(StoreBoard, { sweepSeconds: 0 }),
  ]
  await Promise.all(fibers)
  fibers.push(ctx.plugin(Workflow, { ...CONFIG, templates: { relay: RELAY } }))
  await fibers.at(-1)
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  await activeProject(ctx)
  /** The engine stops (as at the host's stop) and starts again on the same store. */
  const restart = async (): Promise<void> => {
    await fibers.pop()!.dispose()
    fibers.push(ctx.plugin(Workflow, { ...CONFIG, templates: { relay: RELAY } }))
    await fibers.at(-1)
  }
  return { ctx, workers, carrier, head: git('rev-parse', 'HEAD'), restart }
}

type Booted = Awaited<ReturnType<typeof boot>>

/** How the step after the writing step fails; `infrastructure`, its source's word that only the infrastructure ended it (ADR-0069). */
type Failure = { fail: string; disposition: string; infrastructure?: ExecutionInfrastructure }

/** The scripted Workers: a writing step changes its run's worktree; the step after it fails as `failing` says, then answers. */
function script(b: Booted, failing: Failure[]): void {
  b.workers.reply = (request: Rendered): Reply => {
    if (request.requirement.capabilities.includes('develop')) {
      writeFileSync(join(b.workers.worktrees.get(request.runId!)!, 'a.c'), `int a = ${b.workers.started.length};\n`)
      return { text: 'changed a.c' }
    }
    const failure = failing.shift()
    return failure ? { ...failure, sent: true } : { text: 'checked' }
  }
}

const settledRun = async (ctx: Context, runId: string): Promise<RunView> => vi.waitFor(() => {
  const view = ctx.workflow.get(runId)
  if (view?.task?.phase !== 'reported') throw new Error(`run ${runId} is not reported yet`)
  return view
}, { timeout: 30_000, interval: 25 })
const attempt = async (ctx: Context, task: BoardTask): Promise<RunView> => settledRun(ctx, (await ctx.workflow.start({ template: 'relay', input: 'change a.c', classification: 'public', task: { taskId: task.taskId } })).runId)
const carryOf = (ctx: Context, runId: string): TaskCarry | undefined => ctx.workflow.get(runId)?.task?.carry
/**
 * An accepted result waits for its landing (T293); this spec mounts no landing, so it ends that wait
 * as a merge would, on a landing decision, before a next task writes the same commit.
 */
const landed = async (ctx: Context, taskId: string): Promise<BoardTask> => {
  const t = (await ctx.board.task(taskId))!
  expect(t).toMatchObject({ state: 'review', waiting: { reason: 'landing' } })
  const decision = ctx.artifacts.recordDecision({
    decisionType: 'gate', question: `Is board task ${taskId}'s accepted result merged?`, inputs: [t.result!.acceptance!],
    candidates: [{ option: 'merge', selected: true, reasons: ['merged, as this spec stands in for its landing'] }, { option: 'refuse', selected: false, reasons: ['not refused'] }],
    decider: { type: 'rule', id: 'workflow.landing', version: '1' }, outcome: { option: 'merge', detail: { taskId } }, deterministic: true,
  }, { producer: { type: 'system', ref: 'workflow' } }).id as ArtifactRef
  return ctx.board.landed!(taskId, { runId: t.run!.runId, acceptance: t.result!.acceptance!, outcome: 'merged', decision })
}
type Decision = { decisionType: string; decider: { id: string }; outcome: { option: string; detail: Record<string, unknown> } }
const decisionOf = (ctx: Context, ref: ArtifactRef): Decision => {
  const body = ctx.artifacts.get(ref)!.body as Decision & { schema: string }
  new SchemaRegistry().assertRecord(body)
  return body
}

/** A task that writes the repository at `head`, whose attempt 1 completes its writing step and then fails as `failure`. */
async function failedOnce(b: Booted, title: string, failure: Failure, extra: Partial<TaskInput> = { writes: { type: 'git-head', ref: b.head } }): Promise<{ task: BoardTask; first: RunView }> {
  script(b, [failure])
  const task = await readyTask(b.ctx, title, extra)
  const first = await attempt(b.ctx, task)
  expect(first).toMatchObject({ status: 'failed', error: { kind: failure.fail } })
  expect(first.nodes.find((n) => n.nodeId === 'develop:1')?.state).toBe('COMPLETED')
  return { task: (await b.ctx.board.task(task.taskId))!, first }
}

const BROKEN = { fail: 'session_broken', disposition: 'RECREATE_SESSION' }

describe('ctx.workflow starts a board task\'s next attempt from its previous attempt\'s work (ADR-0061)', () => {

  it('starts from HEAD, recorded with why, when no source holds the tree, when the source refuses, and when it cannot answer (REQ-WF-14, INV-2)', async () => {
    const b = await boot()
    const cases: Array<[string, (step: CarryStep) => Carried | undefined, RegExp]> = [
      ['nobody', () => undefined, /^no Worker source holds .* as the worktree of run run_/],
      ['refused', () => ({ outcome: 'refused', cause: 'moved', reason: 'the tree moved' }), /^source carrier did not carry it: the tree moved$/],
      ['throws', () => {
        throw new Error('the store failed')
      }, /^source carrier did not carry it: source carrier could not carry the worktree .* into run run_.*: the store failed$/],
    ]
    for (const [title, answer, reason] of cases) {
      b.carrier.answer = answer
      const { task } = await failedOnce(b, title, BROKEN)
      const before = b.workers.started.length
      const second = await attempt(b.ctx, task)
      expect(second.status).toBe('completed')
      const carry = carryOf(b.ctx, second.runId)!
      expect(carry).toMatchObject({ state: 'fresh', reason: expect.stringMatching(reason) })
      expect(carry.decisions.map((d) => decisionOf(b.ctx, d).outcome.option)).toEqual(['carry', 'fresh'])
      // No brief says the worktree holds anything.
      for (const started of b.workers.started.slice(before)) expect(started.prompt).not.toContain('already holds the change')
      // The task is done once it landed: the next one may write the same commit.
      expect((await landed(b.ctx, task.taskId)).state).toBe('done')
    }
    expect(b.ctx.eventLog.query({ type: 'workflow.task.carry' }).map((e) => e.data?.['state'])).toEqual(['fresh', 'fresh', 'fresh'])
  })

  it('keeps after a restart what a stop left unkept or unsaid: a change still pending is committed then, and one kept but not yet in the dossier is said then, once (T271, INV-4)', async () => {
    const b = await boot()
    const outcomeOf = (runId: string): Record<string, unknown> => JSON.parse((b.ctx.store.db.prepare('SELECT outcome FROM workflow_tasks WHERE run_id = ?').get(runId) as { outcome: string }).outcome)
    const leave = (runId: string, kept: Record<string, unknown>): void => void b.ctx.store.db.prepare('UPDATE workflow_tasks SET outcome = ? WHERE run_id = ?').run(JSON.stringify({ ...outcomeOf(runId), kept }), runId)
    const said = (taskId: string): string[] => b.ctx.workflow.dossier({ taskId, limit: 50 }).entries.filter((e) => e.text.includes('its change is kept as commit')).map((e) => e.commits![0]!)
    const settledKept = (runId: string) => vi.waitFor(() => {
      const kept = b.ctx.workflow.get(runId)?.task?.outcome?.kept
      if (!kept?.said) throw new Error(`run ${runId}'s change is not said yet`)
      return kept
    }, { timeout: 30_000, interval: 25 })

    // No source held the tree when the attempt ended; a stop is left as if it came before that was settled.
    const one = await failedOnce(b, 'pending', BROKEN)
    await settledKept(one.first.runId)
    leave(one.first.runId, { state: 'pending', at: '2026-10-26T12:00:00.000Z' })
    b.carrier.keeps = true
    await b.restart()
    expect(await settledKept(one.first.runId)).toMatchObject({ state: 'kept', commit: 'e'.repeat(40), branch: `system/run/${one.first.runId}` })
    expect(said(one.task.taskId)).toEqual(['e'.repeat(40)])

    // Kept, and a stop came before the dossier said it: said at the restart, once. (The first task is done first, once landed: one writer per subject, INV-15.)
    b.carrier.keeps = false
    expect((await attempt(b.ctx, one.task)).status).toBe('completed')
    await landed(b.ctx, one.task.taskId)
    const two = await failedOnce(b, 'unsaid', BROKEN)
    await settledKept(two.first.runId)
    leave(two.first.runId, { state: 'kept', commit: 'f'.repeat(40), branch: `system/run/${two.first.runId}`, at: '2026-10-26T12:00:00.000Z' })
    await b.restart()
    expect(await settledKept(two.first.runId)).toMatchObject({ state: 'kept', commit: 'f'.repeat(40), said: true })
    expect(said(two.task.taskId)).toEqual(['f'.repeat(40)])
  })
})
