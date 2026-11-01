// The autonomy policy's sandboxed-command rule (autonomy-policy@1.7, PROP-0022 1b, ADR-0080): in a
// workspace-write run whose two confinements the runtime proved, a Bash call that no forbid or ask
// shape of the rule matches is `auto`, under `enforce.sandboxedCommands: on`. Order: forbid, ask,
// the rule, the class default. `warn` records the verdict the rule would give and still asks; `off`
// ignores the rule. With no session, a call the policy asks about is denied `no-session`: how a test
// sees that it asked.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import StoreApprovals, { policyProblems } from '@tsuuanmi/system-approvals'
import { type AutonomyPolicy, sandboxedCommandOf } from '@tsuuanmi/system-approvals-core'
import Artifacts from '@tsuuanmi/system-artifacts'
import EventLog from '@tsuuanmi/system-event-log'
import Store from '@tsuuanmi/system-store'
import type { EnforceMode } from '@tsuuanmi/system-libs'
import { afterAll, describe, expect, it, onTestFinished } from 'vitest'
import { DENIAL_MIGRATION, GATE_MIGRATION, runGate } from '../src/gate.ts'

type GateRun = Parameters<typeof runGate>[1]

const base = realpathSync(mkdtempSync(join(tmpdir(), 'system-sandboxed-commands-')))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const ws = join(base, 'ws')
mkdirSync(ws)

const SANDBOXED = {
  id: 'sandboxed-bash',
  forbid: [{ id: 'no-sudo', program: 'sudo', note: 'never as another user' }],
  ask: [
    { id: 'no-push', program: 'git', words: ['push'], note: 'a push leaves the machine' },
    { id: 'no-curl', program: 'curl', note: 'a download is the operator\'s' },
    { id: 'outside-path', anyWord: '^/etc/', note: 'a path outside the worktree' },
  ],
  note: 'a sandboxed Bash call the policy does not name runs without the operator',
}

const policy = (modes: Record<string, AutonomyPolicy['rules'][number]['mode']> = {}, withRule = true): AutonomyPolicy => {
  const all: Record<string, AutonomyPolicy['rules'][number]['mode']> = { 'read': 'auto', 'workspace-write': 'auto', 'command': 'ask', 'external-send': 'ask', 'merge': 'ask', ...modes }
  return {
    schema: 'autonomy-policy@1.7', id: 'studio-test', version: 1, scope: 'studio', default: 'ask', expiry: { defaultSeconds: 3600, maxSeconds: 86_400 },
    rules: Object.entries(all).map(([actionClass, mode]) => ({ actionClass: actionClass as AutonomyPolicy['rules'][number]['actionClass'], mode })),
    ...(withRule ? { sandboxedCommands: SANDBOXED } : {}),
  }
}

async function boot(set: AutonomyPolicy, run: Partial<GateRun> = {}, mode: EnforceMode = 'on') {
  const dir = mkdtempSync(join(base, 'boot-'))
  const ctx = new Context()
  const fibers = [ctx.plugin(Store, { path: join(dir, 'system.db') }), ctx.plugin(Artifacts, {}), ctx.plugin(EventLog, {}), ctx.plugin(StoreApprovals, { policies: [set] })]
  await Promise.all(fibers)
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  // The gate's own table of the requests it opened (agent-workers' migrations), for a run with a session.
  if (run.sessionId) ctx.store.db.exec(`${GATE_MIGRATION.sql}\n${DENIAL_MIGRATION.sql}`)
  const gate = runGate(ctx, {
    runId: 'arun_t', worker: 'dev', workspace: ws, classification: 'public', sandbox: 'workspace-write', commandsSandboxed: true, sandboxedCommands: () => mode, ...run,
  }).gate
  const signal = new AbortController().signal
  const verdict = (command: string, input: Record<string, unknown> = {}) => gate({ tool: 'Bash', input: { command, ...input }, callId: 'c1' }, signal)
  const decisions = () => ctx.artifacts.list({ kind: 'decision' }).map((a) => a.body as { decisionType: string; decider: { id: string }; outcome: { option: string; detail?: Record<string, unknown> } })
  return { ctx, verdict, decisions, fibers }
}

const asked = (v: { decision: string; reason?: string }): boolean => v.decision === 'deny' && /has no session/.test(v.reason ?? '')

describe('the sandboxed-command rule, on (autonomy-policy@1.7, ADR-0080)', () => {
  it('allows a call no forbid or ask shape matches, as an autonomy decision naming the rule', async () => {
    const { verdict, decisions } = await boot(policy())
    expect(await verdict('make build')).toEqual({ decision: 'allow' })
    expect(await verdict('node scripts/run.js --flag')).toEqual({ decision: 'allow' })
    const autonomy = decisions().filter((d) => d.decisionType === 'autonomy')
    // Decisions are content-addressed and name no command, so the two calls share one `auto` decision.
    expect(autonomy).toHaveLength(1)
    for (const d of autonomy) expect(d).toEqual(expect.objectContaining({ outcome: expect.objectContaining({ option: 'auto', detail: expect.objectContaining({ sandboxedCommand: { rule: 'sandboxed-bash', outcome: 'auto' } }) }) }))
  })

  it('a forbid shape wins over the rule', async () => {
    const { verdict } = await boot(policy())
    const denied = await verdict('sudo make install')
    expect(denied.decision).toBe('deny')
    expect(asked(denied)).toBe(false)
    expect(denied).toEqual(expect.objectContaining({ reason: expect.stringContaining('no-sudo') }))
  })

  it('an ask shape wins over the rule: program, subcommand words, or any word', async () => {
    const { verdict } = await boot(policy())
    for (const command of ['git push origin main', '/usr/bin/git push', 'curl http://example.com', 'make /etc/passwd']) expect(asked(await verdict(command)), command).toBe(true)
    // A shape names its words whole: another subcommand of the same program is not it.
    expect(await verdict('git status')).toEqual({ decision: 'allow' })
  })

  it('asks in a read-only run, an unproved run, and a call asking to run unsandboxed (never allowed)', async () => {
    const readOnly = await boot(policy(), { sandbox: 'read-only' })
    expect(asked(await readOnly.verdict('make build'))).toBe(true)
    const unproved = await boot(policy(), { commandsSandboxed: false })
    expect(asked(await unproved.verdict('make build'))).toBe(true)
    const unspecified = await boot(policy(), { commandsSandboxed: undefined })
    expect(asked(await unspecified.verdict('make build'))).toBe(true)
    const { verdict } = await boot(policy())
    // The gate refuses the field outright: the call is denied, never allowed by the rule.
    expect((await verdict('make build', { dangerouslyDisableSandbox: true })).decision).toBe('deny')
  })

  it('leaves a forbidden command class forbidden, and a policy that carries no rule asking', async () => {
    const forbidden = await boot(policy({ command: 'forbid' }))
    const denied = await forbidden.verdict('make build')
    expect(denied.decision).toBe('deny')
    expect(asked(denied)).toBe(false)
    const none = await boot(policy({}, false))
    expect(asked(await none.verdict('make build'))).toBe(true)
  })

  it('never reaches a review member or a research run', async () => {
    const member = await boot(policy(), { profile: 'review-member' })
    expect((await member.verdict('make build')).decision).toBe('deny')
    const research = await boot(policy(), { profile: 'research' })
    expect((await research.verdict('make build')).decision).toBe('deny')
  })
})

describe('an ask shape opens an approval, in a session (approval context kept)', () => {
  // The command class alone is auto: only the ask shape makes `curl` ask, so the queue must judge the
  // request in the context the gate's decision was made in, or it refuses it as not asked.
  it('queues one request for exactly the call, kept by the sweep and never counted toward a commands-list proposal', async () => {
    const { ctx, verdict } = await boot(policy({ command: 'auto' }), { sessionId: 'ses_1' })
    const deferred = await verdict('curl http://example.com')
    expect(deferred).toEqual(expect.objectContaining({ decision: 'defer', reason: expect.stringContaining('waits for the operator\'s approval') }))
    const open = await ctx.approvals.list({})
    expect(open).toHaveLength(1)
    expect(open[0]).toEqual(expect.objectContaining({ state: 'open', action: expect.objectContaining({ class: 'command' }), requester: expect.objectContaining({ sessionId: 'ses_1' }) }))
    // The cited decision names the shape that asked.
    const cited = ctx.artifacts.get(open[0]!.policy.decision)?.body as { outcome: { option: string; detail: Record<string, unknown> } }
    expect(cited.outcome).toEqual(expect.objectContaining({ option: 'ask', detail: expect.objectContaining({ sandboxedCommand: { rule: 'sandboxed-bash', outcome: 'ask', by: 'no-curl' } }) }))
    // The queue's own pass keeps it open: the class is auto, but the shape that asked still holds.
    await ctx.approvals.sweep(new Date(open[0]!.createdAt))
    expect((await ctx.approvals.get(open[0]!.requestId))?.state).toBe('open')
    // Listing it would put it past its shape: it is never counted toward a proposal.
    expect(ctx.store.db.prepare('SELECT COUNT(*) AS n FROM request_shapes').get()).toEqual({ n: 0 })
  })

  it('withdraws it once the loaded policy holds the shape no more', async () => {
    const { ctx, verdict, fibers } = await boot(policy({ command: 'auto' }), { sessionId: 'ses_2' })
    expect((await verdict('curl http://example.com')).decision).toBe('defer')
    const [request] = await ctx.approvals.list({})
    // The queue restarts on the same store with the shape gone (same version: only the shape moves);
    // its pass at start withdraws what the loaded policies no longer ask for.
    await fibers[3]!.dispose()
    const without = { ...policy({ command: 'auto' }), sandboxedCommands: { ...SANDBOXED, ask: SANDBOXED.ask.filter((s) => s.id !== 'no-curl') } }
    const again = ctx.plugin(StoreApprovals, { policies: [without] })
    onTestFinished(async () => {
      await again.dispose()
    })
    await again
    const now = await ctx.approvals.get(request!.requestId)
    expect(now).toEqual(expect.objectContaining({ state: 'rejected', resolution: expect.objectContaining({ cause: 'withdrawn' }) }))
  })
})

describe('the enforce switch agent-workers.enforce.sandboxedCommands', () => {
  it('warn still asks, and records the verdict the rule would give', async () => {
    const { verdict, decisions } = await boot(policy(), {}, 'warn')
    expect(asked(await verdict('make build'))).toBe(true)
    expect(asked(await verdict('git push'))).toBe(true)
    const would = decisions().filter((d) => d.outcome.detail?.['sandboxedWould'] !== undefined)
    expect(would).toEqual([
      expect.objectContaining({ decisionType: 'gate', decider: expect.objectContaining({ id: 'agent-workers.tool-gate' }), outcome: expect.objectContaining({ option: 'ask', detail: expect.objectContaining({ sandboxedWould: 'auto', sandboxedRule: 'sandboxed-bash', command: 'make build' }) }) }),
      expect.objectContaining({ outcome: expect.objectContaining({ detail: expect.objectContaining({ sandboxedWould: 'ask', sandboxedBy: 'no-push', command: 'git push' }) }) }),
    ])
    // No autonomy decision of the run said auto.
    expect(decisions().filter((d) => d.decisionType === 'autonomy').every((d) => d.outcome.option === 'ask')).toBe(true)
  })

  it('warn records nothing in a run the rule does not reach', async () => {
    const { verdict, decisions } = await boot(policy(), { sandbox: 'read-only' }, 'warn')
    expect(asked(await verdict('make build'))).toBe(true)
    expect(decisions().filter((d) => d.outcome.detail?.['sandboxedWould'] !== undefined)).toEqual([])
  })

  it('off ignores the rule: the call asks, and nothing is recorded', async () => {
    const { verdict, decisions } = await boot(policy(), {}, 'off')
    expect(asked(await verdict('make build'))).toBe(true)
    expect(decisions().filter((d) => d.outcome.detail?.['sandboxedWould'] !== undefined)).toEqual([])
  })

  it('a run with no switch (a Codex Worker: its runtime proves no SDK sandbox) is unchanged', async () => {
    const { verdict } = await boot(policy(), { commandsSandboxed: undefined, sandboxedCommands: undefined })
    expect(asked(await verdict('make build'))).toBe(true)
  })
})

describe('the policy set that holds the rule', () => {
  it('loads, and refuses a shape id used twice or an anyWord that is no regular expression', () => {
    expect(policyProblems([policy()])).toEqual([])
    const bad = { ...policy(), sandboxedCommands: { ...SANDBOXED, ask: [{ id: 'a', anyWord: '(', note: 'x' }, { id: 'no-sudo', program: 'x', note: 'x' }] } }
    expect(policyProblems([bad])).toEqual([
      'policy studio-test: sandboxed command shape a: anyWord is not a regular expression',
      'policy studio-test: sandboxed command shape no-sudo: another shape has the same id',
    ])
  })
})

describe('sandboxedCommandOf', () => {
  it('answers in the order forbid, ask, the rule, and only for the studio policy that holds the rule', () => {
    const studio = policy()
    expect(sandboxedCommandOf([studio], ['sudo', 'ls'])).toEqual({ rule: 'sandboxed-bash', outcome: 'forbid', by: 'no-sudo' })
    expect(sandboxedCommandOf([studio], ['git', 'push'])).toEqual({ rule: 'sandboxed-bash', outcome: 'ask', by: 'no-push' })
    expect(sandboxedCommandOf([studio], ['make'])).toEqual({ rule: 'sandboxed-bash', outcome: 'auto' })
    expect(sandboxedCommandOf([policy({}, false)], ['make'])).toBeUndefined()
    // A project policy only adds shapes that ask or forbid.
    const project: AutonomyPolicy = { ...policy({}, false), id: 'p.policy', scope: 'project', projectId: 'p', narrows: 'studio-test', sandboxedCommands: { id: 'p-rule', ask: [{ id: 'p-make', program: 'make', note: 'make asks here' }], note: 'narrows' } }
    expect(sandboxedCommandOf([studio, project], ['make'])).toEqual({ rule: 'sandboxed-bash', outcome: 'ask', by: 'p-make' })
    expect(sandboxedCommandOf([policy({}, false), project], ['make'])).toBeUndefined()
  })
})
