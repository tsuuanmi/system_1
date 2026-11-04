import type { Context } from '@deepseek-ai/cordis'
import { SchemaRegistry } from '@tsuuanmi/system-libs'
import type { WorkChange } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ArtifactRef } from '@tsuuanmi/system-board-core'
import { activeProject } from '../../workflow/conformance/workflow.ts'
import { acceptanceOf, checkStates, requiredChecks } from '../src/index.ts'
import { boot, bundlePolicies, reviewed } from './store-backed.ts'

// End to end over the store-backed board, approval queue, and engine, under the bundle's own
// default studio policy, with the operator's verdicts through the web UI's API. Only Worker
// execution is scripted.
vi.setConfig({ testTimeout: 120_000 })

const schemas = new SchemaRegistry()

describe('web UI: the operator accepts or rejects a board review held for the operator', () => {
  it('holds a workspace-write task\'s review past its run\'s lease, lists it with its pending checks, and takes only the operator\'s acceptance: done', async () => {
    const { ctx, call, client } = await boot()
    await activeProject(ctx)
    const { task, run } = await reviewed(ctx, 'kernel')
    schemas.assertRecord(task)
    expect(task).toMatchObject({ state: 'review', waiting: { reason: 'operator-review', pendingChecks: ['tests', 'lint'] } })
    expect(task.holder).toBeUndefined()
    // The bundle's policy: the operator has a day (expiry.defaultSeconds), not a lease's ten minutes.
    expect(Date.parse(task.waiting!.expiresAt) - Date.parse(task.waiting!.since)).toBe(86_400_000)
    await ctx.board.sweep(new Date(Date.now() + 11 * 60_000))
    expect(await ctx.board.task(task.taskId)).toMatchObject({ state: 'review', waiting: { reason: 'operator-review' } })

    const listed = await call('reviews')
    expect(listed.status).toBe(200)
    expect(listed.value.reviews).toEqual([expect.objectContaining({
      taskId: task.taskId, project: { projectId: 'p1', title: 'project p1' }, subject: task.result!.subject, artifacts: [run.result],
      pendingChecks: ['tests', 'lint'], run: expect.objectContaining({ runId: run.runId }), heldFor: 'operator', expiresAt: task.waiting!.expiresAt,
    })])
    // Each check the policy requires, with its state (ADR-0063, T160): the run recorded neither, so both are pending, never passed.
    expect((listed.value.reviews as Array<Record<string, unknown>>)[0]!.checks).toEqual({ value: [
      { check: 'tests', state: 'pending', why: 'the run recorded no result of it' },
      { check: 'lint', state: 'pending', why: 'the run recorded no result of it' },
    ] })

    // Only the operator's channel decides (INV-6): a client token is refused by the guard before any route.
    expect((await call(`reviews/${task.taskId}/decide`, { verdict: 'accept', subject: task.result!.subject }, client)).status).toBe(401)
    // The verdict binds to the result the page showed (INV-5).
    expect((await call(`reviews/${task.taskId}/decide`, { verdict: 'accept', subject: { ...task.result!.subject, ref: 'sha256:other' } })).status).toBe(409)
    expect((await call(`reviews/${task.taskId}/decide`, { verdict: 'maybe', subject: task.result!.subject })).status).toBe(400)
    expect(await ctx.board.task(task.taskId)).toMatchObject({ state: 'review' })

    const decided = await call(`reviews/${task.taskId}/decide`, { verdict: 'accept', subject: task.result!.subject, note: 'checked by hand' })
    expect(decided.status).toBe(200)
    expect(decided.value.task).toMatchObject({ state: 'done' })
    const done = (await ctx.board.task(task.taskId))!
    schemas.assertRecord(done)
    expect(done).toMatchObject({ state: 'done', result: { acceptance: decided.value.decision } })
    const envelope = ctx.artifacts.get(done.result!.acceptance!)!
    expect(envelope.producer).toMatchObject({ type: 'operator' })
    expect(envelope.body).toMatchObject({
      decisionType: 'acceptance', decider: { type: 'operator' }, rationale: 'checked by hand',
      outcome: { option: 'accept', detail: { taskId: task.taskId, subject: task.result!.subject } }, inputs: [run.result],
    })
    expect((await call('reviews')).value.reviews).toEqual([])
  })

  it('accepts a writing result past a check that did not run only when the operator names it with why, on a decision of its own, and then it waits for its landing (T293)', async () => {
    const { ctx, call } = await boot()
    await activeProject(ctx)
    // A writing result (an agent result names the run's worktree at its tree), whose run recorded tests passed and lint not run.
    const proposed = await ctx.board.propose({ projectId: 'p1', title: 'lint never ran', goal: 'change it', acceptance: [{ id: 'a1', statement: 'tests pass', check: 'tests' }], actionClass: 'workspace-write' })
    await ctx.board.sweep(new Date())
    const { generation } = await ctx.board.claim(proposed.taskId, 'lead', 600_000)
    await ctx.board.start(proposed.taskId, generation, { runId: 'run-lint' })
    const subject = { type: 'git-head' as const, ref: 'a'.repeat(40), version: 'b'.repeat(64) }
    const result = ctx.artifacts.put({
      kind: 'report', bodySchema: 'agent-result@1.1', classification: 'operator-shared', producer: { type: 'worker', ref: 'test' },
      body: { schema: 'agent-result@1.1', worker: 'w', runtime: 'fake', runId: 'r', promptHash: `sha256:${'0'.repeat(64)}`, sandbox: 'workspace-write', text: 'changed it', workspace: '/work/tree', subject },
    }).id as ArtifactRef
    await ctx.board.submit(proposed.taskId, generation, { artifacts: [result], subject })
    const own = ctx.artifacts.recordDecision({
      decisionType: 'acceptance', question: 'Does run-lint complete it?', inputs: [result],
      candidates: [{ option: 'accept', selected: true, reasons: ['its steps were accepted'] }, { option: 'reject', selected: false, reasons: ['not reject'] }],
      decider: { type: 'rule', id: 'workflow.task-acceptance', version: '4' }, outcome: { option: 'accept', detail: { taskId: proposed.taskId, subject, checks: { tests: true } } }, deterministic: true,
    }, { producer: { type: 'system', ref: 'workflow' }, runId: 'run-lint' }).id as ArtifactRef
    expect(await ctx.board.accept(proposed.taskId, own)).toMatchObject({ state: 'review', waiting: { reason: 'operator-review', pendingChecks: ['lint'] } })

    // A plain acceptance is refused, naming the check: nothing is decided.
    const plain = await call(`reviews/${proposed.taskId}/decide`, { verdict: 'accept', subject })
    expect(plain.status).toBe(409)
    expect(plain.value.error).toMatch(/required check\(s\) lint have not passed on it/)
    // A check named wrongly, or with no why, is refused before anything is decided.
    expect((await call(`reviews/${proposed.taskId}/decide`, { verdict: 'accept', subject, checksNotRun: { lint: '  ' } })).status).toBe(400)
    expect((await call(`reviews/${proposed.taskId}/decide`, { verdict: 'accept', subject, checksNotRun: { review: 'no' } })).status).toBe(400)
    expect((await call(`reviews/${proposed.taskId}/decide`, { verdict: 'reject', subject, checksNotRun: { lint: 'why' } })).status).toBe(400)
    expect(await ctx.board.task(proposed.taskId)).toMatchObject({ state: 'review', waiting: { reason: 'operator-review' } })

    const decided = await call(`reviews/${proposed.taskId}/decide`, { verdict: 'accept', subject, checksNotRun: { lint: 'no lint command is configured for this repository' } })
    expect(decided.status).toBe(200)
    expect(decided.value.task).toMatchObject({ state: 'review', waiting: { reason: 'landing' }, result: { acceptance: decided.value.decision } })
    expect(ctx.artifacts.get(decided.value.decision as string)!.body).toMatchObject({ decider: { type: 'operator' }, outcome: { option: 'accept', detail: { checksNotRun: { lint: 'no lint command is configured for this repository' } } } })
    const task = (await ctx.board.task(proposed.taskId))!
    schemas.assertRecord(task)
    expect(ctx.artifacts.get(task.lastDecision!)!.body).toMatchObject({ outcome: { detail: { reason: 'checks-not-run', checksNotRun: [{ check: 'lint', note: 'no lint command is configured for this repository' }] } } })
  })

  it('lists a result accepted and waiting for its landing as accepted, never as a review to decide, and leaves it out of the counts (T334)', async () => {
    const { ctx, call } = await boot()
    await activeProject(ctx)
    // A real run gives the landing its row; the writing task below is served by that run's id.
    const { task: carrier, run } = await reviewed(ctx, 'carrier')
    const proposed = await ctx.board.propose({ projectId: 'p1', title: 'lands later', goal: 'change it', acceptance: [{ id: 'a1', statement: 'tests pass', check: 'tests' }], actionClass: 'workspace-write' })
    await ctx.board.sweep(new Date())
    const { generation } = await ctx.board.claim(proposed.taskId, 'lead', 600_000)
    await ctx.board.start(proposed.taskId, generation, { runId: run.runId })
    const subject = { type: 'git-head' as const, ref: 'a'.repeat(40), version: 'b'.repeat(64) }
    const result = ctx.artifacts.put({
      kind: 'report', bodySchema: 'agent-result@1.1', classification: 'operator-shared', producer: { type: 'worker', ref: 'test' },
      body: { schema: 'agent-result@1.1', worker: 'w', runtime: 'fake', runId: 'r', promptHash: `sha256:${'0'.repeat(64)}`, sandbox: 'workspace-write', text: 'changed it', workspace: '/work/tree', subject },
    }).id as ArtifactRef
    await ctx.board.submit(proposed.taskId, generation, { artifacts: [result], subject })
    const own = ctx.artifacts.recordDecision({
      decisionType: 'acceptance', question: 'Does the run complete it?', inputs: [result],
      candidates: [{ option: 'accept', selected: true, reasons: ['its steps were accepted'] }, { option: 'reject', selected: false, reasons: ['not reject'] }],
      decider: { type: 'rule', id: 'workflow.task-acceptance', version: '4' }, outcome: { option: 'accept', detail: { taskId: proposed.taskId, subject, checks: { tests: true } } }, deterministic: true,
    }, { producer: { type: 'system', ref: 'workflow' }, runId: run.runId }).id as ArtifactRef
    expect(await ctx.board.accept(proposed.taskId, own)).toMatchObject({ state: 'review', waiting: { reason: 'operator-review' } })
    // Held for the operator it is a review to decide, as before.
    const held = await call('reviews')
    expect((held.value.reviews as Array<{ taskId: string }>).map((r) => r.taskId)).toContain(proposed.taskId)
    // The operator accepts it: it waits for its landing.
    const decided = await call(`reviews/${proposed.taskId}/decide`, { verdict: 'accept', subject, checksNotRun: { lint: 'no lint command is configured' } })
    expect(decided.status).toBe(200)
    expect(await ctx.board.task(proposed.taskId)).toMatchObject({ state: 'review', waiting: { reason: 'landing' } })
    ctx.store.db.prepare('UPDATE workflow_tasks SET landing = ? WHERE run_id = ?').run(JSON.stringify({ branch: `system/run/${run.runId}`, at: '2026-10-28T10:00:00.000Z', state: 'committed', head: 'b'.repeat(40), base: { branch: 'main', sha: 'a'.repeat(40) } }), run.runId)

    const listed = await call('reviews')
    const ids = (list: unknown) => (list as Array<{ taskId: string }>).map((r) => r.taskId)
    expect(ids(listed.value.reviews)).toEqual([carrier.taskId])
    expect(ids(listed.value.accepted)).toContain(proposed.taskId)
    expect((listed.value.accepted as Array<{ taskId: string; landing: { state: string } }>).find((a) => a.taskId === proposed.taskId)!.landing.state).toBe('committed')
    // Home's count and the held reviews' expiry leave it out: only the carrier's review is counted.
    expect((await call('waiting')).value.reviews).toEqual({ value: 1, firstExpires: carrier.waiting!.expiresAt })
  })

  it('takes the operator\'s rejection as another attempt, through the gate', async () => {
    const { ctx, call } = await boot()
    await activeProject(ctx)
    const { task } = await reviewed(ctx, 'rejected')
    const decided = await call(`reviews/${task.taskId}/decide`, { verdict: 'reject', subject: task.result!.subject })
    expect(decided.status).toBe(200)
    const again = (await ctx.board.task(task.taskId))!
    expect(again).toMatchObject({ state: 'ready', attempts: { count: 1, max: 2 } })
    expect(again.waiting).toBeUndefined()
    // A task no longer in review takes no verdict.
    expect((await call(`reviews/${task.taskId}/decide`, { verdict: 'accept', subject: task.result!.subject })).status).toBe(409)
  })

  it('ends a review the operator did not decide by the policy\'s wait as review-expired', async () => {
    const { ctx, call } = await boot()
    await activeProject(ctx)
    const { task } = await reviewed(ctx, 'lapsed')
    await ctx.board.sweep(new Date(Date.parse(task.waiting!.expiresAt) - 1000))
    expect(await ctx.board.task(task.taskId)).toMatchObject({ state: 'review' })
    await ctx.board.sweep(new Date(Date.parse(task.waiting!.expiresAt) + 1000))
    const expired = (await ctx.board.task(task.taskId))!
    schemas.assertRecord(expired)
    expect(expired).toMatchObject({ state: 'waiting-for-input', waiting: { reason: 'review-expired' } })
    expect((await call(`reviews/${task.taskId}/decide`, { verdict: 'accept', subject: task.result!.subject })).status).toBe(409)
  })
})

describe('web UI: each required check of a review with its state, from what the run recorded at acceptance (ADR-0063, T160)', () => {
  const ACCEPTANCE = `sha256:${'a'.repeat(64)}` as ArtifactRef
  const HOLD = `sha256:${'b'.repeat(64)}` as ArtifactRef
  /** A run's acceptance as the engine records it, and the board's hold that names it first among its inputs. */
  const ledger = (detail: Record<string, unknown>) => (ref: ArtifactRef): unknown => (ref === HOLD
    ? { decisionType: 'board', inputs: [ACCEPTANCE, `sha256:${'c'.repeat(64)}`], outcome: { option: 'operator-review', detail: { pendingChecks: ['lint'] } } }
    : ref === ACCEPTANCE ? { decisionType: 'acceptance', inputs: [], outcome: { option: 'accept', detail } } : undefined)

  it('says passed and failed with their exit codes only on a record, not run with why, and pending for a check nothing recorded', () => {
    const detail = {
      checks: { schema: true, tests: true, typecheck: false },
      checkRun: { asked: ['tests', 'typecheck', 'lint'], source: 'agents', outcome: 'checked', results: [{ check: 'tests', outcome: 'passed', exitCode: 0 }, { check: 'typecheck', outcome: 'failed', exitCode: 2 }, { check: 'lint', outcome: 'error' }] },
    }
    const acceptance = acceptanceOf({ lastDecision: HOLD }, ledger(detail))
    expect(acceptance).toEqual(detail)
    expect(checkStates(['tests', 'typecheck', 'lint', 'review'], ['lint', 'review'], acceptance)).toEqual([
      { check: 'tests', state: 'passed', exitCode: 0 },
      { check: 'typecheck', state: 'failed', exitCode: 2 },
      { check: 'lint', state: 'not-run', why: 'it did not run to an exit code on the result' },
      { check: 'review', state: 'pending', why: 'the run recorded no result of it' },
    ])
  })

  it('says why the checks the run asked for did not run: no source held the worktree, or the source refused', () => {
    const notRun = { checks: {}, checkRun: { asked: ['tests', 'lint'], outcome: 'not-run', reason: 'no Worker source holds the worktree /w/run_1 of the run' } }
    expect(checkStates(['tests', 'lint'], ['tests', 'lint'], acceptanceOf({ lastDecision: HOLD }, ledger(notRun)))).toEqual([
      { check: 'tests', state: 'not-run', why: 'no Worker source holds the worktree /w/run_1 of the run' },
      { check: 'lint', state: 'not-run', why: 'no Worker source holds the worktree /w/run_1 of the run' },
    ])
    const refused = { checks: {}, checkRun: { asked: ['tests'], source: 'agents', outcome: 'refused', cause: 'confinement' } }
    expect(checkStates(['tests'], ['tests'], acceptanceOf({ lastDecision: ACCEPTANCE }, ledger(refused)))).toEqual([
      { check: 'tests', state: 'not-run', why: 'the Worker source agents refused to run it (confinement)' },
    ])
  })

  it('says a check that passed without running its browser tests passed with what did not run: checks passed, browser tests not run (T247, T255)', () => {
    const detail = {
      checks: { tests: true, lint: true },
      checkRun: { asked: ['tests', 'lint'], source: 'agents', outcome: 'checked', results: [
        { check: 'tests', outcome: 'passed', exitCode: 0, notRun: 'its browser tests (12 browser tests skipped: no usable Chrome)' },
        { check: 'lint', outcome: 'passed', exitCode: 0 },
      ] },
    }
    expect(checkStates(['tests', 'lint'], [], acceptanceOf({ lastDecision: HOLD }, ledger(detail)))).toEqual([
      { check: 'tests', state: 'passed', exitCode: 0, notRun: 'its browser tests (12 browser tests skipped: no usable Chrome)' },
      { check: 'lint', state: 'passed', exitCode: 0 },
    ])
  })

  it('never says passed without a record: no acceptance read, a check the board still holds pending, or a check required and not recorded (INV-2)', () => {
    // No acceptance could be read: every required check is pending, with why.
    expect(acceptanceOf({ lastDecision: HOLD }, () => undefined)).toBeUndefined()
    expect(acceptanceOf({}, ledger({}))).toBeUndefined()
    expect(checkStates(['tests', 'lint'], [], undefined)).toEqual([
      { check: 'tests', state: 'pending', why: 'no acceptance of the run that records it could be read' },
      { check: 'lint', state: 'pending', why: 'no acceptance of the run that records it could be read' },
    ])
    // A record of passed the board does not count (it holds the check pending) is not shown as passed.
    const states = checkStates(['tests'], ['tests'], { checks: { tests: true } })
    expect(states).toEqual([{ check: 'tests', state: 'pending', why: 'the run recorded no result of it' }])
    // Required and never recorded.
    expect(checkStates(['tests', 'lint'], [], { checks: { schema: true } }).map((c) => c.state)).toEqual(['pending', 'pending'])
  })

  it('takes the required checks from every rule for the class in the policies that apply, in one order', () => {
    const policies = bundlePolicies()
    expect(requiredChecks(policies, 'workspace-write')).toEqual(['tests', 'lint'])
    expect(requiredChecks(policies, 'read')).toEqual([])
  })
})

/** A run's change as the agents source reads it: a changed file, a long added one, and a binary one (T122). */
const changeOf = (runId: string): WorkChange => ({
  repository: '/repo', workspace: `/worktrees/repo/${runId}`, branch: `system/run/${runId}`, base: { branch: 'main', sha: 'a'.repeat(40) }, head: 'a'.repeat(40), more: 0, truncated: false,
  files: [
    { path: 'src/limits.ts', status: 'modified', added: 1, removed: 1, diff: 'diff --git a/src/limits.ts b/src/limits.ts\n--- a/src/limits.ts\n+++ b/src/limits.ts\n@@ -1,3 +1,3 @@\n-  return { limit }\n+  return { limit, header }' },
    { path: 'tests/many.spec.ts', status: 'added', added: 250, removed: 0, diff: ['new file tests/many.spec.ts (untracked)', ...Array.from({ length: 250 }, (_, i) => `+line ${i + 1}`)].join('\n') },
    { path: 'assets/logo.png', status: 'added', binary: true },
  ],
})

/** A source that holds no Worker and reads the change of `runId` (and fails for `broken`), as the agents source does. */
function changes(ctx: Context, runId: string): void {
  ctx.workers.register({
    name: 'worktrees', describe: async () => [], start: () => { throw new Error('it runs nothing') }, get: () => undefined, wait: () => Promise.reject(new Error('it runs nothing')),
    changes: async (id: string) => { if (id === 'broken') throw new Error('git failed'); return id === runId ? [changeOf(runId)] : undefined },
  } as never)
}

/** The review step's verdict, as the engine stores a bound review's. */
function assessment(ctx: Context, runId: string): void {
  const subject = { type: 'git-head' as const, ref: 'a'.repeat(40), version: 'b'.repeat(64) }
  ctx.artifacts.put({ kind: 'assessment', bodySchema: 'assessment@1.0', subject, inputs: [], classification: 'public', producer: { type: 'system', ref: 'workflow' }, runId, nodeId: 'review:1',
    body: { schema: 'assessment@1.0', subject, verdict: 'approve', findings: [{ severity: 'warning', title: 'The header name is matched case-sensitively', file: 'src/limits.ts' }], reviewer: 'w:standard' } } as never)
}

describe('web UI: what the operator reads before a review verdict (T122)', () => {
  it('serves a run\'s change, its reviewers\' verdicts, and its report to the operator only, read through ctx.workers.changes; a change that cannot be read is said, never empty (INV-2, INV-6)', async () => {
    const { ctx, call, client } = await boot()
    await activeProject(ctx)
    const { run } = await reviewed(ctx, 'kernel')
    expect((await call(`runs/${run.runId}/review`)).value).toMatchObject({ change: { value: { changes: [], unread: [] } }, assessments: { value: [] } })
    changes(ctx, run.runId)
    assessment(ctx, run.runId)
    expect((await call(`runs/${run.runId}/review`, undefined, client)).status).toBe(401)
    expect((await call('runs/run_nope/review')).status).toBe(404)
    expect((await call(`runs/${run.runId}/review`, {})).status).toBe(405)
    const read = await call(`runs/${run.runId}/review`)
    expect(read.status).toBe(200)
    expect(read.value).toEqual({
      runId: run.runId,
      change: { value: { changes: [{ ...changeOf(run.runId), source: 'worktrees' }], unread: [] } },
      assessments: { value: [{ nodeId: 'review:1', createdAt: expect.any(String), verdict: 'approve', findings: [{ severity: 'warning', title: 'The header name is matched case-sensitively', file: 'src/limits.ts' }], reviewer: 'w:standard' }], more: 0 },
      report: { nodeId: 'solo', text: run.answer },
    })
    // A source that cannot read its worktree is named, with why.
    ctx.workers.register({ name: 'failing', describe: async () => [], start: () => { throw new Error('none') }, get: () => undefined, wait: () => Promise.reject(new Error('none')), changes: async () => { throw new Error('git failed') } } as never)
    expect(((await call(`runs/${run.runId}/review`)).value.change as { value: { unread: unknown } }).value.unread).toEqual([{ source: 'failing', detail: 'git failed' }])
  })

  it('says what changed is unknown when the run\'s result names the workspace an agent worked in and no source read a change there, never that it changed nothing (INV-2)', async () => {
    const { ctx, call } = await boot()
    await activeProject(ctx)
    const { run } = await reviewed(ctx, 'kernel')
    // A run whose result names no workspace changed nothing that a source holds.
    expect((await call(`runs/${run.runId}/review`)).value.change).toEqual({ value: { changes: [], unread: [] } })
    // Its result an agent's, which worked in a workspace: no source answering is not "no change".
    const result = ctx.artifacts.put({
      kind: 'report', bodySchema: 'agent-result@1.1', inputs: [], classification: 'public', producer: { type: 'worker', ref: 'agent:dev' }, runId: run.runId, nodeId: 'solo',
      body: { schema: 'agent-result@1.1', worker: 'agent:dev', runtime: 'scripted', runId: 'x', nativeHandle: 'h', promptHash: `sha256:${'c'.repeat(64)}`, sandbox: 'workspace-write', workspace: '/worktrees/repo/run_x', turns: 1, text: 'done' },
    } as never)
    ctx.store.db.prepare('UPDATE workflow_runs SET result = ? WHERE run_id = ?').run(result.id, run.runId)
    expect((await call(`runs/${run.runId}/review`)).value.change).toEqual({ unknown: 'no Worker source read the change in /worktrees/repo/run_x, the workspace the run\'s result names, so what it changed is not known' })
    // A source that read it, or one that could not, answers as before.
    changes(ctx, run.runId)
    expect((await call(`runs/${run.runId}/review`)).value.change).toEqual({ value: { changes: [{ ...changeOf(run.runId), source: 'worktrees' }], unread: [] } })
  })

  it('lists the newest verdicts first, at most 20, and counts the older ones as more', async () => {
    const { ctx, call } = await boot()
    await activeProject(ctx)
    const { run } = await reviewed(ctx, 'kernel')
    const subject = { type: 'git-head' as const, ref: 'a'.repeat(40), version: 'b'.repeat(64) }
    for (let i = 1; i <= 23; i++) {
      ctx.artifacts.put({ kind: 'assessment', bodySchema: 'assessment@1.0', subject, inputs: [], classification: 'public', producer: { type: 'system', ref: 'workflow' }, runId: run.runId, nodeId: `review:${i}`,
        body: { schema: 'assessment@1.0', subject, verdict: i === 23 ? 'approve' : 'changes-requested', findings: [{ severity: 'warning', title: `finding ${i}` }] } } as never)
      // A later millisecond: stored later is newer.
      await new Promise((resolve) => setTimeout(resolve, 3))
    }
    const { assessments } = (await call(`runs/${run.runId}/review`)).value as { assessments: { value: Array<{ nodeId: string; verdict: string }>; more: number; moreAtLeast?: true } }
    expect(assessments.value.map((a) => a.nodeId)).toEqual(Array.from({ length: 20 }, (_, i) => `review:${23 - i}`))
    expect(assessments.value[0]!.verdict).toBe('approve')
    expect(assessments.more).toBe(3)
    expect(assessments.moreAtLeast).toBeUndefined()
  })

  /** A review held by the auto-accept rule: its acceptance records tests and lint passed, tests without its browser tests (T255). */
  const unrunReview = async (): Promise<Awaited<ReturnType<typeof boot>>> => {
    const booted = await boot()
    const { ctx } = booted
    await activeProject(ctx)
    const { task } = await reviewed(ctx, 'Keep the header test')
    const store = ctx.artifacts as unknown as { get: (ref: string) => { body?: unknown } | undefined }
    const get = store.get.bind(store)
    const hold = get(task.lastDecision!)?.body as { inputs?: string[] }
    const acceptanceRef = [task.lastDecision!, ...(hold.inputs ?? [])].find((ref) => (get(ref)?.body as { decisionType?: string } | undefined)?.decisionType === 'acceptance')!
    store.get = (ref) => {
      const found = get(ref)
      if (ref !== acceptanceRef || !found) return found
      const body = found.body as { outcome: { detail?: Record<string, unknown> } }
      return { ...found, body: { ...body, outcome: { ...body.outcome, detail: { ...body.outcome.detail,
        checks: { tests: true, lint: true }, checkRun: { asked: ['tests', 'lint'], source: 'agents', outcome: 'checked', results: [
          { check: 'tests', outcome: 'passed', exitCode: 0, notRun: 'its browser tests (12 browser tests skipped: no usable Chrome)' },
          { check: 'lint', outcome: 'passed', exitCode: 0 },
        ] } } } } }
    }
    onTestFinished(() => void (store.get = get))
    // The board no longer holds them pending: the hold is the auto-accept rule's.
    ctx.store.db.prepare('UPDATE board_tasks SET record = json_set(record, \'$.waiting.pendingChecks\', json(\'[]\')) WHERE task_id = ?').run(task.taskId)
    return booted
  }

  it('lists a review whose checks passed without their browser tests with each passed check and what it did not run (T247, T255)', async () => {
    const { call } = await unrunReview()
    expect(((await call('reviews')).value.reviews as Array<Record<string, unknown>>)[0]!.checks).toEqual({ value: [
      { check: 'tests', state: 'passed', exitCode: 0, notRun: 'its browser tests (12 browser tests skipped: no usable Chrome)' },
      { check: 'lint', state: 'passed', exitCode: 0 },
    ] })
  })
})
