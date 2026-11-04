/**
 * Workers the operator keeps out of teams (`teams.excludeWorkers`, docs/design/teams.md#workers-left-out-of-teams):
 * no team member, the first one included, joins on a Worker it names or on any other Worker of
 * that Worker's account, or on an account it names; `allowSameFamily` never lifts it; the Workers
 * still take every other node; a team the exclusion leaves too few provider families fails
 * `config_error` before anything is sent; a member resuming its conversation on a Worker left out
 * keeps it only as this team's own in this run, recorded. The Workers are scripted as a website
 * account's tiers (siblings of one another), a second website account, and a model Worker of the
 * first one's family.
 */
import type { CapabilityDescriptor } from '@tsuuanmi/system-workers-core'
import { describe, expect, it } from 'vitest'
import { worker } from '../../../workers-core/conformance/workers.ts'
import type { Engine } from '../src/engine.ts'
import { type Config } from '../src/index.ts'
import type { ResolvedNode } from '../src/spec.ts'
import { leftOutOfTeams, restriction } from '../src/teams.ts'
import type { RunRow } from '../src/types.ts'

/** A Worker a team member may take: it reasons and keeps its conversation. */
const member = (id: string, family: string, extra: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor => worker(id, {
  schema: 'capability-descriptor@1.5', provider: family, family, proves: ['reason', 'persistent-conversation'], ...extra,
})
const account = (id: string, group: string) => ({ account: { id, group, mode: 'assigned' as const } })

/** A website account's tiers, as its source describes them (economy is not configured, so never described). */
const WEB = [member('w:web/standard', 'family-web', account('web-main', 'web')), member('w:web/frontier', 'family-web', { ...account('web-main', 'web'), tier: 'frontier' })]
const WEB_TIERS = ['w:web/economy', 'w:web/standard', 'w:web/frontier']
const CHAT = member('w:chat/standard', 'family-chat', account('chat-main', 'chat'))
/** A model Worker of the website's family, metered, on no account. */
const API = member('m:api', 'family-web', { quotaClass: 'metered' })







describe('the Workers teams.excludeWorkers leaves out of teams', () => {
  const siblings = (sets: string[][]) => (w: string): string[] => sets.find((s) => s.includes(w)) ?? [w]

  it('refuses a named Worker no source describes now when its described siblings name different accounts (fail closed)', () => {
    // w:web/economy is never described; its source names the tiers, whose descriptors disagree on the account.
    const odd = member('w:web/frontier', 'family-web', account('web-other', 'web'))
    const left = leftOutOfTeams(['w:web/economy'], [WEB[0]!, odd, CHAT], siblings([WEB_TIERS]))
    expect(left.problem).toMatch(/^teams\.excludeWorkers entry w:web\/economy: its source names w:web\/economy, w:web\/frontier, w:web\/standard as the Workers of its account, and their descriptors name different accounts/)
  })
})

describe('a team member\'s allowed Workers under teams.excludeWorkers', () => {
  /**
   * An engine as `restriction` reads it: the team's nodes, the sessions held (`held`, each joined
   * in `groups` when given), and the Workers listed.
   */
  const engine = (config: Config, nodes: Array<Partial<ResolvedNode>>, held: Record<string, string> = {}, options: { listed?: CapabilityDescriptor[]; groups?: Record<string, string> } = {}): Engine => ({
    config,
    nodeRows: () => nodes.map((spec) => ({ spec: JSON.stringify(spec) })),
    ctx: {
      workers: {
        affinity: (sessionId: string) => (held[sessionId] ? [held[sessionId]] : undefined),
        list: async () => options.listed ?? [...WEB, CHAT, API],
        siblings: (w: string) => (WEB_TIERS.includes(w) ? WEB_TIERS : [w]),
      },
      workerSessions: { session: (sessionId: string) => (held[sessionId] ? { worker: held[sessionId], group: options.groups?.[sessionId] } : undefined) },
    },
  }) as unknown as Engine
  const RUN = { run_id: 'r1' } as RunRow
  const m = (k: number, role: 'propose' | 'ballot' | 'debate' = 'propose'): Partial<ResolvedNode> => ({ nodeId: `brainstorm:m${k}:${role}`, team: { id: 'brainstorm', kind: 'brainstorm', role, member: k, members: 2, debateRounds: 1 }, session: { sessionId: `s${k}` } })
  const TEAMS = { teams: { excludeWorkers: ['web-main'] } }

  it('refuses every member, whatever its role, when the exclusion leaves the team too few provider families (B1, INV-2)', async () => {
    const listed = [...WEB, CHAT]
    const shortage = 'team brainstorm needs 2 provider families, one per member; 1 is ready outside the operator\'s teams.excludeWorkers, which leaves 1 more out of teams (ADR-0027, REQ-TEAM-8)'
    for (const node of [m(1), m(2, 'ballot'), m(2, 'debate')]) {
      expect(await restriction(engine(TEAMS, [m(1), m(2)], {}, { listed }), RUN, node as ResolvedNode))
        .toEqual({ problem: `${shortage}; nothing was sent for member m${node.team!.member}` })
    }
    // Every Worker listed left out: no member can join.
    expect(await restriction(engine({ teams: { excludeWorkers: ['web-main', 'chat-main'] } }, [m(1), m(2)], {}, { listed }), RUN, m(1) as ResolvedNode))
      .toEqual({ problem: 'team brainstorm: the operator\'s teams.excludeWorkers leaves out every Worker listed now (3), so no member can join (REQ-TEAM-8, INV-2); nothing was sent for member m1' })
  })
})
