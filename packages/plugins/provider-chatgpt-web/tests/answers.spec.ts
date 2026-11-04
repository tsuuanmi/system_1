import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('ChatGptWebDriver against the fake site, with no real account (QA-10): modes, features, and answers', () => {
  const { site } = fakeSite()

  it('asks in Temporary chat after switching Work to Chat, and waits for completion though the stream stays open', async () => {
    const { fake, page, driver } = await site({ answer: 'Hello from the fake site' })
    const drift: unknown[] = []
    driver.onDrift = (event) => drift.push(event)
    const turn = await driver.ask(page, 'Reply with a greeting', { conversation: 'temporary' })
    expect(drift).toEqual([]) // the shipped primary candidates match the live structure
    expect(turn.text).toBe('Hello from the fake site')
    expect(fake.sent).toEqual([expect.objectContaining({ prompt: 'Reply with a greeting', mode: 'chat', temporary: true })])
    expect(turn.binding).toBeUndefined()
  }, 40_000)

  // A web-cited answer: the page renders each citation as a link chip, and Copy yields
  // reference-style links whose URLs carry tracking parameters (2026-10-15).

  it('sends nothing when beforeSend throws (the receipt could not be persisted)', async () => {
    const { fake, page, driver } = await site()
    const failure = driver.ask(page, 'x', { conversation: 'temporary', beforeSend: () => { throw new Error('store unavailable') } })
    await expect(failure).rejects.toThrow(/store unavailable/)
    expect(fake.sent).toEqual([])
  }, 30_000)
})
