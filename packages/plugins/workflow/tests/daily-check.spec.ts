/**
 * The daily check (board T305b, D104): once a day, from its UTC hour, the whole suite with every browser
 * spec runs on the tip of a ref, by the Worker source that holds the repository; a failure proposes one
 * board task with the failing tests, the commit, and the last green commit, none while one is open; a
 * pass is recorded. End to end over the store-backed board and approval queue and a git repository;
 * only the source's check is scripted. Every instant a test reads is a fixed one handed to the check.
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
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { TipChecked, TipCheckStep, WorkerSource } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { activeProject, CONFIG } from '../conformance/workflow.ts'
import Workflow, { type DailyCheckConfig } from '../src/index.ts'

vi.setConfig({ testTimeout: 120_000 })

const POLICY: AutonomyPolicy = {
  schema: 'autonomy-policy@1.0', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }], default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
}

/** A repository whose `dev` has one commit; `commit()` adds another, moving the tip. */
function repository(): { dir: string; tip: () => string; commit: () => string } {
  const dir = mkdtempSync(join(tmpdir(), 'system-daily-check-repo-'))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args: string[]): string => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'dev')
  let n = 0
  const commit = (): string => {
    writeFileSync(join(dir, 'file.txt'), `${++n}\n`)
    git('add', '.')
    git('commit', '-q', '-m', `commit ${n}`)
    return git('rev-parse', 'dev').trim()
  }
  commit()
  return { dir, tip: () => git('rev-parse', 'dev').trim(), commit }
}

/** What the scripted source answers to the check of a tip: passes, fails with these lines, or is not run. */
interface Script {
  answer: (step: TipCheckStep) => TipChecked | undefined
  steps: TipCheckStep[]
}

const FAILED_LINES = ['FAIL packages/plugins/login/tests/login.spec.ts > login > opens the desktop', 'AssertionError: expected 200 to be 500']
const passed = (): TipChecked => ({ outcome: 'checked', result: { check: 'tests', outcome: 'passed', exitCode: 0, reason: 'its command exited 0' } })
const failed = (failures = FAILED_LINES): TipChecked => ({ outcome: 'checked', result: { check: 'tests', outcome: 'failed', exitCode: 1, reason: 'its command exited with code 1', failures }, evidence: 'sha256:evidence' })

async function boot(dir: string, dailyCheck: DailyCheckConfig = {}): Promise<{ ctx: Context; script: Script; restart: () => Promise<void> }> {
  const data = mkdtempSync(join(tmpdir(), 'system-daily-check-'))
  const ctx = new Context()
  const script: Script = { answer: passed, steps: [] }
  const source: WorkerSource = {
    name: 'tip-checker', describe: async () => [], start: () => { throw new Error('runs no work') }, get: () => undefined, wait: () => Promise.reject(new Error('runs no work')),
    checkTip: async (step) => {
      script.steps.push(step)
      return script.answer(step)
    },
  }
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(data, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'tip-checker', inject: ['workers'], apply: (c: Context) => void c.workers.register(source) }),
    ctx.plugin(StoreApprovals, { policies: [POLICY], sweepSeconds: 3600 }), ctx.plugin(StoreBoard, { sweepSeconds: 0 }),
  ]
  await Promise.all(fibers)
  const config = { ...CONFIG, dailyCheck: { enabled: true, projectId: 'p1', repository: dir, ...dailyCheck } }
  let engine = ctx.plugin(Workflow, config)
  await engine
  onTestFinished(() => rmSync(data, { recursive: true, force: true }))
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  await activeProject(ctx)
  const restart = async (): Promise<void> => {
    await engine.dispose()
    engine = ctx.plugin(Workflow, config)
    await engine
  }
  return { ctx, script, restart }
}

/** Fixed instants, a day apart, after the default hour (04:00 UTC). */
const DAY = (n: number, hour = 5): Date => new Date(Date.UTC(2026, 10, 1 + n, hour, 0, 0))
const tasksOf = (ctx: Context) => ctx.board.tasks({ projectId: 'p1' })

describe('a failure', () => {
  it('files one task with the failing tests, the commit, and the last green commit', async () => {
    const repo = repository()
    const { ctx, script } = await boot(repo.dir)
    const green = repo.tip()
    expect(await ctx.workflow.dailyCheckTick(DAY(0))).toMatchObject({ state: 'passed' })
    const broken = repo.commit()
    script.answer = () => failed()
    const row = await ctx.workflow.dailyCheckTick(DAY(1))
    expect(row).toMatchObject({ state: 'failed', commit: broken, lastGreen: green, duplicate: false, failures: FAILED_LINES })
    const tasks = await tasksOf(ctx)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.taskId).toBe(row!.taskId)
    expect(tasks[0]!.state).toBe('proposed')
    for (const text of [...FAILED_LINES, `Commit: ${broken}`, `Last green commit: ${green}`, 'check-run evidence sha256:evidence']) expect(tasks[0]!.goal).toContain(text)
    const report = ctx.workflow.dailyCheckReport()
    expect(report.last).toMatchObject({ state: 'failed', taskId: row!.taskId })
    expect(report.lastGreen).toMatchObject({ commit: green })
    expect(report.text).toContain(`Last green: ${green.slice(0, 12)}`)
  })
})

describe('a run that did not run to an exit code', () => {

  it('is an error, never a pass nor the last green commit, when its command passed without running the browser tests', async () => {
    const repo = repository()
    const { ctx, script } = await boot(repo.dir)
    script.answer = () => ({ outcome: 'checked', result: { check: 'tests', outcome: 'passed', exitCode: 0, reason: 'its command exited 0', notRun: 'its browser tests (no Chrome)' } })
    const skipped = await ctx.workflow.dailyCheckTick(DAY(0))
    expect(skipped).toMatchObject({ state: 'error', problem: expect.stringContaining('without running its browser tests (no Chrome)') })
    expect(ctx.workflow.dailyCheckReport().lastGreen).toBeUndefined()
    // A later failure names no last green commit: the day the browser specs did not run is not one.
    repo.commit()
    script.answer = () => failed()
    const row = await ctx.workflow.dailyCheckTick(DAY(1))
    expect(row).toMatchObject({ state: 'failed' })
    expect(row!.lastGreen).toBeUndefined()
    expect((await tasksOf(ctx))[0]!.goal).toContain('Last green commit: none recorded')
  })
})
