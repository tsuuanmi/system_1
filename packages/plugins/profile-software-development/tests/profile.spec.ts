import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Artifacts from '@tsuuanmi/system-artifacts'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import Workflow, { type NodeTemplate } from '@tsuuanmi/system-workflow'
import { SchemaRegistry } from '@tsuuanmi/system-libs'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as SoftwareDevelopment from '../src/index.ts'

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'system-profile-'))
  const ctx = new Context()
  const fibers = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}), ctx.plugin(Workflow, {}),
  ]
  await Promise.all(fibers)
  onTestFinished(async () => { for (const f of [...fibers].reverse()) await f.dispose() })
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return ctx
}

const { profileConformance } = await import('../../workflow/conformance/profiles.ts')
profileConformance('software-development', async () => ({ ctx: await boot(), dispose: async () => undefined }), SoftwareDevelopment, {
  'agent-review': SoftwareDevelopment.AGENT_REVIEW, 'algorithm-development': SoftwareDevelopment.ALGORITHM_DEVELOPMENT, 'scheduled-review': SoftwareDevelopment.SCHEDULED_REVIEW_TEMPLATE,
  decompose: SoftwareDevelopment.DECOMPOSE,
})

describe('the profiles seam (REQ-WF-9)', () => {
  it('checks a contributed template like a configured one, and refuses a second one by the same name', async () => {
    const ctx = await boot()
    const review = SoftwareDevelopment.AGENT_REVIEW
    expect(() => ctx.workflow.template('Bad Name', review)).toThrow(/template name/)
    expect(() => ctx.workflow.template('broken', [{ ...review[0]!, dependsOn: ['missing'] }])).toThrow(/unknown node missing/)
    expect(() => ctx.workflow.template('ask', review)).toThrow(/already exists/)
    const withdraw = ctx.workflow.template('agent-review', review)
    expect(() => ctx.workflow.template('agent-review', review)).toThrow(/already exists/)
    withdraw()
    expect(ctx.workflow.templateNames()).not.toContain('agent-review')
  })
})

describe('the inputs each step of algorithm-development reads (docs/reference/workflow-templates.md#algorithm-development)', () => {
  it('gives the caller\'s input to the writing step only: the self-review and the review read the task and the change, never the develop step\'s orders (T99 D4)', () => {
    const steps = new Map(SoftwareDevelopment.ALGORITHM_DEVELOPMENT.map((n) => [n.nodeId, n]))
    expect(steps.get('develop:1')!.prompt).toContain('{{input}}')
    for (const variant of Object.values(steps.get('develop:1')!.variants ?? {})) expect(variant.prompt).toContain('{{input}}')
    for (const id of ['selfreview:1', 'review:1']) expect(steps.get(id)!.prompt, id).not.toContain('{{')
  })

  it('asks the writing step of a change of behaviour to work test-first, tests failing then passing in its evidence, and a refactor to change no test; the docs and tests variants are not asked (T306c, ADR-0079)', () => {
    const develop = SoftwareDevelopment.ALGORITHM_DEVELOPMENT.find((n) => n.nodeId === 'develop:1')!
    expect(develop.prompt).toContain('work test-first: write the tests that encode the acceptance criteria before the code, run them')
    expect(develop.prompt).toContain('see them fail')
    expect(develop.prompt).toContain('then the same command passing after it')
    expect(develop.prompt).toContain('base tree')
    expect(develop.prompt).toContain('`refactor: no behaviour change`')
    expect(develop.prompt).toContain('change no existing test')
    expect(Object.keys(develop.variants ?? {})).toEqual(['docs', 'tests'])
    for (const variant of Object.values(develop.variants ?? {})) expect(variant.prompt).not.toContain('test-first')
  })

  it('has no validate step any more (T267): the author shows its checks\' output in the dossier, a fresh session of its account reviews the change first, and the review is the final step', () => {
    const steps = SoftwareDevelopment.ALGORITHM_DEVELOPMENT
    expect(steps.map((n) => n.nodeId)).toEqual(['develop:1', 'selfreview:1', 'review:1'])
    expect(steps.some((n) => n.capabilities.includes('validate') || n.riskSkip)).toBe(false)
    const [develop, selfreview, review] = steps as [NodeTemplate, NodeTemplate, NodeTemplate]
    expect(develop.showsEvidence).toBe(true)
    // The self-review is the author's own: a review on the author's account, in a conversation of its own, depending on the writer only.
    expect(selfreview).toMatchObject({ selfReview: 'develop:1', conversation: 'temporary', dependsOn: ['develop:1'] })
    expect(selfreview.capabilities).toContain('review')
    expect(selfreview.differentFrom).toBeUndefined()
    // The independent review waits for it, and reads the change from the writer's result (the last it depends on).
    expect(review.dependsOn).toEqual(['selfreview:1', 'develop:1'])
    expect(review.selfReview).toBeUndefined()
    for (const prompt of [develop.prompt, ...Object.values(develop.variants ?? {}).map((v) => v.prompt!)]) expect(prompt).toContain('evidence entry')
  })
})

describe('the pipeline of algorithm-development (T365, ADR-0082)', () => {
  // The sha256 of JSON.stringify of the spec before T365, recorded from the base commit's own
  // algorithmDevelopment() (b7507401), copied out of that tree and run: a change to any byte of the
  // full graph (a prompt, a capability, a field) fails this, whatever the code builds today.
  const BEFORE_T365 = '20ca0612093a8e83b386bf6c5c4bb855c0d65836fea9c79cdf73eb0d8972ece5'
  const BEFORE_T365_KINDS = '7bf526c81b78180821d10e0491c42018df80e923beec3275c699e89a8b81f1ac' // with { develop: 'docs', docs: 'writing' }
  const sha256 = (nodes: NodeTemplate[]): string => createHash('sha256').update(JSON.stringify(nodes)).digest('hex')

  it('is full by default, and the full spec is the one before the switch, byte for byte (no pipeline given, or full; shipped and configured kinds)', () => {
    expect(sha256(SoftwareDevelopment.ALGORITHM_DEVELOPMENT)).toBe(BEFORE_T365)
    expect(sha256(SoftwareDevelopment.algorithmDevelopment())).toBe(BEFORE_T365)
    expect(sha256(SoftwareDevelopment.algorithmDevelopment({}, 'full'))).toBe(BEFORE_T365)
    expect(sha256(SoftwareDevelopment.algorithmDevelopment({ develop: 'docs', docs: 'writing' }))).toBe(BEFORE_T365_KINDS)
    expect(sha256(SoftwareDevelopment.algorithmDevelopment({ develop: 'docs', docs: 'writing' }, 'full'))).toBe(BEFORE_T365_KINDS)
    expect(SoftwareDevelopment.Config({}).pipeline).toBe('full')
  })

  it('serves the full graph, byte for byte, from a row that does not set the pipeline (the live profile unchanged)', async () => {
    const ctx = await boot()
    const served: NodeTemplate[][] = []
    const template = ctx.workflow.template.bind(ctx.workflow)
    ctx.workflow.template = (name: string, nodes: NodeTemplate[], options?: { version?: string }) => {
      if (name === 'algorithm-development') served.push(nodes)
      return template(name, nodes, options)
    }
    await ctx.plugin(SoftwareDevelopment, {})
    expect(served.map(sha256)).toEqual([BEFORE_T365])
  })

  it('has no selfreview node under lean, and the review depends on the writer only; the rest is as in full', () => {
    const lean = SoftwareDevelopment.algorithmDevelopment({}, 'lean')
    expect(lean.map((n) => n.nodeId)).toEqual(['develop:1', 'review:1'])
    const full = SoftwareDevelopment.ALGORITHM_DEVELOPMENT
    expect(lean[0]).toEqual(full[0])
    expect(lean[1]).toEqual({ ...full[2]!, dependsOn: ['develop:1'] })
    expect(lean.some((n) => n.selfReview)).toBe(false)
  })

  it('serves the lean graph when the row says so, records the pipeline in the template\'s playbook version, and refuses another value (INV-2)', async () => {
    const ctx = await boot()
    await ctx.plugin(SoftwareDevelopment, { pipeline: 'lean' })
    expect(ctx.workflow.templateSteps('algorithm-development')!.map((s) => s.nodeId)).toEqual(['develop:1', 'review:1'])
    expect(SoftwareDevelopment.checkConfig({ pipeline: 'lean' })).toEqual([])
    expect(SoftwareDevelopment.checkConfig({ pipeline: 'fast' } as never)).toEqual(['pipeline must be full or lean, not "fast"'])
    expect(() => SoftwareDevelopment.Config({ pipeline: 'fast' } as never)).toThrow()
    const other = await boot()
    await expect(other.plugin(SoftwareDevelopment, { pipeline: 'fast' } as never)).rejects.toThrow(/pipeline expected "full" \| "lean" but got "fast"/)
    expect(SoftwareDevelopment.templateVersion('full')).not.toContain('lean')
    expect(SoftwareDevelopment.templateVersion('lean')).toMatch(/\+lean$/)
  })
})

describe('the kind of work each step of algorithm-development names (ADR-0057)', () => {
  const kinds = (nodes: NodeTemplate[]) => Object.fromEntries(nodes.flatMap((n) => [
    [n.nodeId, n.kind ?? null], ...Object.entries(n.variants ?? {}).map(([variant, v]) => [`${n.nodeId} (${variant})`, v.kind ?? null]),
  ]))

  it('ships three writing kinds; the two reviews name none', () => {
    expect(kinds(SoftwareDevelopment.ALGORITHM_DEVELOPMENT)).toEqual({
      'develop:1': 'code', 'develop:1 (docs)': 'docs', 'develop:1 (tests)': 'tests', 'selfreview:1': null, 'review:1': null,
    })
    expect(SoftwareDevelopment.Config({})).toEqual({ kinds: SoftwareDevelopment.DEFAULT_KINDS, pipeline: 'full' })
  })

  it('takes each step\'s kind from the row\'s configuration, the rest keeping theirs, and the reviews still none; a retired validate kind is ignored', async () => {
    expect(kinds(SoftwareDevelopment.algorithmDevelopment({ docs: 'writing' }))).toEqual({
      'develop:1': 'code', 'develop:1 (docs)': 'writing', 'develop:1 (tests)': 'tests', 'selfreview:1': null, 'review:1': null,
    })
    expect(SoftwareDevelopment.algorithmDevelopment({ validate: 'tests' } as never)).toEqual(SoftwareDevelopment.ALGORITHM_DEVELOPMENT)
    const ctx = await boot()
    await ctx.plugin(SoftwareDevelopment, { kinds: { validate: 'checks', tests: 'checks' } })
    expect(ctx.workflow.templateSteps('algorithm-development')!.map((s) => s.nodeId)).toEqual(['develop:1', 'selfreview:1', 'review:1'])
  })

  it('refuses a key that is not a step and a kind that is not a kind of work, at the check and at load (INV-2)', async () => {
    expect(SoftwareDevelopment.checkConfig({})).toEqual([])
    expect(SoftwareDevelopment.checkConfig({ kinds: { develop: 'code', validate: 'validation' } })).toEqual([])
    expect(SoftwareDevelopment.checkConfig({ kinds: { review: 'code' } } as never)).toEqual(['kinds.review is not a step; kinds takes develop, docs, tests'])
    expect(SoftwareDevelopment.checkConfig({ kinds: { validate: '' } })).toEqual([`kinds.validate: "" is not a kind of work (${String(/^[a-z][a-z0-9-]{0,31}$/)})`])
    expect(SoftwareDevelopment.checkConfig({ kinds: { develop: 'Code' } })).toHaveLength(1)
    expect(SoftwareDevelopment.checkConfig({ kinds: ['code'] } as never)).toEqual(['kinds must be an object of steps (develop, docs, tests), each naming a kind of work'])
    expect(() => SoftwareDevelopment.Config({ kinds: { validate: '' } })).toThrow(/kinds\.validate/)
    const ctx = await boot()
    await expect(ctx.plugin(SoftwareDevelopment, { kinds: { validation: 'validation' } } as never)).rejects.toThrow(/kinds\.validation is not a step/)
    expect(ctx.workflow.templateNames()).not.toContain('algorithm-development')
  })
})

describe('the decompose template (PROP-0023 change 5)', () => {
  it('is one step that only reasons, so a website Worker takes it first, and never reads the machine\'s data', () => {
    expect(SoftwareDevelopment.DECOMPOSE).toHaveLength(1)
    const plan = SoftwareDevelopment.DECOMPOSE[0]!
    expect(plan).toMatchObject({ nodeId: 'plan:1', capabilities: ['reason'], conversation: 'temporary', acceptance: 'acceptance.answer' })
    expect(plan.capabilities).not.toContain('local-data')
    expect(plan.prompt).toContain('{{input}}')
  })

  it('asks for the board_propose_plan input, and the shape its prompt shows is one that tool takes', () => {
    const prompt = SoftwareDevelopment.DECOMPOSE[0]!.prompt
    expect(prompt).toMatch(/board_propose_plan/)
    const shown = JSON.parse(prompt.split('\n').find((line) => line.startsWith('{"tasks"'))!) as Record<string, unknown>
    new SchemaRegistry().assertDef('mcp-board@1.6', 'board-propose-plan-input', { projectId: 'system', ...shown })
  })
})
