/**
 * A review that converges (board T266, ADR-0075): every finding carries a severity (important, nit,
 * pre-existing) and its evidence; a second reviewer verifies each important finding against the code
 * before it can block; only a confirmed one starts a fix round; nits never do, and never hold the
 * result; a pre-existing finding proposes a follow-up task; a re-review reads only the change since
 * the last reviewed tree with the open findings, and a finding already answered is never counted
 * again. End to end over the store-backed board and approval queue and a git working tree; only
 * Worker execution is scripted. The parsing and the summary's count are checked on their own first.
 */
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
import { captureGitSubject, SchemaRegistry, sha256 } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { ArtifactRef, WorkerExecution } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import { activeProject, CONFIG, type Rendered, readyTask, ScriptedWorkers } from '../conformance/workflow.ts'
import Workflow, { type NodeTemplate, type RunView } from '../src/index.ts'
import { type Assessment, parseVotes, VERIFY_HEADING } from '../src/spec.ts'

vi.setConfig({ testTimeout: 120_000 })

const schemas = new SchemaRegistry()

/** `read` runs on auto; everything else (the charter, a remediation) asks. */
const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }], default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

const step = (nodeId: string, extra: Partial<NodeTemplate>): NodeTemplate => ({
  nodeId, objective: `Do ${nodeId}`, prompt: '{{input}}', capabilities: ['reason'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', ...extra,
})
/** A change only the author takes, and an exact-subject review of it, as algorithm-development's. */
const TEMPLATES: Record<string, NodeTemplate[]> = {
  change: [step('develop', { prompt: 'Develop: {{input}}', capabilities: ['develop', 'craft'] }), step('review', { prompt: 'Review: {{input}}', capabilities: ['review'], dependsOn: ['develop'] })],
}

/** Two reviewers of two provider families: the verification prefers the family the review did not run on. */
const WORKERS = [
  worker('w:author', { tier: 'standard', proves: ['develop', 'craft'] }),
  worker('w:reviewer-a', { schema: 'capability-descriptor@1.3', family: 'family-a', tier: 'standard', proves: ['review'] }),
  worker('w:reviewer-b', { schema: 'capability-descriptor@1.3', family: 'family-b', tier: 'standard', proves: ['review'] }),
]

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

function workingTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-severity-tree-'))
  const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { stdio: 'ignore' })
  git('init', '-q')
  writeFileSync(join(dir, 'calc.py'), 'def add(a, b):\n    return a - b\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** What a scripted reviewer answers to the nth review (1-based), and a verifier to the findings it is given. */
interface Script {
  review: (n: number, subject: string) => { verdict: string; findings: Array<Record<string, unknown>> }
  verify?: (ids: string[]) => Array<{ finding: string; vote: string; reason: string }>
}

async function boot(tree: string, script: Script): Promise<{ ctx: Context; workers: TreeWorkers }> {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-severity-'))
  const ctx = new Context()
  const workers = new TreeWorkers(tree, () => ctx.artifacts)
  workers.extra = WORKERS
  let reviews = 0
  workers.reply = (request: Rendered) => {
    if (request.prompt.includes(VERIFY_HEADING)) {
      const subject = /^Verified subject: (\S+)$/m.exec(request.prompt)![1]!
      const ids = [...request.prompt.matchAll(/^- (f\d+) important:/gm)].map((m) => m[1]!)
      return { text: '```json\n' + JSON.stringify({ subject, votes: script.verify?.(ids) ?? [] }) + '\n```' }
    }
    const subject = /^Subject: (\S+)$/m.exec(request.prompt)?.[1]
    if (subject) return { text: '```json\n' + JSON.stringify({ subject, ...script.review(++reviews, subject) }) + '\n```' }
    if (request.prompt.includes('Fix the blocking findings')) {
      writeFileSync(join(tree, 'calc.py'), 'def add(a, b):\n    return a + b\n')
      return { text: 'made add() add' }
    }
    writeFileSync(join(tree, 'calc.py'), 'def add(a, b):\n    return a - b  # checked\n')
    writeFileSync(join(tree, 'test_calc.py'), 'from calc import add\n')
    return { text: 'changed calc.py' }
  }
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

/** Start the change for a ready task of an active project. */
async function start(ctx: Context): Promise<string> {
  await activeProject(ctx)
  const task = await readyTask(ctx, 'make add() add')
  return (await ctx.workflow.start({ template: 'change', input: 'Fix add()', classification: 'public', task: { taskId: task.taskId } })).runId
}


/** A step's latest assessment: the one its latest passed exact-subject gate names. */
function assessmentOf(ctx: Context, runId: string, nodeId: string): Assessment & { schema: string; summary: string } {
  const node = ctx.workflow.explain(runId)!.nodes.find((n) => n.nodeId === nodeId)!
  const body = ctx.artifacts.get(node.review!.assessment)!.body as Assessment & { schema: string; summary: string }
  schemas.assertRecord(body)
  return body
}

const IMPORTANT = { severity: 'important', title: 'add() still subtracts', file: 'calc.py', line: 2, evidence: 'line 2 returns a - b, so add(1, 2) is -1, not 3', class: 'arithmetic sign' }
const NIT = { severity: 'nit', title: 'name the test after add()', file: 'test_calc.py' }

describe('severity, evidence, and the summary\'s count (ADR-0075)', () => {

  it('reads a verifier\'s votes by finding, and leaves a finding it did not vote on, or an answer on another subject, unverified', () => {
    expect(parseVotes(JSON.stringify({ subject: 's', votes: [{ finding: 'f1', vote: 'confirm', reason: 'line 2 subtracts' }, { finding: 'f9', vote: 'confirm' }] }), 's', ['f1', 'f2'])).toEqual({
      votes: { f1: { vote: 'confirm', reason: 'line 2 subtracts' }, f2: { vote: 'none', reason: 'the verifier gave no vote on it' } },
    })
    expect(parseVotes(JSON.stringify({ subject: 'other', votes: [{ finding: 'f1', vote: 'confirm' }] }), 's', ['f1']).votes.f1!.vote).toBe('none')
    // A vote without a reason (missing, empty, blank, or not text) does not count: the finding stays unverified.
    const reasonless = parseVotes(JSON.stringify({ subject: 's', votes: [
      { finding: 'f1', vote: 'confirm' }, { finding: 'f2', vote: 'confirm', reason: '' }, { finding: 'f3', vote: 'reject', reason: '   ' }, { finding: 'f4', vote: 'confirm', reason: 7 },
    ] }), 's', ['f1', 'f2', 'f3', 'f4'])
    expect(Object.values(reasonless.votes).map((v) => v.vote)).toEqual(['none', 'none', 'none', 'none'])
    expect(reasonless.votes.f1!.reason).toBe('the verifier voted confirm without a reason, so the vote does not count')
  })
})

describe('a review that converges (board T266)', () => {

  it('blocks on a confirmed important finding: its fix gets it with its class and the nits once as notes; the re-review reads the open finding, never counts an answered one again, and the run converges', async () => {
    const tree = workingTree()
    const { ctx, workers } = await boot(tree, {
      review: (n) => (n === 1 ? { verdict: 'changes-requested', findings: [IMPORTANT, NIT] } : { verdict: 'changes-requested', findings: [NIT] }),
      verify: (ids) => ids.map((finding) => ({ finding, vote: 'confirm', reason: 'line 2 returns a - b' })),
    })
    const runId = await start(ctx)
    const waiting = await until(() => {
      const view = ctx.workflow.get(runId)
      return view?.blocked?.kind === 'gate' && view.blocked.approvalRequest ? view.blocked.approvalRequest : undefined
    }, 'the fix to wait on the queue')
    // The gate waits after the verification: only the confirmed finding is the work.
    expect(ctx.workflow.get(runId)!.nodes.map((n) => n.nodeId)).toEqual(['develop', 'review', 'review:verify', 'review:approve:1', 'review:fix:1', 'review:review:2'])
    const request = (await ctx.approvals.get(waiting))!
    await ctx.approvals.decide([{ requestId: waiting, subject: request.subject, verdict: 'approved' }])
    const done = await reported(ctx, runId)
    expect(done.status).toBe('completed')
    const fix = workers.started.find((s) => s.prompt.includes('Fix the blocking findings'))!
    expect(fix.prompt).toContain('- add() still subtracts (calc.py:2)')
    expect(fix.prompt).toContain('Confirmed: line 2 returns a - b')
    expect(fix.prompt).toContain('a class of defect: "arithmetic sign". Fix every instance of the class')
    expect(fix.prompt).toMatch(/Optional notes \(nits; they never hold the change\)[^\n]*\n- f2: name the test after add\(\) \(test_calc.py\)/)
    // The re-review is shown the open finding to check and the answered nit not to raise again.
    const recheck = workers.started.filter((s) => /^Subject: /m.test(s.prompt)).at(-1)!
    expect(recheck.prompt).toContain('Open findings (sent to the fix')
    expect(recheck.prompt).toContain('- review#f1 important: add() still subtracts (calc.py:2) [class: arithmetic sign]')
    expect(recheck.prompt).toMatch(/Findings already answered[^\n]*\n- review#f2 nit: name the test after add\(\)/)
    // It raised the nit again: marked as a repeat, not counted, and the re-review approves with no issues.
    const again = assessmentOf(ctx, runId, 'review:review:2')
    expect(again.findings).toMatchObject([{ severity: 'nit', repeated: 'review#f2' }])
    expect(again).toMatchObject({ verdict: 'approve', said: 'changes-requested' })
    expect(again.summary).toMatch(/^no issues; nothing blocks\. 1 finding repeated one already answered, not counted\./)
    expect(done.nodes.some((n) => n.nodeId === 'review:review:2:verify')).toBe(false)
    expect(assessmentOf(ctx, runId, 'review').summary).toMatch(/^1 important \(1 confirmed, 0 not\), 1 nit; 1 confirmed important finding blocks/)
    expect(ctx.workflow.explain(runId)!.nodes.find((n) => n.nodeId === 'review')!.review!.findings[0]).toMatchObject({ id: 'f1', blocks: true, vote: 'confirm', place: 'calc.py:2', class: 'arithmetic sign' })
  })
})
