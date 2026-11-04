import { describe, expect, it } from 'vitest'
import { compose, type NodeTemplate, parsePlan, preflight, UnfilledPlaceholders, unfilledPlaceholders } from '../src/spec.ts'

const node = (nodeId: string, overrides: Partial<NodeTemplate> = {}): NodeTemplate => ({
  nodeId, objective: 'x', prompt: '{{input}}', capabilities: ['reason'], tier: 'standard', conversation: 'temporary', acceptance: 'acceptance.answer', ...overrides,
})

describe('workflow specs', () => {
  it('refuses invalid DAGs before anything runs (REQ-WF-1)', () => {
    expect(() => preflight([])).toThrow(/no nodes/)
    expect(() => preflight([node('a'), node('a')])).toThrow(/duplicate node a/)
    expect(() => preflight([node('a', { dependsOn: ['b'] })])).toThrow(/unknown node b/)
    expect(() => preflight([node('a', { dependsOn: ['b'] }), node('b', { dependsOn: ['a'] })])).toThrow(/cycle/)
    expect(() => preflight([node('a'), node('b', { prompt: '{{node:a}}' })])).toThrow(/b uses a, which it does not depend on/)
    expect(() => preflight([node('bad id!')])).toThrow(/node id/)
    expect(() => preflight([node('a'), node('b', { dependsOn: ['a'] }), node('c')])).toThrow(/one final node/)
  })

  it('composes every placeholder of a template or none: one it cannot fill throws, naming it, and text it inserts is never scanned (INV-2)', () => {
    const ref = `sha256:${'e'.repeat(64)}` as const
    const unfilled = (prompt: string, results: Record<string, typeof ref> = {}, extras = {}): string[] => {
      try {
        compose(prompt, 'x', results, extras)
      } catch (error) {
        expect(error).toBeInstanceOf(UnfilledPlaceholders)
        return (error as UnfilledPlaceholders).placeholders
      }
      return []
    }
    expect(unfilled('Q: {{input}} {{node:a}} {{node:b}}', { a: ref })).toEqual(['{{node:b}}'])
    expect(unfilled('{{grown}} {{team}}')).toEqual(['{{grown}}', '{{team}}'])
    expect(unfilled('{{grown}} {{team}}', {}, { grown: [], team: 'ballot' })).toEqual([])
    expect(unfilled('{{other}} {{ input }} {{{input}}} {{input')).toEqual(['{{other}}', '{{ input }}', '{{{input}}', '{{input…'])
    // JSON in a template opens no placeholder; the caller's text is data, sent as written.
    expect(unfilled('{{input}}: {"a": {"b": [{"c": 1}]}}')).toEqual([])
    expect(compose('Q: {{input}}', 'what does {{input}} do?', {})).toEqual({ segments: [{ text: 'Q: what does {{input}} do?' }], pointers: [] })
    expect(unfilledPlaceholders('{{input}} {{node:a}} {{grown}} {{team}}', { refs: { a: ref }, grown: true, team: true })).toEqual([])
  })

  it('parses a model-written plan as untrusted input, and refuses anything outside the bounds (INV-6)', () => {
    const text = 'Here is the plan:\n```json\n' + JSON.stringify({
      confidence: 'high',
      nodes: [
        { id: 'a', objective: 'first', prompt: 'do a', capabilities: ['reason'], tier: 'economy' },
        { id: 'b', objective: 'second', prompt: 'do b', capabilities: ['reason'], tier: 'standard', dependsOn: ['a'] },
      ],
    }) + '\n```'
    const plan = parsePlan(text, 'plan:1', { maxNodes: 3, capabilities: ['reason'] })
    expect(plan).toEqual({ ok: true, confidence: 'high', nodes: [
      { nodeId: 'plan:1:a', objective: 'first', prompt: 'do a', capabilities: ['reason'], tier: 'economy', dependsOn: [] },
      { nodeId: 'plan:1:b', objective: 'second', prompt: 'do b', capabilities: ['reason'], tier: 'standard', dependsOn: ['plan:1:a'] },
    ] })
    const bad = (nodes: unknown[], extra = {}) => parsePlan(JSON.stringify({ confidence: 'low', nodes }), 'plan:1', { maxNodes: 2, capabilities: ['reason'], ...extra })
    const step = (id: string, more = {}) => ({ id, objective: 'o', prompt: 'p', capabilities: ['reason'], tier: 'economy', ...more })
    expect(parsePlan('no plan here', 'plan:1', { maxNodes: 2, capabilities: ['reason'] })).toMatchObject({ ok: false, reason: expect.stringMatching(/no JSON plan/) })
    expect(bad([step('a'), step('b'), step('c')])).toMatchObject({ ok: false, reason: expect.stringMatching(/at most 2/) })
    expect(bad([step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })])).toMatchObject({ ok: false, reason: expect.stringMatching(/cycle/) })
    expect(bad([step('a', { dependsOn: ['synthesis:1'] })])).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown/) })
    expect(bad([step('a', { capabilities: ['develop'] })])).toMatchObject({ ok: false, reason: expect.stringMatching(/develop/) })
    expect(bad([step('a'), step('a')])).toMatchObject({ ok: false, reason: expect.stringMatching(/duplicate/) })
    expect(bad([step('a', { tier: 'ultra' })])).toMatchObject({ ok: false })
  })
})
