import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as WebUi from '../src/index.ts'
import { builtClient } from './client-build.ts'

// The operator's web UI, round 2 (T256, docs/design/web-ui.md): full width on a responsive grid, each step's run time and
// completion, a run's total and timeline, one line per decision, and what dispatch started by itself as a table at the
// bottom of Home, one row per task. Every instant below is fixed; the page's clock stands at NOW (Date and timers faked).

const at = (hhmm: string): string => `2026-10-24T${hhmm}:00.000Z`
const hash = (c: string): string => `sha256:${c.repeat(64)}`

/** A run of three steps: develop ran from 09:00 to 09:14, review runs since 09:20, test waits for them. */
const TIMED = {
  runId: 'run_timed', template: 'relay', status: 'running', specHash: hash('f'), createdAt: at('09:00'), updatedAt: at('09:20'),
  nodes: [
    { nodeId: 'develop:1', state: 'COMPLETED', minTier: 'standard', attempt: 1, worker: 'worker:a/standard', tier: 'standard' },
    { nodeId: 'review:1', state: 'RUNNING', minTier: 'standard', attempt: 1, worker: 'worker:b/standard' },
    { nodeId: 'test:1', state: 'WAITING', minTier: 'economy', attempt: 0 },
  ],
}
/** A run that ended: develop from 08:00 to 08:10, then it failed at review at 08:25. */
const ENDED = {
  runId: 'run_ended', template: 'relay', status: 'failed', specHash: hash('e'), createdAt: at('08:00'), updatedAt: at('08:25'),
  nodes: [
    { nodeId: 'develop:1', state: 'COMPLETED', minTier: 'standard', attempt: 1, worker: 'worker:a/standard', tier: 'standard' },
    { nodeId: 'review:1', state: 'FAILED', minTier: 'standard', attempt: 1, worker: 'worker:b/standard', error: { kind: 'timeout', disposition: 'NONE', message: 'scripted timeout' } },
  ],
  error: { kind: 'timeout', disposition: 'NONE', message: 'scripted timeout' },
}
/** When each step started and ended, as the event log records it. */
const EVENTS = [
  { seq: 1, at: at('08:00'), type: 'workflow.node.started', runId: 'run_ended', nodeId: 'develop:1' },
  { seq: 2, at: at('08:10'), type: 'workflow.node.completed', runId: 'run_ended', nodeId: 'develop:1' },
  { seq: 3, at: at('08:11'), type: 'workflow.node.started', runId: 'run_ended', nodeId: 'review:1' },
  { seq: 4, at: at('08:25'), type: 'workflow.node.failed', runId: 'run_ended', nodeId: 'review:1' },
  { seq: 5, at: at('09:00'), type: 'workflow.node.started', runId: 'run_timed', nodeId: 'develop:1' },
  { seq: 6, at: at('09:14'), type: 'workflow.node.completed', runId: 'run_timed', nodeId: 'develop:1' },
  { seq: 7, at: at('09:20'), type: 'workflow.node.started', runId: 'run_timed', nodeId: 'review:1' },
]
/** How develop was decided: its route, then a tool call its Worker stopped at, waited on, and continued once approved. */
const DECISIONS = [
  { id: hash('1'), type: 'route', outcome: 'worker:a/standard', reasons: ['proves reason'], at: at('09:00') },
  { id: hash('2'), type: 'recovery', outcome: 'wait', reasons: ['its Worker\'s tool gate deferred a call to the operator on approval request apr-9 and stopped there; the step waits for the verdict'], at: at('09:05') },
  { id: hash('3'), type: 'recovery', outcome: 'continue', reasons: ['the operator approved request apr-9 (command: git status), the exact call execution x deferred on; the session continues once'], at: at('09:07') },
]
const CREATED = new Map(DECISIONS.map((d) => [d.id, d.at]))

/** Seven tasks dispatch started by itself, the newest first; task-a twice (its attempt 2 is run_timed). */
const STARTED = [
  { askId: 'ask-a2', taskId: 'task-a', title: 'Write the release notes', projectId: 'p1', attempt: 2, worker: 'worker:b/standard', runId: 'run_timed', runStatus: 'running', mode: 'ask', why: 'free', startedAt: at('09:00') },
  { askId: 'ask-a1', taskId: 'task-a', title: 'Write the release notes', projectId: 'p1', attempt: 1, worker: 'worker:a/standard', runId: 'run_ended', runStatus: 'failed', mode: 'auto', why: 'free', startedAt: at('08:00') },
  ...['b', 'c', 'd', 'e', 'f', 'g'].map((c, i) => ({ askId: `ask-${c}`, taskId: `task-${c}`, title: `Task ${c.toUpperCase()}`, projectId: 'p1', attempt: 1, worker: 'worker:a/standard', runId: `run_${c}`, runStatus: 'completed', mode: 'auto', why: 'free', startedAt: at(`07:${String(50 - i).padStart(2, '0')}`) })),
]

class StubWorkflow extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workflow')
  }
  usage(limit = 50, filter: { status?: readonly string[]; changedSince?: string } = {}) {
    return [TIMED, ENDED].filter((r) => (filter.status === undefined || filter.status.includes(r.status)) && (filter.changedSince === undefined || r.updatedAt > filter.changedSince)).slice(0, limit)
  }
  get(id: string) { return [TIMED, ENDED].find((r) => r.runId === id) }
  explain(id: string) {
    const run = this.get(id)
    return run ? { runId: id, nodes: run.nodes.map((n) => ({ nodeId: n.nodeId, state: n.state, decisions: id === 'run_timed' && n.nodeId === 'develop:1' ? DECISIONS.map(({ at: _at, ...d }) => d) : [] })) } : undefined
  }
  landing() { return undefined }
  async teamExclusion() { return { entries: [], workers: [] } }
  dispatchStatus() {
    return { enabled: true, settings: { maxOpenAsks: 4, maxRunningPerAccount: 1 }, pausedProjects: [], asks: [], bounds: {}, started: STARTED }
  }
}

/** The event log, read newest first (contract 1.1); `fail` makes every read throw. */
class StubEventLog extends Service {
  fail = false
  constructor(ctx: Context) {
    super(ctx, 'eventLog')
  }
  query(filter: { type?: string; runId?: string; nodeId?: string; order: 'desc'; limit: number }) {
    if (this.fail) throw new Error('the log is locked')
    return EVENTS.filter((e) => (!filter.type || e.type === filter.type) && (!filter.runId || e.runId === filter.runId) && (!filter.nodeId || e.nodeId === filter.nodeId))
      .sort((a, b) => b.seq - a.seq).slice(0, filter.limit)
  }
}

/** The artifact store, as far as the page reads it: when each decision was made, and a run's assessments (none). */
class StubArtifacts extends Service {
  constructor(ctx: Context) {
    super(ctx, 'artifacts')
  }
  get(id: string) { return CREATED.has(id) ? { id, createdAt: CREATED.get(id) } : undefined }
  list() { return [] }
}

async function boot(options: { eventLog?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'system-ui-round2-'))
  writeFileSync(join(dir, 'operator.token'), Buffer.alloc(32, 7), { mode: 0o600 })
  const token = Buffer.alloc(32, 7).toString('base64url')
  const ctx = new Context()
  const fibers = [ctx.plugin(StubWorkflow), ...(options.eventLog === false ? [] : [ctx.plugin(StubEventLog)]), ctx.plugin(StubArtifacts),
    ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }), ctx.plugin(WebUi, { tokenDir: dir, clientDir: builtClient() })]
  await Promise.all(fibers)
  onTestFinished(async () => { for (const f of [...fibers].reverse()) await f.dispose() })
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  const origin = `http://127.0.0.1:${(ctx as unknown as { webServer: { port: number } }).webServer.port}`
  return { ctx, origin, token, log: (ctx as unknown as { eventLog?: StubEventLog }).eventLog }
}




describe('web UI round 2: a step\'s timings from the event log (T256)', () => {
  it('gives each step\'s start and, once it ended, its end; with no log, or a log that fails, why they are unknown, never none', async () => {
    const { origin, token, log } = await boot()
    const read = async (runId: string) => (await (await fetch(`${origin}/ui/api/runs/${runId}`, { headers: { authorization: `Bearer ${token}` } })).json()) as Record<string, unknown>
    expect((await read('run_timed'))['timings']).toEqual({ value: { 'develop:1': { startedAt: at('09:00'), endedAt: at('09:14') }, 'review:1': { startedAt: at('09:20') } } })
    expect((await read('run_ended'))['timings']).toEqual({ value: { 'develop:1': { startedAt: at('08:00'), endedAt: at('08:10') }, 'review:1': { startedAt: at('08:11'), endedAt: at('08:25') } } })
    // Each decision with when it was made, from its artifact.
    const explain = (await read('run_timed'))['explain'] as { nodes: Array<{ nodeId: string; decisions: Array<{ id: string; at?: string }> }> }
    expect(explain.nodes[0]!.decisions.map((d) => d.at)).toEqual([at('09:00'), at('09:05'), at('09:07')])
    log!.fail = true
    expect((await read('run_timed'))['timings']).toEqual({ unknown: 'the event log could not be read: the log is locked' })
  })

  it('says the timings are unknown when no event log is mounted', async () => {
    const { origin, token } = await boot({ eventLog: false })
    const run = await (await fetch(`${origin}/ui/api/runs/run_timed`, { headers: { authorization: `Bearer ${token}` } })).json() as Record<string, unknown>
    expect(run['timings']).toEqual({ unknown: 'the event log (ctx.eventLog) is not mounted' })
  })
})
