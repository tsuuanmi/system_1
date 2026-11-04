import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard from '@tsuuanmi/system-board'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { captureGitSubject, sha256 } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { ArtifactRef, WorkerExecution } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import { activeProject, CONFIG, readyTask, ScriptedWorkers } from '../conformance/workflow.ts'
import Workflow, { type DossierCaller, type NodeTemplate, type RunView } from '../src/index.ts'

// The task dossier (docs/design/task-dossier.md, ADR-0070), end to end over the store-backed board and
// approval queue and a git working tree; only Worker execution is scripted.
vi.setConfig({ testTimeout: 120_000 })


/** `read` runs on auto; everything else (the charter, a remediation) asks. */
const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }], default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

const step = (nodeId: string, extra: Partial<NodeTemplate>): NodeTemplate => ({
  nodeId, objective: `Do ${nodeId}`, prompt: '{{input}}', capabilities: ['reason'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', ...extra,
})
/**
 * A change (a writing step: `develop`) only Workers that also prove `craft` take, and an exact-subject
 * review of it: blocking findings grow a fix (on the same capabilities) behind the approval queue, then a re-review.
 */
const TEMPLATES: Record<string, NodeTemplate[]> = {
  change: [step('develop', { prompt: 'Develop: {{input}}', capabilities: ['develop', 'craft'] }), step('review', { prompt: 'Review: {{input}}', capabilities: ['review'], dependsOn: ['develop'] })],
  solo: [step('solo', {})],
}

/** Scripted Workers that answer as agents in one git working tree, each result an `agent-result@1.1` on the tree's subject then. */
class TreeWorkers extends ScriptedWorkers {
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
        kind: 'report', bodySchema: 'agent-result@1.1', classification: 'public', producer: { type: 'worker', ref: 'w:agent' },
        body: { schema: 'agent-result@1.1', worker: 'w:agent', runtime: 'scripted', runId: `agent-${id}`, promptHash: sha256(text), sandbox: 'workspace-write', text, workspace: this.workspace, subject },
      }).id as ArtifactRef)
    }
    return { ...execution, result: this.results.get(id)! }
  }
}

/** A git working tree with a commit. */
function workingTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-dossier-tree-'))
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { stdio: 'ignore' })
  git('init', '-q')
  writeFileSync(join(dir, 'calc.py'), 'def add(a, b):\n    return a - b\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** The engine over the store-backed board and queue; with `tree`, its Workers answer as agents in that working tree. */
async function boot(tree?: string): Promise<{ ctx: Context; workers: ScriptedWorkers }> {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-dossier-'))
  const ctx = new Context()
  const workers = tree ? new TreeWorkers(tree, () => ctx.artifacts) : new ScriptedWorkers()
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => void c.workers.register(workers.source(c)) }),
    ctx.plugin(StoreApprovals, { policies: [POLICY], sweepSeconds: 3600 }), ctx.plugin(StoreBoard, { sweepSeconds: 0 }),
  ]
  await Promise.all(fibers)
  const engine = ctx.plugin(Workflow, { ...CONFIG, approvalPollSeconds: 1, templates: TEMPLATES })
  await engine
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  return { ctx, workers }
}

const until = <T>(read: () => T | undefined | Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => vi.waitFor(async () => {
  const value = await read()
  if (!value) throw new Error(`timed out waiting for ${what}`)
  return value
}, { timeout: ms, interval: 25 })

const reported = (ctx: Context, runId: string): Promise<RunView> => until(() => {
  const view = ctx.workflow.get(runId)
  return view?.task?.phase === 'reported' ? view : undefined
}, `run ${runId}'s report`, 60_000)



describe('a board task\'s dossier (ADR-0070)', () => {

  it('binds a reviewer\'s own entry to the subject its step reviews, and still writes the review\'s assessed entry, its result and assessment linked', async () => {
    const tree = workingTree()
    const { ctx, workers } = await boot(tree)
    workers.extra = [worker('w:author', { tier: 'standard', proves: ['develop', 'craft'] }), worker('w:reviewer', { tier: 'standard', proves: ['review'] })]
    workers.reply = (request) => {
      if (/^Subject: (\S+)$/m.test(request.prompt)) return 'hold'
      writeFileSync(join(tree, 'calc.py'), 'def add(a, b):\n    return a + b\n')
      return { text: 'changed calc.py' }
    }
    await activeProject(ctx)
    const task = await readyTask(ctx, 'make add() add')
    const run = await ctx.workflow.start({ template: 'change', input: 'Fix add()', classification: 'public', task: { taskId: task.taskId } })
    const held = await until(() => workers.started.find((s) => s.worker === 'w:reviewer'), 'the reviewer\'s execution')
    await until(() => ctx.workflow.get(run.runId)?.nodes.find((n) => n.nodeId === 'review' && n.state === 'RUNNING'), 'the review step running')
    const subject = /^Subject: (\S+)$/m.exec(held.prompt)![1]!
    const reviewStep: DossierCaller = { runId: run.runId, nodeId: 'review', execution: held.id }
    const OWN = 'Read calc.py: add() now adds; no test covers it, which is not blocking.'
    ctx.workflow.appendToDossier(reviewStep, { kind: 'review', text: OWN })
    workers.release(held.id, { text: '```json\n' + JSON.stringify({ subject, verdict: 'approve', findings: [{ severity: 'info', title: 'no test covers add()', file: 'calc.py' }] }) + '\n```' })
    expect((await reported(ctx, run.runId)).status).toBe('completed')

    const page = ctx.workflow.dossier({ taskId: task.taskId })
    const reviews = page.entries.filter((e) => e.kind === 'review')
    expect(reviews.map((e) => e.author.ref)).toEqual(['w:reviewer', 'w:reviewer'])
    const [own, assessed] = reviews as [typeof reviews[0], typeof reviews[0]]
    // The reviewer's own entry: its text as written, bound to the subject the step reviews (never one it names).
    expect(own.text).toBe(OWN)
    expect(own.subject).toMatchObject({ type: 'git-head' })
    // The engine's entry: the verdict and findings from the stored assessment, bound to the same subject, the result linked.
    const reviewResult = ctx.workflow.records(run.runId).find((r) => r.nodeId === 'review')!.outputReceipt!.result
    expect(assessed.seq).toBeGreaterThan(own.seq)
    expect(assessed.text).toMatch(/: approve, 1 finding\. Its result and assessment are linked\. The reviewer's own entry precedes this one\./)
    expect(assessed.subject).toEqual(own.subject)
    expect(assessed.refs).toContain(reviewResult)
    expect(assessed.refs!.length).toBe(3)
  })
})
