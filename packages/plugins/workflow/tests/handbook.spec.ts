import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import StoreApprovals from '@tsuuanmi/system-approvals'
import type { AutonomyPolicy } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import StoreBoard from '@tsuuanmi/system-board'
import type { ArtifactRef } from '@tsuuanmi/system-board-core'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { type BriefHandbook, type HandbookRole } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { activeProject, CONFIG, readyTask, ScriptedWorkers, TEMPLATES } from '../conformance/workflow.ts'
import { HANDBOOK_BOUND, HANDBOOK_RULE, type HandbookSource, type Selection, selectParts, SOURCE_MAX } from '../src/handbook.ts'
import Workflow from '../src/index.ts'
import type { NodeTemplate } from '../src/spec.ts'

// The per-Worker handbook slice (docs/design/handbook.md, PROP-0016 I1 part 2): a step is given the
// parts of the handbook's layers that bear on its role, task class, risk tier, and touched paths,
// within 6,000 estimated tokens, each layer's version recorded in its brief; over the bound, a
// warning for the first `handbook.warnTasks` board tasks, then a refusal.
vi.setConfig({ testTimeout: 60_000 })

const ROLES: readonly HandbookRole[] = ['develop', 'review', 'validate', 'research', 'lead']

/** A fixture handbook: every key a part can carry, and one playbook per role. */
const FIXTURE: HandbookSource = {
  versions: { 1: 'git:inv', 2: 'policy:studio@1:h', 3: 'charter:p1:2', 4: 'playbook:t:abc' },
  parts: [
    { id: 'L1.pointer', layer: 1, text: '- the invariants bind' },
    { id: 'L1.titles', layer: 1, text: '- INV-1 … INV-15', applies: { tiers: ['heavy'] } },
    { id: 'L2.tier.light', layer: 2, text: '- light', applies: { tiers: ['light'] } },
    { id: 'L2.tier.heavy', layer: 2, text: '- heavy', applies: { tiers: ['heavy'] } },
    { id: 'L2.gate-view', layer: 2, text: '', source: { tokens: SOURCE_MAX.gateView, atMost: true } },
    { id: 'L3.objective', layer: 3, text: '- objective' },
    { id: 'L3.constraints', layer: 3, text: '- constraints', applies: { roles: ['develop', 'review'] } },
    { id: 'L4.writer', layer: 4, text: '- write the change with its docs and tests', applies: { roles: ['develop'] } },
    { id: 'L4.writer.docs', layer: 4, text: '- every statement true of the code', applies: { roles: ['develop'], classes: ['docs'] } },
    { id: 'T4', layer: 4, text: '- wait for the event, not the clock', applies: { roles: ['develop'], classes: ['tests'], paths: ['tests/'] } },
    { id: 'W18', layer: 4, text: '- how a schema changes', applies: { roles: ['develop'], paths: ['schemas/'] } },
    { id: 'L4.reviewer', layer: 4, text: '- review independently', applies: { roles: ['review'] } },
    { id: 'L4.validator', layer: 4, text: '- run each check as written', applies: { roles: ['validate'] } },
    { id: 'L4.researcher', layer: 4, text: '- cite', applies: { roles: ['research'] } },
    { id: 'L4.lead', layer: 4, text: '- the lead\'s playbook', applies: { roles: ['lead'] } },
    { id: 'L5.lessons', layer: 5, text: '', source: { tokens: SOURCE_MAX.lessons, atMost: true }, applies: { roles: ['develop', 'review'] } },
  ],
}


describe('the slice of each role (docs/design/handbook.md#the-slice-of-each-role), on a fixture handbook', () => {

  it('never gives a role another role\'s playbook, whatever its class, tier, or paths', () => {
    const playbooks = new Map<string, HandbookRole>(FIXTURE.parts.filter((p) => p.layer === 4).map((p) => [p.id, p.applies!.roles![0]!]))
    for (const role of ROLES) {
      for (const tier of ['light', 'normal', 'heavy', 'off'] as const) {
        for (const klass of [undefined, 'code', 'docs', 'tests', 'validation']) {
          for (const touched of [undefined, ['src/a.ts'], ['tests/a.spec.ts', 'schemas/x.v1.json']]) {
            const s: Selection = { role, tier, tierFrom: 'map', paths: touched ? 'subject' : 'unknown', ...(klass ? { class: klass } : {}), ...(touched ? { touched } : {}) }
            const others = selectParts(FIXTURE, s).filter((p) => p.layer === 4 && playbooks.get(p.id) !== role)
            expect(others.map((p) => p.id), `${role} ${tier} ${klass} ${touched}`).toEqual([])
          }
        }
      }
    }
  })
})

// --- The engine's handbook, read from the homes ------------------------------------------------

const INVARIANTS = '# System invariants\n\n### INV-1 One authoritative runtime\n\nOne.\n\n### INV-2 Fail closed\n\nTwo.\n'
/** A System repository in miniature: the homes of layers 1 and 4 the engine reads (`handbook.root`). */
function homesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'system-workflow-homes-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  put('docs/architecture/invariants.md', INVARIANTS)
  put('docs/decisions/adr/README.md', [
    '| ADR | Decision | Status |', '|---|---|---|',
    '| [0001](0001-one.md) | One runtime | Accepted |',
    '| [0002](0002-the-engine.md) | The engine briefs its steps | Accepted; amended 2026-10-26 |',
    '| [0003](0003-draft.md) | A draft about the engine | Proposed |',
  ].join('\n'))
  put('docs/decisions/adr/0001-one.md', '# One runtime\n\nRelated: packages/store\n')
  put('docs/decisions/adr/0002-the-engine.md', '# The engine briefs its steps\n\nRelated: packages/plugins/workflow\n')
  put('docs/decisions/adr/0003-draft.md', '# A draft\n\nRelated: packages/plugins/workflow\n')
  put('docs/design/handbook.md', [
    '| Id | Rule | Home today | Check |', '|---|---|---|---|',
    ...[['W2', 'change only what the task needs'], ['W3', 'never weaken, skip, or loosen a test'], ['W4', 'the docs variant changes documents only'], ['W5', 'the tests variant changes tests only'],
      ['W18', 'how a schema changes'], ['Q1', 'a package imports from its layer or a lower one'], ['T1', 'real plugins over mocks'], ['T4', 'wait for the event, not the clock'],
      ['V1', 'review independently'], ['V5', 'a heavy change\'s second review is by another provider family']].map(([id, rule]) => `| ${id} | ${rule} | AGENTS.md | **none** |`),
  ].join('\n'))
  return root
}


// --- In the engine -----------------------------------------------------------------------------

const policy: AutonomyPolicy = {
  schema: 'autonomy-policy@1.1', id: 'studio', version: 1, scope: 'studio',
  rules: [{ actionClass: 'read', mode: 'auto' }, { actionClass: 'merge', mode: 'ask' }],
  default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86400 },
  riskTiers: { version: 1, rules: [{ tier: 'normal', note: 'the source', paths: ['src/'] }] },
}
const step = (prompt: string, kind?: string): NodeTemplate[] => [{ nodeId: 'develop', objective: 'Change it', prompt, capabilities: ['develop'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', ...(kind ? { kind } : {}) }]
const SMALL = 'Change it: {{input}}'
/** A playbook far over layer 4's share: with the source's half at its maximum, the slice passes the bound. */
const BIG = `Change it: {{input}}\n${'Follow this rule. '.repeat(1500)}`

async function boot(handbook: { warnTasks?: number; enabled?: boolean }, touched?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'system-workflow-handbook-'))
  const root = homesRoot()
  const ctx = new Context()
  const workers = new ScriptedWorkers()
  const fibers: Fiber[] = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}),
    ctx.plugin({ name: 'scripted-workers', inject: ['workers', 'artifacts'], apply: (c: Context) => {
      c.workers.register(workers.source(c))
      // A source that holds the run's worktree and tells the paths its change touches.
      if (touched) {
        c.workers.register({
          name: 'holder', describe: async () => [],
          changes: async (runId: string) => [{ repository: '/repo', workspace: '/repo', branch: `system/run/${runId}`, base: { branch: 'dev', sha: 'b'.repeat(40) }, head: 'b'.repeat(40), files: touched.map((path) => ({ path, status: 'modified' as const, added: 1, removed: 1 })), more: 0, truncated: false }],
          start: () => {
            throw new Error('the holder runs no Worker')
          },
          get: () => undefined, wait: () => Promise.reject(new Error('the holder runs no Worker')),
        } as never)
      }
    } }),
    ctx.plugin(StoreApprovals, { policies: [policy], sweepSeconds: 3600 }), ctx.plugin(StoreBoard, { sweepSeconds: 0 }),
  ]
  await Promise.all(fibers)
  const engine = ctx.plugin(Workflow, { ...CONFIG, handbook: { root, ...handbook }, templates: { ...TEMPLATES, small: step(SMALL), big: step(BIG), coded: step(SMALL, 'code') } })
  await engine
  onTestFinished(async () => {
    await engine.dispose()
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  await activeProject(ctx)
  const tasks = new Map<string, string>()
  const run = async (template: string, title: string): Promise<string> => {
    const task = await readyTask(ctx, title)
    const { runId } = await ctx.workflow.start({ template, input: 'change it', classification: 'public', task: { taskId: task.taskId } })
    tasks.set(runId, task.taskId)
    await vi.waitFor(() => expect(ctx.workflow.get(runId)!.status).not.toBe('running'), { timeout: 30_000, interval: 25 })
    return runId
  }
  return { ctx, workers, run, taskOf: (runId: string) => tasks.get(runId)! }
}

type Decision = { decider: { id: string }; outcome: { option: string; detail: Record<string, unknown> } }
const boundDecisions = (ctx: Context, runId: string): Decision[] =>
  ctx.artifacts.list({ kind: 'decision', runId, limit: 1000 }).map((a) => a.body as Decision).filter((d) => d.decider.id === HANDBOOK_RULE)

describe('the slice in each step\'s brief (brief@1.6 handbook)', () => {

  it('selects by the paths the change touches, read from the source that holds it, and records them for the Worker source', async () => {
    const { ctx, workers, run } = await boot({}, ['packages/plugins/workflow/src/handbook.ts'])
    const runId = await run('coded', 'touched')
    expect(ctx.workflow.get(runId)!.status).toBe('completed')
    const brief = ctx.artifacts.get(workers.started[0]!.brief! as ArtifactRef)!.body as { handbook: BriefHandbook; artifacts: Array<{ ref: ArtifactRef }> }
    // No rule of the map matches the path, so the change is heavy, by the map, on the subject's paths.
    expect(brief.handbook.selection).toEqual({ role: 'develop', class: 'code', tier: 'heavy', tierFrom: 'map', paths: 'subject', touched: ['packages/plugins/workflow/src/handbook.ts'] })
    const pointed = brief.artifacts.map((p) => ctx.artifacts.get(p.ref)!.body as { schema?: string; parts?: string[] }).find((b) => b.schema === 'handbook-slice@1.0')!
    expect(pointed.parts).toEqual(['L1.pointer', 'INV-1', 'INV-2', 'ADR-0002', 'L2.tier.heavy', 'L3.objective', 'L3.criteria', 'L3.constraints', 'L4.playbook', 'L4.rules', 'W2', 'W3', 'Q1'])
  })

  it('sends a slice over the bound whole with a warning for the first warnTasks board tasks, then refuses it before anything is routed (handbook_over_bound)', async () => {
    const { ctx, workers, run, taskOf } = await boot({ warnTasks: 1 })
    // The first task: warn mode, sent whole, the warning naming the layer over its share, its size, and its owner.
    const first = await run('big', 'first')
    expect(ctx.workflow.get(first)!.status).toBe('completed')
    expect(workers.started).toHaveLength(1)
    const sent = (ctx.artifacts.get(workers.started[0]!.brief! as ArtifactRef)!.body as { handbook: BriefHandbook }).handbook
    expect(sent.bound.mode).toBe('warn')
    expect(sent.tokens).toBeGreaterThan(HANDBOOK_BOUND)
    const decided = boundDecisions(ctx, first)
    expect(decided).toHaveLength(2)
    const warned = decided.find((d) => d.outcome.option === 'warn')
    const moved = decided.find((d) => d.outcome.detail['move'] === 'refuse')
    expect(warned!.outcome).toMatchObject({ option: 'warn', detail: { tokens: sent.tokens, bound: HANDBOOK_BOUND, over: [{ layer: 4, share: 2300, owner: 'lead' }] } })
    // That task was the warnTasks-th: the bound moves to refuse, a decision of its own.
    expect(moved!.outcome).toMatchObject({ option: 'refuse', detail: { move: 'refuse', tasks: 1 } })

    // The next task: refused, nothing sent, the step failed config_error naming the layer and its size.
    const second = await run('big', 'second')
    const view = ctx.workflow.get(second)!
    expect(view.status).toBe('failed')
    expect(workers.started).toHaveLength(1)
    expect(view.nodes[0]!.error).toMatchObject({ kind: 'config_error', message: expect.stringMatching(/handbook_over_bound.*layer 4 \(Role playbook, owner lead\) holds \d+ tokens of its 2300/) })
    expect(boundDecisions(ctx, second).map((d) => d.outcome.option)).toEqual(['refuse'])
    // A refusal never spends an attempt (T321): the task waits for input on the question wait, which
    // counts nothing and uses no free retry; its answer continues the same attempt.
    expect(view.nodes[0]!.error).toMatchObject({ disposition: 'CODE_FIX' })
    await vi.waitFor(async () => expect(await ctx.board.task(taskOf(second))).toMatchObject({ state: 'waiting-for-input', waiting: { reason: 'question', questions: [expect.stringMatching(/handbook slice was refused.*no attempt was spent/)] } }), { timeout: 30_000, interval: 25 })
    expect((await ctx.board.task(taskOf(second)))!.attempts).toEqual({ count: 1, max: 3 })
    expect(ctx.store.db.prepare('SELECT free_retries FROM board_tasks WHERE task_id = ?').get(taskOf(second))).toEqual({ free_retries: 0 })
    // Answered once the layer is shortened: ready again on the same attempt, which the next start continues.
    expect(await ctx.board.answer(taskOf(second), ['layer 4 is shortened'])).toMatchObject({ state: 'ready', attempts: { count: 1 } })
    expect(await ctx.board.continuing(taskOf(second))).toBe(true)
    // And the refusal files a task for the layer's owner, once (T321).
    const filed = (await ctx.board.tasks({ projectId: 'p1' })).filter((t) => t.title.startsWith('Handbook slice refused'))
    expect(filed).toHaveLength(1)
    expect(filed[0]).toMatchObject({ title: 'Handbook slice refused: layer 4 over its share', actionClass: 'workspace-write', goal: expect.stringContaining('The attempt was not spent') })

    // In refuse mode, a slice within the bound is sent.
    const third = await run('small', 'third')
    expect(ctx.workflow.get(third)!.status).toBe('completed')
    expect((ctx.artifacts.get(workers.started[1]!.brief! as ArtifactRef)!.body as { handbook: BriefHandbook }).handbook.bound.mode).toBe('refuse')
  })
})
