/**
 * How a review team member is routed, escalated, and failed when a Worker's input bound keeps it
 * off a website (the live two-member review of 2026-10-23, board T31): a text review shows its
 * material once, so a member input fits the bound the source is sized for; a member over a
 * website's bound routes at its own tier to a Worker that takes it; a rejected answer escalates
 * only onto a Worker its session can take, and otherwise fails naming the rejection, never a
 * provider-family shortage that is not there. The Workers are scripted as their sources describe
 * them: a website account's tiers, and model Workers that keep a session by replay.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Artifacts from '@tsuuanmi/system-artifacts'
import Egress from '@tsuuanmi/system-egress'
import EventLog from '@tsuuanmi/system-event-log'
import Leases from '@tsuuanmi/system-leases'
import { sha256, startPrompt } from '@tsuuanmi/system-libs'
import Store from '@tsuuanmi/system-store'
import WorkerSessions from '@tsuuanmi/system-worker-sessions'
import WorkerRouter from '@tsuuanmi/system-workers'
import type { ArtifactRef, CapabilityDescriptor, Tier, WorkerExecution, WorkerStart } from '@tsuuanmi/system-workers-core'
import { describe, expect, it, onTestFinished } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import Workflow from '../src/index.ts'

const CONVERSING = ['reason', 'persistent-conversation']

/** A website account's Worker at one tier: its family is the site, its bound the site's (ADR-0032). */
const website = (account: string, family: string, tier: Tier, maxInputChars?: number): CapabilityDescriptor => worker(`web:${account}/${tier}`, {
  schema: 'capability-descriptor@1.3', family, tier, quotaClass: 'subscription-chat', proves: CONVERSING, ...(maxInputChars ? { maxInputChars } : {}),
})
/** A model Worker: metered, no declared input bound, a session kept by replay. */
const model = (id: string, family: string, tier: Tier): CapabilityDescriptor => worker(`model:${id}`, { schema: 'capability-descriptor@1.1', family, tier, quotaClass: 'metered', proves: CONVERSING })

/** A text to review: a request, then `lines` numbered lines of code, each about 60 characters. */
const material = (lines: number): string => ['Review this change for defects in its lease handling; a lease must be released on every path.',
  ...Array.from({ length: lines }, (_, i) => `const step${i} = lease.renew(${i}) // line ${String(i).padStart(4, '0')} of the change`)].join('\n')

const isProposal = (prompt: string): boolean => prompt.includes('Answer on your own')
const findings = '```json\n' + JSON.stringify({ findings: [{ severity: 'warning', claim: 'the lease is renewed and never released', evidence: 'line 2', quote: { path: 'material', line: 2, text: 'const step0 = lease.renew(0) // line 0000 of the change' } }] }) + '\n```'
const ballot = '```json\n' + JSON.stringify({ choice: 'pass', ranking: ['pass', 'changes'], rationale: 'nothing blocks', evidence: [], strongest: { changes: 'it is careful' }, objections: [], confidence: 'high' }) + '\n```'

interface Answer { text: string; cut?: boolean }

/**
 * Scripted sources over `workers`: a session stays on the Worker its first start chose, or moves
 * within `escalates` (a model session's higher tier of its family); each start answers at once.
 * A model Worker's answer is a `model-answer@1.0`, which says when its output bound cut it.
 */
function scripted(ctx: Context, workers: CapabilityDescriptor[], answer: (prompt: string, start: WorkerStart) => Answer, escalates: Record<string, string[]> = {}) {
  const started: Array<WorkerStart & { prompt: string }> = []
  const sessions = new Map<string, string>()
  const executions = new Map<string, WorkerExecution>()
  ctx.workers.register({
    name: 'scripted', describe: async () => workers,
    start: (request) => {
      const prompt = startPrompt(request, (ref) => ctx.artifacts.get(ref)).prompt
      if (request.sessionId && !sessions.has(request.sessionId)) sessions.set(request.sessionId, request.worker)
      started.push({ ...request, prompt })
      const id = `x-${started.length}`
      const { text, cut } = answer(prompt, request)
      const body = request.worker.startsWith('model:')
        ? { schema: 'model-answer@1.0', worker: request.worker, model: request.worker.slice(6), callId: `mcall_${String(started.length).padStart(16, '0')}`, promptHash: sha256(prompt),
          quotaClass: 'metered', locality: 'remote', finish: cut ? 'max-tokens' : 'stop', maxTokens: 4096, sends: 1, attempts: 1, usage: { inputTokens: 9000, outputTokens: cut ? 4096 : 300 }, text }
        : { schema: 'provider-answer@1.0', provider: 'scripted', account: 'scripted', turnId: id, conversation: { mode: 'persistent' }, promptHash: sha256(prompt), text }
      const result = ctx.artifacts.put({ kind: 'report', bodySchema: body.schema, classification: 'public', producer: { type: 'worker', ref: request.worker }, body }).id as ArtifactRef
      const execution: WorkerExecution = { id, status: 'completed', submitted: true, result, decisions: [] }
      executions.set(id, execution)
      return execution
    },
    get: (id) => executions.get(id),
    wait: async (id) => executions.get(id)!,
    affinity: (sessionId) => {
      const first = sessions.get(sessionId)
      return first ? [first, ...(escalates[first] ?? [])] : undefined
    },
  })
  return started
}

/** A source with no Worker whose `describe` throws once `broken` is set, as one whose vault read fails. */
function failing(ctx: Context): { broken: boolean } {
  const state = { broken: false }
  ctx.workers.register({
    name: 'unreadable',
    describe: async () => {
      if (state.broken) throw new Error('the vault is locked')
      return []
    },
    start: () => {
      throw new Error('it has no Worker to start')
    },
    get: () => undefined,
    wait: async () => {
      throw new Error('it has no execution to wait on')
    },
  })
  return state
}

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'system-member-routing-'))
  const ctx = new Context()
  const fibers = [
    ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(Leases, {}), ctx.plugin(Egress, {}),
    ctx.plugin(WorkerRouter, {}), ctx.plugin(WorkerSessions, {}), ctx.plugin(Workflow, { retryDelayMs: 100 }),
  ]
  await Promise.all(fibers)
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  return { ctx }
}

type Decision = { decisionType: string; decider: { id: string; version: string }; outcome: { option: string }; candidates: Array<{ option: string; selected: boolean; reasons: string[] }> }
const decisions = (ctx: Context, runId: string, type: string): Decision[] =>
  ctx.artifacts.list({ kind: 'decision', decisionType: type, runId, limit: 100 }).map((a) => a.body as Decision)


describe('a review member kept off a website by its input bound (live 2026-10-23, board T31)', () => {

  it('routes a member over a website\'s bound to a Worker that takes it at the step\'s own tier, never a higher one', async () => {
    const { ctx } = await boot()
    // The second site takes at most 5,000 characters; its family has a model at the step's tier and one above.
    const workers = [website('chat', 'site-a', 'standard'), ...(['economy', 'standard', 'frontier'] as const).map((t) => website('gem', 'site-b', t, 5000)),
      model('b-standard', 'site-b', 'standard'), model('b-frontier', 'site-b', 'frontier')]
    scripted(ctx, workers, (prompt) => ({ text: isProposal(prompt) ? findings : ballot }), { 'model:b-standard': ['model:b-frontier'] })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'review', input: material(150), classification: 'public' }).runId, 60_000)
    expect(done).toMatchObject({ status: 'completed' })
    const m2 = done.nodes.find((n) => n.nodeId === 'review:m2:propose')!
    expect([m2.worker, m2.tier]).toEqual(['model:b-standard', 'standard'])
    expect(decisions(ctx, done.runId, 'escalation')).toEqual([])
    // The route says why each website tier was left out: its bound, not its tier.
    const route = ctx.workflow.explain(done.runId)!.nodes.find((n) => n.nodeId === m2.nodeId)!.decisions.find((d) => d.type === 'route')!
    const candidates = (ctx.artifacts.get(route.id as ArtifactRef)!.body as Decision).candidates
    for (const tier of ['economy', 'standard', 'frontier']) expect(candidates.find((c) => c.option === `web:gem/${tier}`)!.reasons.join('; ')).toMatch(/the input has \d+ characters; it takes at most 5000/)
  }, 60_000)
})

describe('a session step\'s held Workers, when another Worker source cannot describe itself (T62)', () => {

  it('does not escalate a session step\'s rejected answer when its held Workers cannot be listed, and fails it as rejected, never as internal (T62)', async () => {
    const { ctx } = await boot()
    const unreadable = failing(ctx)
    // Its session's source has a Worker at the next tier: with the listing readable, it would escalate there.
    const started = scripted(ctx, [model('api', 'fam', 'standard'), model('api-pro', 'fam', 'frontier')], () => {
      unreadable.broken = true
      return { text: '' }
    }, { 'model:api': ['model:api-pro'] })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'ask', input: 'hello', persist: true }).runId, 30_000)
    expect(done.status).toBe('failed')
    const [node] = done.nodes
    expect(node).toMatchObject({ state: 'FAILED', worker: 'model:api', error: { kind: 'acceptance_rejected', disposition: 'NONE' } })
    expect(node!.error!.message).toMatch(/^acceptance\.answer: the answer is empty; not escalated: held Workers unknown: the Workers session \S+ stays on could not be listed \(the vault is locked\), so no Worker can be shown to take it at tier frontier$/)
    const [escalation] = decisions(ctx, done.runId, 'escalation')
    expect(escalation).toMatchObject({ decider: { id: 'workflow.escalation', version: '2' }, outcome: { option: 'fail' } })
    expect(decisions(ctx, done.runId, 'recovery')).toEqual([])
    expect(started).toHaveLength(1)
  }, 60_000)
})
