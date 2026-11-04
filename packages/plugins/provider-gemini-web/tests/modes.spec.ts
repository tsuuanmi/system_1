import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('GeminiWebDriver against the fake site: modes, the Chat tab, and Temporary chat', { timeout: 60_000 }, () => {
  const { open } = fakeSite()

  it('asks in a Temporary chat on the Chat tab, never Spark, with the preset read back before sending', async () => {
    const { page, driver, fake } = await open({ answer: 'Gemini test OK.' })
    const boundaries: unknown[] = []
    const result = await driver.ask(page, 'Say OK', { conversation: 'temporary', mode: 'pro', beforeSend: (b) => void boundaries.push(b) })
    expect(result).toEqual({ text: 'Gemini test OK.', binding: undefined, mode: { model: '3.1 Pro', effort: 'High' } })
    expect(fake.sent).toEqual([{ prompt: 'Say OK', tab: 'chat', temporary: true, model: '3.1 Pro', level: 'High', deepResearch: false }])
    expect(boundaries).toEqual([{ previousResponse: null, mode: { model: '3.1 Pro', effort: 'High' } }])
  })
})
