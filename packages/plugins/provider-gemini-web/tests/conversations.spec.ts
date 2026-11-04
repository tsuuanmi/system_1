import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('GeminiWebDriver against the fake site: persistent conversations and their snapshots', { timeout: 60_000 }, () => {
  const { open } = fakeSite()

  it('continues a persistent conversation by its /app/<id> binding, reported as soon as it exists', async () => {
    const { page, driver, fake } = await open({ answer: 'first answer' })
    const bound: string[] = []
    const first = await driver.ask(page, 'one', { conversation: 'persistent', onBinding: (b) => void bound.push(b) })
    expect(first.binding).toMatch(/^[0-9a-f]{16}$/)
    expect(bound).toEqual([first.binding])
    const boundaries: unknown[] = []
    const second = await driver.ask(page, 'two', { conversation: 'persistent', binding: first.binding, beforeSend: (b) => void boundaries.push(b) })
    expect(second.binding).toBe(first.binding)
    expect(boundaries).toEqual([{ previousResponse: 'first answer', mode: { model: '3.8 Flash', effort: 'Medium' } }])
    expect(fake.sent.map((s) => [s.temporary, s.conversationId])).toEqual([[false, undefined], [false, first.binding]])
  })
})
