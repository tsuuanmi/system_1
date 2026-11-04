import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard, { type Config as BoardConfig } from '@tsuuanmi/system-board'
import type { ArtifactRef, BoardTask } from '@tsuuanmi/system-board-core'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import { LeaseLost } from '@tsuuanmi/system-board-core'
import Leases from '@tsuuanmi/system-leases'
import { captureGitSubject, sha256 } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { Checked, CheckStep, WorkerExecution } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import { activeProject, CONFIG, importantFinding, readyTask, type Rendered, ScriptedWorkers, TEMPLATES, verifierReply } from '../conformance/workflow.ts'
import Workflow from '../src/index.ts'

// A run's required checks (T151, ADR-0063): before a written result's acceptance, the engine has the
// source that holds its worktree run the checks the policy requires of it, on its exact tree, and
// reports each that ran to an exit code; over the store-backed board and approval queue. The source is
// scripted, so each check's outcome is the test's.
vi.setConfig({ testTimeout: 60_000 })

const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }, { actionClass: 'workspace-write', mode: 'auto', requires: ['tests', 'lint'] }, { actionClass: 'merge', mode: 'ask' }],
  default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

/** The policy of the red-on-base tests (T306c): the studio's, and the new check among the required ones. */
const REQUIRES_RED: AutonomyPolicy = { ...POLICY, schema: 'autonomy-policy@1.5', rules: POLICY.rules.map((r) => r.actionClass === 'workspace-write' ? { ...r, requires: ['tests', 'lint', 'red-on-base'] } : r) }
/** The same with a path map (ADR-0071), so that each change has a risk tier. */
const TIERED: AutonomyPolicy = { ...REQUIRES_RED, riskTiers: { version: 1, rules: [{ tier: 'light', note: 'documents', paths: ['docs/'] }, { tier: 'normal', note: 'sources', paths: ['src/'] }] } }

/** Scripted Workers whose results name a git working tree and the subject it is at, as an agent's do. */
class TreeWorkers extends ScriptedWorkers {
  private readonly results = new Map<string, ArtifactRef>()
  constructor(private readonly tree: string, private readonly artifacts: () => Context['artifacts']) {
    super()
  }

  override get(id: string): WorkerExecution | undefined {
    const execution = super.get(id)
    if (!execution?.result) return execution
    if (!this.results.has(id)) {
      const text = (this.artifacts().get(execution.result)!.body as { text: string }).text
      this.results.set(id, this.artifacts().put({
        kind: 'report', bodySchema: 'agent-result@1.1', classification: 'public', producer: { type: 'worker', ref: 'w:standard' },
        body: { schema: 'agent-result@1.1', worker: 'w:standard', runtime: 'scripted', runId: 'agent-run', promptHash: sha256(text), sandbox: 'workspace-write', text, workspace: this.tree, subject: captureGitSubject(this.tree)!.subject },
      }).id as ArtifactRef)
    }
    return { ...execution, result: this.results.get(id)! }
  }
}

type Outcome = 'passed' | 'failed' | 'error'

/** A source that holds no Worker and answers each run's checks as its script says, recording a check-run@1.0 as the agents source does. */
class Checker {
  readonly steps: CheckStep[] = []
  outcomes: Record<string, Outcome> = { tests: 'passed', lint: 'passed' }
  /** What a check's command reported it did not run, by check. */
  notRun: Record<string, string> = {}
  /** The failing lines a failed check's answer carries, by check (T270). */
  failures: Record<string, string[]> = {}
  refuse: Checked | undefined
  /** How many asks `refuse` answers, when set; every one when unset. */
  refuseTimes: number | undefined
  /** The next check runs until its caller's signal stops it (the host's stop cutting it), then throws as a cut check does. */
  cutNext = false
  /** The repository's checked-out branch the run's worktree was cut from, as the source tells it (`changes`); none when unset. */
  base: string | undefined
  /** The commit the run's worktree forked from, and its HEAD now, as the source tells them; the same commit when unset. */
  fork: { sha: string; head: string } | undefined
  /** The run's worktree. */
  workspace = ''
  private artifacts!: Context['artifacts']

  register(ctx: Context): void {
    this.artifacts = ctx.artifacts
    ctx.workers.register({
      name: 'checker', describe: async () => [],
      changes: async (runId) => this.base === undefined ? undefined : [{
        repository: '/repo', workspace: this.workspace, branch: `system/run/${runId}`, base: { branch: this.base, sha: this.fork?.sha ?? 'b'.repeat(40) }, head: this.fork?.head ?? 'b'.repeat(40), files: [], more: 0, truncated: false,
      }],
      start: () => {
        throw new Error('the checker runs no Worker')
      },
      get: () => undefined, wait: () => Promise.reject(new Error('the checker runs no Worker')),
      check: async (step, signal) => {
        this.steps.push(step)
        if (this.cutNext) {
          this.cutNext = false
          await new Promise<void>((resolve) => (signal?.aborted ? resolve() : signal?.addEventListener('abort', () => resolve(), { once: true })))
          throw signal?.reason ?? new Error('stopped')
        }
        if (this.refuse && (this.refuseTimes === undefined || this.refuseTimes-- > 0)) return this.refuse
        const results = step.checks.map((check) => {
          const outcome = this.outcomes[check] ?? 'error'
          return { check, outcome, ...(outcome === 'error' ? {} : { exitCode: outcome === 'passed' ? 0 : 1 }), reason: outcome === 'error' ? `no command for the ${check} check is configured` : `exited ${outcome === 'passed' ? 0 : 1}` }
        })
        const evidence = this.artifacts.put({
          kind: 'evidence', bodySchema: 'check-run@1.0', classification: step.classification, producer: { type: 'system', ref: 'checker' }, runId: step.runId,
          body: { schema: 'check-run@1.0', runId: step.runId, repository: step.workspace, workspace: step.workspace, subject: { type: 'git-head', ...step.subject }, setup: sha256('setup'), checks: results },
        }).id
        return { outcome: 'checked', results: results.map((r) => {
          const notRun = this.notRun[r.check]
          const failures = r.outcome === 'failed' ? this.failures[r.check] : undefined
          return { ...r, ...(notRun ? { notRun } : {}), ...(failures ? { failures } : {}) }
        }), evidence }
      },
    })
  }
}

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-checks-'))
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { stdio: 'ignore' })
  git('init', '-q')
  writeFileSync(join(dir, 'a.c'), 'int a;\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'a.c'), 'int a = 1;\n')
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const DEVELOP = [{ nodeId: 'develop', objective: 'Develop it', prompt: '{{input}}', capabilities: ['develop'], tier: 'standard' as const, conversation: 'temporary' as const, acceptance: 'acceptance.answer' }]
/** A change and an exact-subject review of it, as `algorithm-development`'s. */
const REVIEWED = [DEVELOP[0]!, { ...DEVELOP[0]!, nodeId: 'review', objective: 'Review it', prompt: 'Review: {{input}}', capabilities: ['review'], dependsOn: ['develop'] }]

/**
 * `onTree: false`: the Workers' results are plain reports, on no git working tree. `review`: the
 * reviewer's verdict on the exact subject it is given. `board`: the board's configuration.
 */
async function boot(checker: Checker | undefined, { onTree = true, review, board = {}, redOnBase, tiered = false }: { onTree?: boolean; review?: 'approve' | 'changes-requested'; board?: BoardConfig; redOnBase?: 'off' | 'warn' | 'on'; tiered?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-checks-db-'))
  const workspace = tree()
  if (checker) checker.workspace = workspace
  const ctx = new Context()
  const workers = onTree ? new TreeWorkers(workspace, () => ctx.artifacts) : new ScriptedWorkers()
  if (review) {
    workers.extra = [worker('w:reviewer', { tier: 'standard', proves: ['review'] })]
    const answer = workers.reply
    workers.reply = (request: Rendered) => {
      // A second reviewer confirms an important finding (ADR-0075).
      const verified = verifierReply(request.prompt)
      if (verified) return verified
      const subject = /^Subject: (\S+)$/m.exec(request.prompt)?.[1]
      if (!subject) return answer(request)
      const changes = review === 'changes-requested'
      return { text: '```json\n' + JSON.stringify({ subject, verdict: review, findings: [changes ? importantFinding('no test for a', 'a.c') : { severity: 'nit', title: 'no test for a', file: 'a.c' }] }) + '\n```' }
    }
  }
  const config = { ...CONFIG, approvalPollSeconds: 1, maxReviewCycles: 1, templates: { ...TEMPLATES, develop: DEVELOP, reviewed: REVIEWED }, ...(redOnBase ? { enforce: { redOnBase } } : {}) }
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => {
      c.workers.register(workers.source(c))
      checker?.register(c)
    } }),
    ctx.plugin(StoreApprovals, { policies: [redOnBase ? (tiered ? TIERED : REQUIRES_RED) : POLICY], sweepSeconds: 3600 }), ctx.plugin(StoreBoard, { sweepSeconds: 0, ...board }),
  ]
  await Promise.all(fibers)
  let engine = ctx.plugin(Workflow, config)
  await engine
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  await activeProject(ctx)
  const { subject } = captureGitSubject(workspace)!
  /** A board task writing the tree (or, `writes: false`, naming no write subject), of `actionClass`, its run started. */
  const task = async (actionClass: 'workspace-write' | 'read' = 'workspace-write', { writes = true, template = 'solo', criteria }: { writes?: boolean; template?: string; criteria?: string } = {}): Promise<{ taskId: string; runId: string }> => {
    const ready = await readyTask(ctx, 'tree', { ...(writes ? { writes: { type: 'git-head' as const, ref: subject.ref } } : {}), actionClass, ...(criteria ? { acceptance: [{ id: 'a1', statement: criteria }] } : {}) })
    const run = await ctx.workflow.start({ template, input: 'change it', classification: 'public', task: { taskId: ready.taskId } })
    return { taskId: ready.taskId, runId: run.runId }
  }
  /** The engine stops (its runs' turns aborted, as at the host's stop) and starts again on the same store. */
  const restart = async (): Promise<void> => {
    await engine.dispose()
    engine = ctx.plugin(Workflow, config)
    await engine
  }
  return { ctx, workspace, subject, task, restart }
}

/** An accepted writing result: it waits for its landing, never done before that lands it (T293). */
const LANDING = { state: 'review', waiting: { reason: 'landing' } } as const

/** The task once its run's result reached the board: done, held for the operator, accepted and waiting for its landing, or sent back. */
const settled = (ctx: Context, taskId: string): Promise<BoardTask> => vi.waitFor(async () => {
  const task = (await ctx.board.task(taskId))!
  if (task.state === 'running' || task.state === 'claimed' || (task.state === 'review' && !task.waiting)) throw new Error(`task ${taskId} is ${task.state}`)
  return task
}, { timeout: 30_000, interval: 25 })

type Acceptance = { decider: { id: string; version: string }; inputs: string[]; candidates: Array<{ selected: boolean; reasons: string[] }>; outcome: { option: string; detail: Record<string, unknown> } }
const acceptanceOf = (ctx: Context, runId: string, rule = 'workflow.task-acceptance'): Acceptance => {
  const found = ctx.artifacts.list({ kind: 'decision', decisionType: 'acceptance', runId }).map((a) => a.body as Acceptance).filter((b) => b.decider.id === rule)
  expect(found).toHaveLength(1)
  return found[0]!
}

describe('ctx.workflow runs a written result\'s required checks on its exact tree before its acceptance (T151, ADR-0063)', () => {
  it('accepts a task\'s result whose required checks passed on its tree, without the operator, the evidence among the decision\'s inputs (REQ-WF-15, INV-5, INV-13)', async () => {
    const checker = new Checker()
    const { ctx, workspace, subject, task } = await boot(checker)
    const { taskId, runId } = await task()
    const done = await settled(ctx, taskId)
    // Accepted, a writing result waits for its landing; it is done only once that lands it (T293).
    expect(done).toMatchObject(LANDING)
    expect(checker.steps).toEqual([{ runId, workspace, subject: { ref: subject.ref, version: subject.version }, checks: ['tests', 'lint'], classification: 'public' }])
    const acceptance = acceptanceOf(ctx, runId)
    expect(acceptance).toMatchObject({ decider: { version: '4' }, outcome: { option: 'accept', detail: { checks: { tests: true, lint: true }, checkRun: { source: 'checker', outcome: 'checked', asked: ['tests', 'lint'] } } } })
    const evidence = (acceptance.outcome.detail['checkRun'] as { evidence: string }).evidence
    expect(acceptance.inputs).toContain(evidence)
    expect(ctx.artifacts.get(evidence as ArtifactRef)).toMatchObject({ kind: 'evidence', bodySchema: 'check-run@1.0' })
    expect(done.result?.acceptance).toBeDefined()
  })

  it('sends a result whose check failed back as another attempt: a failed check is work for the lead, never the operator\'s (REQ-WF-15, INV-2)', async () => {
    const checker = new Checker()
    checker.outcomes = { tests: 'passed', lint: 'failed' }
    const { ctx, task } = await boot(checker)
    const { taskId, runId } = await task()
    const back = await settled(ctx, taskId)
    expect(back.state).toBe('ready')
    expect(back.attempts.count).toBe(1)
    const acceptance = acceptanceOf(ctx, runId)
    expect(acceptance.outcome).toMatchObject({ option: 'reject', detail: { checks: { tests: true, lint: false } } })
    expect(acceptance.candidates.find((c) => c.selected)!.reasons[0]).toMatch(/the run's own lint check failed on git-head/)
  })

  it('holds the result for the operator with each check that did not run to an exit code pending, and with every one pending when the source refuses or none can run them (INV-2)', async () => {
    const checker = new Checker()
    checker.outcomes = { tests: 'passed' }
    const half = await boot(checker)
    const one = await half.task()
    expect(await settled(half.ctx, one.taskId)).toMatchObject({ state: 'review', waiting: { reason: 'operator-review', pendingChecks: ['lint'] } })
    const acceptance = acceptanceOf(half.ctx, one.runId)
    expect(acceptance.outcome.detail['checks']).toEqual({ tests: true })
    expect(acceptance.candidates.find((c) => c.selected)!.reasons).toContainEqual(expect.stringContaining('its lint check did not run to an exit code on the result (no command for the lint check is configured); it stays pending'))

    const refusing = new Checker()
    refusing.refuse = { outcome: 'refused', cause: 'moved', reason: 'the worktree is now another tree' }
    const moved = await boot(refusing)
    const two = await moved.task()
    expect(await settled(moved.ctx, two.taskId)).toMatchObject({ state: 'review', waiting: { pendingChecks: ['tests', 'lint'] } })
    expect(acceptanceOf(moved.ctx, two.runId).outcome.detail).toMatchObject({ checkRun: { outcome: 'refused', cause: 'moved' } })

    // No source runs checks: as before, nothing is claimed, and the operator decides.
    const none = await boot(undefined)
    const three = await none.task()
    expect(await settled(none.ctx, three.taskId)).toMatchObject({ state: 'review', waiting: { pendingChecks: ['tests', 'lint'] } })
    expect(acceptanceOf(none.ctx, three.runId).outcome.detail).toMatchObject({ checkRun: { outcome: 'not-run', reason: expect.stringContaining('no Worker source holds the worktree') } })
  })

  it('holds for the operator a result whose checks could not start, an infrastructure error, and never sends it back as a failed attempt (INV-2)', async () => {
    const checker = new Checker()
    checker.outcomes = { tests: 'error', lint: 'error' }
    const { ctx, task } = await boot(checker)
    const { taskId, runId } = await task()
    const held = await settled(ctx, taskId)
    expect(held).toMatchObject({ state: 'review', waiting: { reason: 'operator-review', pendingChecks: ['tests', 'lint'] } })
    const acceptance = acceptanceOf(ctx, runId)
    expect(acceptance.outcome.option).toBe('accept')
    expect(acceptance.outcome.detail['checks']).toEqual({})
  })

  it('finishes a run whose acceptance was stored before its holder was lost on that acceptance, never asking its checks again: a failure is not replaced by a later pass (INV-4)', async () => {
    const checker = new Checker()
    checker.outcomes = { tests: 'passed', lint: 'failed' }
    const { ctx, task } = await boot(checker)
    const append = ctx.eventLog.append.bind(ctx.eventLog)
    let lost = 0
    // The run's lease lost as it finishes, after its acceptance was stored: the run's next turn takes it from there.
    vi.spyOn(ctx.eventLog, 'append').mockImplementation((event) => {
      if (event.type === 'workflow.run.completed' && !lost++) {
        // Asked again, its checks would pass now.
        checker.outcomes = { tests: 'passed', lint: 'passed' }
        throw new LeaseLost(`run:${event.runId}`, 'taken over')
      }
      return append(event)
    })
    const { taskId, runId } = await task()
    const back = await settled(ctx, taskId)
    expect(lost).toBe(2)
    expect(checker.steps).toHaveLength(1)
    expect(back.state).toBe('ready')
    expect(back.attempts.count).toBe(1)
    expect(acceptanceOf(ctx, runId).outcome).toMatchObject({ option: 'reject', detail: { checks: { tests: true, lint: false } } })
    expect(ctx.workflow.get(runId)).toMatchObject({ status: 'completed' })
  })

  describe('the red-on-base check, behind its enforce switch (T306c, ADR-0079, ADR-0078)', () => {

    it('on: a result whose new test fails on its base and passes on the result is accepted', async () => {
      const checker = new Checker()
      checker.outcomes = { tests: 'passed', lint: 'passed', 'red-on-base': 'passed' }
      const { ctx, task } = await boot(checker, { redOnBase: 'on' })
      const { taskId, runId } = await task()
      expect(await settled(ctx, taskId)).toMatchObject(LANDING)
      expect(acceptanceOf(ctx, runId).outcome).toMatchObject({ option: 'accept', detail: { checks: { tests: true, lint: true, 'red-on-base': true } } })
      // Not a refactor: its check is not told so.
      expect(checker.steps[0]).not.toHaveProperty('refactor')
    })
  })

  describe('a board task with no write subject (T165: the lead\'s parallel tasks on one repository)', () => {

    it('binds to the written tree a run whose writing step left its change in a commit, its worktree clean: changed is against the commit it forked from (T293)', async () => {
      const checker = new Checker()
      checker.base = 'dev'
      // The source cannot run the checks here: they stay pending, so no check binds the result to the tree.
      checker.refuse = { outcome: 'refused', cause: 'moved', reason: 'not checked in this test' }
      const { ctx, workspace, task } = await boot(checker, { review: 'approve' })
      const git = (...args: string[]): string => execFileSync('git', ['-C', workspace, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { encoding: 'utf8' }).trim()
      const fork = git('rev-parse', 'HEAD')
      git('commit', '-q', '-am', 'the change, committed')
      checker.fork = { sha: fork, head: git('rev-parse', 'HEAD') }
      const committed = captureGitSubject(workspace)!.subject
      const { taskId, runId } = await task('workspace-write', { writes: false, template: 'reviewed' })
      const held = await settled(ctx, taskId)
      expect(held).toMatchObject({ state: 'review', result: { subject: { type: 'git-head', ref: committed.ref, version: committed.version } } })
      expect(acceptanceOf(ctx, runId).outcome.detail).toMatchObject({ subject: { type: 'git-head', ref: committed.ref } })
    })
  })

  describe('the board\'s auto-accept rule (board.autoAccept, D80): the acceptance names the run\'s last review and where its result lands', () => {
    const AUTO: BoardConfig = { autoAccept: { projects: ['p1'], branches: ['dev'] } }

    it('lands a result whose review approved it and whose checks passed on it, on a listed branch: done without the operator, on the board\'s auto-accept decision', async () => {
      const checker = new Checker()
      checker.base = 'dev'
      const { ctx, subject, task } = await boot(checker, { review: 'approve', board: AUTO })
      const { taskId, runId } = await task('workspace-write', { template: 'reviewed' })
      const done = await settled(ctx, taskId)
      expect(done).toMatchObject(LANDING)
      const acceptance = acceptanceOf(ctx, runId)
      const review = acceptance.outcome.detail['review'] as { assessment: string }
      expect(acceptance.outcome).toMatchObject({
        option: 'accept',
        detail: { checks: { review: true, tests: true, lint: true }, review: { node: 'review', verdict: 'approve', blocking: 0, cycle: 1, maxCycles: 1, subject: { ref: subject.ref, version: subject.version } }, landing: { repository: '/repo', branch: 'dev' } },
      })
      expect(acceptance.inputs).toContain(review.assessment)
      const evidence = (acceptance.outcome.detail['checkRun'] as { evidence: string }).evidence
      expect(ctx.artifacts.get(done.lastDecision!)?.body).toMatchObject({ decider: { id: 'board.auto-accept' }, inputs: expect.arrayContaining([review.assessment, evidence]), outcome: { option: 'landing', detail: { branch: 'dev' } } })
      expect(done.result?.acceptance).toBeDefined()
      expect(ctx.artifacts.get(done.result!.acceptance!)?.body).toMatchObject({ decider: { id: 'workflow.task-acceptance' } })
      // Reported as accepted, and watched for its landing, whose merge asks the operator as before; done once it lands (T293).
      await vi.waitFor(() => expect(ctx.workflow.get(runId)?.task).toMatchObject({ phase: 'reported', outcome: { status: 'accepted', state: 'review' } }), { timeout: 30_000, interval: 25 })
    })
  })
})
