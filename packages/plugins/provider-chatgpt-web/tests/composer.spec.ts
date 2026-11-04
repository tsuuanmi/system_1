import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('ChatGptWebDriver against the fake site, with no real account (QA-10): the composer, Chat and Work, and healing', () => {
  const { site } = fakeSite()

  it('never sends from a composer that names Work, though Chat reads as pressed (live 2026-10-18)', async () => {
    const { fake, page, driver } = await site({ workComposer: true })
    await expect(driver.ask(page, 'hello', { conversation: 'persistent' })).rejects.toMatchObject({ kind: 'ui_drift', message: expect.stringMatching(/Work with ChatGPT.*Codex quota/) })
    expect(fake.sent).toEqual([])
    // Nothing typed is left behind.
    expect((await page.locator('#input').textContent())?.trim()).toBe('')
  }, 40_000)
})
