import { describe, expect, it } from 'vitest'
import { parseFindings } from '../src/teams.ts'


describe('team answers', () => {
  const json = JSON.stringify({ findings: [{ severity: 'blocking', claim: 'The lease leaks', evidence: 'line 3' }] }, null, 2)

  it('refuses an answer with no findings object, saying why', () => {
    const last = ['```json', json, '```', 'An example:']
    for (const text of [
      'No JSON here.', '```ts\nconst a = { b: 1 }\n```', '{"findings": "none"}',
      // The last JSON block decides: a list or an object of another shape there is refused, never read past.
      [...last, '```json', '[{"severity": "info"}]', '```'].join('\n'),
      [...last, '```json', '{"choice": "pass"}', '```'].join('\n'),
    ]) {
      expect(parseFindings(text)).toMatch(/no JSON object holding "findings"/)
    }
  })
})
