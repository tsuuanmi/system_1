import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('ChatGptWebDriver against the fake site, with no real account (QA-10): persistent conversations, stalls, and snapshots', () => {
  const { site } = fakeSite()

  it('keeps a persistent conversation id and continues the same conversation', async () => {
    const { fake, page, driver } = await site({ answer: 'first answer' })
    const first = await driver.ask(page, 'one', { conversation: 'persistent' })
    expect(first.text).toBe('first answer')
    expect(first.binding).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.sent[0]).toMatchObject({ mode: 'chat', temporary: false })

    fake.options.answer = 'second answer'
    const boundaries: Array<string | null> = []
    const second = await driver.ask(page, 'two', { conversation: 'persistent', binding: first.binding, beforeSend: ({ previousResponse }) => { boundaries.push(previousResponse) } })
    expect(boundaries).toEqual(['first answer'])
    expect(second.text).toBe('second answer')
    expect(second.binding).toBe(first.binding)
    expect(fake.sent[1]).toMatchObject({ conversationId: first.binding })
  }, 60_000)
})
