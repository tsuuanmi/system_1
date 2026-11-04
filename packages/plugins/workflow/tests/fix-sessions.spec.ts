/**
 * One task, one author session (board T232; operator 2026-10-26). A review's fix was routed like any
 * step and often ran on another account's Worker in a fresh context (T207, T213, T216), which re-read
 * everything and lost the author's reasoning. Now a fix continues the writing step's own session on its
 * Worker, the review's findings its next message; the reviewer stays independent, in a session of its
 * own; an author's Worker that cannot take the fix is waited on within a bound, or the session is
 * handed off, recorded; and each fix's result is its own commit of the run's review history, the
 * worktree's HEAD never moved.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Artifacts from '@tsuuanmi/system-artifacts'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { type Brief, captureGitSubject, sha256, startPrompt } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import { type ArtifactRef, type CapabilityDescriptor, type Landed, type LandStep, reviewRef, type WorkerExecution, type WorkerStart } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import { importantFinding, verifierReply } from '../conformance/workflow.ts'
import Workflow, { type NodeTemplate, type RunView } from '../src/index.ts'

vi.setConfig({ testTimeout: 120_000 })

const AUTHOR = worker('w:author', { schema: 'capability-descriptor@1.3', family: 'family-a', proves: ['develop', 'persistent-conversation'] })
const REVIEWER = worker('w:reviewer', { schema: 'capability-descriptor@1.3', family: 'family-c', proves: ['review'] })

/** As algorithm-development: the change is written in the run's session, then reviewed in a temporary one. */
const TEMPLATES: Record<string, NodeTemplate[]> = {
  change: [
    { nodeId: 'develop:1', objective: 'Change add()', prompt: 'Develop: {{input}}', capabilities: ['develop'], tier: 'standard', conversation: 'persistent', acceptance: 'acceptance.answer' },
    { nodeId: 'review:1', objective: 'Review the change', prompt: 'Review: {{input}}', dependsOn: ['develop:1'], capabilities: ['review'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer' },
  ],
}

/** As algorithm-development since T267: the author's own review, on the author's account, before anything else. */
const SELF: Record<string, NodeTemplate[]> = {
  selfcheck: [
    { nodeId: 'develop:1', objective: 'Change add()', prompt: 'Develop: {{input}}', capabilities: ['develop'], tier: 'standard', conversation: 'persistent', acceptance: 'acceptance.answer' },
    { nodeId: 'selfreview:1', objective: 'Review your own change', prompt: 'Self-review: {{input}}', dependsOn: ['develop:1'], capabilities: ['review'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', selfReview: 'develop:1' },
  ],
}

/** One start as the scripted runtime saw it: the prompt it read, the session's turns before it, and the conversation it resumed. */
type Seen = WorkerStart & { prompt: string; before: string[]; resumed?: string }

/**
 * A scripted agent runtime over one git working tree. A session stays on the Worker its first start
 * chose and keeps a native conversation (its transcript): a start that resumes it reads its earlier
 * turns. Its `land` commits the tree, only while it is exactly the subject asked, as an agent source's does.
 */
class AuthorWorkers {
  readonly seen: Seen[] = []
  readonly sessions = new Map<string, { worker: string; handle: string; turns: string[] }>()
  workers: CapabilityDescriptor[] = [AUTHOR, REVIEWER]
  reviews = 0
  private readonly executions = new Map<string, WorkerExecution>()

  constructor(readonly tree: string, private readonly ctx: () => Context) {}

  source() {
    return {
      name: 'authors',
      describe: async () => this.workers,
      start: (request: WorkerStart) => this.start(request),
      get: (id: string) => this.executions.get(id),
      wait: async (id: string) => this.executions.get(id)!,
      affinity: (sessionId: string) => {
        const session = this.sessions.get(sessionId)
        return session ? [session.worker] : undefined
      },
      handle: (sessionId: string) => this.sessions.get(sessionId)?.handle,
      land: async (step: LandStep): Promise<Landed | undefined> => this.land(step),
    }
  }

  private start(request: WorkerStart): WorkerExecution {
    const ctx = this.ctx()
    const prompt = startPrompt(request, (ref) => ctx.artifacts.get(ref)).prompt
    const brief = ctx.artifacts.get(request.brief!)!.body as Brief
    let session = request.sessionId ? this.sessions.get(request.sessionId) : undefined
    // A resume reads the conversation's earlier turns; anything else starts a new one.
    const resumed = brief.resume && session?.handle === brief.resume.nativeHandle ? session : undefined
    if (request.sessionId && !resumed) {
      session = { worker: session?.worker ?? request.worker, handle: `native-${request.sessionId}-${this.seen.length + 1}`, turns: [] }
      this.sessions.set(request.sessionId, session)
    }
    const before = session ? [...session.turns] : []
    session?.turns.push(prompt)
    this.seen.push({ ...request, prompt, before, ...(resumed ? { resumed: brief.resume!.nativeHandle } : {}) })
    const text = this.answer(prompt, before)
    const { subject } = captureGitSubject(this.tree)!
    const result = ctx.artifacts.put({
      kind: 'report', bodySchema: 'agent-result@1.1', classification: 'public', producer: { type: 'worker', ref: request.worker },
      body: { schema: 'agent-result@1.1', worker: request.worker, runtime: 'scripted', runId: `agent-${this.seen.length}`, promptHash: sha256(text), sandbox: 'workspace-write', text, workspace: this.tree, subject },
    }).id as ArtifactRef
    const execution: WorkerExecution = { id: `x-${this.seen.length}`, status: 'completed', submitted: true, result, decisions: [] }
    this.executions.set(execution.id, execution)
    return execution
  }

  /** The developer changes add(); the reviewer asks for a test once, then approves; a fix adds the test, saying whether it remembers its change. */
  private answer(prompt: string, before: string[]): string {
    // A second reviewer confirms the important finding (ADR-0075), in a session of its own.
    const verified = verifierReply(prompt)
    if (verified) return verified.text
    const subject = /^Subject: (\S+)$/m.exec(prompt)?.[1]
    if (subject) {
      const changes = ++this.reviews === 1
      return '```json\n' + JSON.stringify({ subject, verdict: changes ? 'changes-requested' : 'approve', findings: changes ? [importantFinding('no test for add()', 'calc.py')] : [] }) + '\n```'
    }
    if (prompt.includes('Fix the blocking findings')) {
      writeFileSync(join(this.tree, 'test_calc.py'), 'from calc import add\nassert add(1, 2) == 3\n')
      return before.some((turn) => turn.startsWith('Develop: ')) ? 'added a test, on top of the add() I changed' : 'added a test'
    }
    writeFileSync(join(this.tree, 'calc.py'), 'def add(a, b):\n    return a + b\n')
    return 'changed add()'
  }

  /** A `record`, as the worktree source makes it: the tree as a commit on the run's history ref, from an index of its own, HEAD untouched. */
  private land(step: LandStep): Landed | undefined {
    if (step.step !== 'record' || step.workspace !== this.tree) return undefined
    const now = captureGitSubject(this.tree)!.subject
    if (now.ref !== step.subject.ref || now.version !== step.subject.version) return { outcome: 'refused', cause: 'moved', reason: `the tree is not ${step.subject.ref}` }
    const ref = reviewRef(step.runId)
    const index = { GIT_INDEX_FILE: join(this.tree, '..', 'record-index') }
    git(this.tree, 'read-tree', 'HEAD', { env: index })
    git(this.tree, 'add', '--all', { env: index })
    const tree = git(this.tree, 'write-tree', { env: index }).trim()
    rmSync(index.GIT_INDEX_FILE, { force: true })
    let parent: string
    try {
      parent = git(this.tree, 'rev-parse', '--verify', '--quiet', ref).trim()
    } catch {
      parent = now.ref
    }
    if (git(this.tree, 'rev-parse', `${parent}^{tree}`).trim() === tree) return { outcome: 'recorded', repository: this.tree, ref, commit: parent, parent, recorded: false }
    const commit = git(this.tree, 'commit-tree', tree, '-p', parent, '-m', step.message).trim()
    git(this.tree, 'update-ref', ref, commit)
    return { outcome: 'recorded', repository: this.tree, ref, commit, parent, recorded: true }
  }
}

/** `git -C dir …`; a last argument `{ env }` adds to its environment. */
const git = (dir: string, ...args: Array<string | { env: Record<string, string> }>): string => {
  const last = args.at(-1)
  const env = typeof last === 'object' ? last.env : {}
  const words = args.filter((a): a is string => typeof a === 'string')
  return execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...words], { encoding: 'utf8', env: { ...process.env, ...env } })
}

async function boot(config: { fixSessionWaitMinutes?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'system-fix-sessions-'))
  const tree = join(dir, 'tree')
  execFileSync('git', ['init', '-q', '-b', 'main', tree])
  writeFileSync(join(tree, 'calc.py'), 'def add(a, b):\n    return a - b\n')
  git(tree, 'add', '.')
  git(tree, 'commit', '-q', '-m', 'init')
  const ctx = new Context()
  const workers = new AuthorWorkers(tree, () => ctx)
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'author-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => void c.workers.register(workers.source()) }),
    ctx.plugin(Workflow, { retryDelayMs: 100, templates: { ...TEMPLATES, ...SELF }, ...config }),
  ]
  await Promise.all(fibers)
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return { ctx, workers, tree }
}

const until = <T>(read: () => T | undefined, what: string, ms = 30_000): Promise<T> => vi.waitFor(() => {
  const value = read()
  if (!value) throw new Error(`timed out waiting for ${what}`)
  return value
}, { timeout: ms, interval: 25 })

/** Start the change, and approve its fix's plan once the run waits on it; `meanwhile` runs before the approval. */
async function runToFix(ctx: Context, meanwhile: () => void = () => {}): Promise<string> {
  const { runId } = ctx.workflow.start({ template: 'change', input: 'Fix add()', classification: 'public' })
  const blocked = await until(() => {
    const view = ctx.workflow.get(runId)
    return view?.blocked?.kind === 'gate' ? view.blocked as { plan: string } : undefined
  }, 'the fix\'s gate')
  meanwhile()
  ctx.workflow.approve(runId, { verdict: 'approved', plan: blocked.plan })
  return runId
}

const finished = (ctx: Context, runId: string): Promise<RunView> => until(() => {
  const view = ctx.workflow.get(runId)
  return view && view.status !== 'running' ? view : undefined
}, `run ${runId} to finish`, 60_000)

type Decision = { decider: { id: string }; outcome: { option: string; detail?: Record<string, unknown> }; candidates: Array<{ option: string; selected: boolean; reasons: string[] }> }
const decisions = (ctx: Context, runId: string, rule: string): Decision[] =>
  ctx.artifacts.list({ kind: 'decision', runId, limit: 1000 }).map((a) => a.body as Decision).filter((d) => d.decider.id === rule)

describe('one task, one author session (board T232)', () => {

  it('hands a lost author session off, recorded, its brief carrying the session\'s earlier turns', async () => {
    const { ctx, workers } = await boot()
    const runId = await runToFix(ctx, () => workers.sessions.clear())
    const done = await finished(ctx, runId)
    expect(done.status).toBe('completed')
    const develop = workers.seen[0]!
    const developResult = ctx.workflow.records(runId).find((r) => r.nodeId === 'develop:1')!.outputReceipt!.result
    const [handoff] = decisions(ctx, runId, 'workflow.fix-session')
    expect(handoff).toMatchObject({ outcome: { option: 'handoff', detail: { sessionId: develop.sessionId, author: 'develop:1', carried: [developResult] } } })
    expect(handoff!.outcome.detail!.lost).toBe(`no Worker keeps session ${develop.sessionId} now`)
    const fix = workers.seen.find((s) => s.prompt.includes('Fix the blocking findings'))!
    // A new conversation of the same session, handed what the lost one held.
    expect(fix).toMatchObject({ sessionId: develop.sessionId })
    expect(fix.resumed).toBeUndefined()
    expect(fix.prompt).toContain('changed add()')
  })
})
