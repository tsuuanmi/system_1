import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('ChatGptWebDriver against the fake site, with no real account (QA-10): sign-in, challenges, and the site\'s own pages', () => {
  const { site } = fakeSite()

  it('stops at a challenge page as a challenge, at once and with nothing sent', async () => {
    const { page, driver, fake } = await site({ captcha: true })
    const started = Date.now()
    await expect(driver.checkAuth(page)).rejects.toMatchObject({ kind: 'challenge', disposition: 'USER_ACTION', message: expect.stringMatching(/Verify you are human/) })
    expect(Date.now() - started).toBeLessThan(20_000)
    await expect(driver.ask(page, 'hello', { conversation: 'temporary' })).rejects.toMatchObject({ kind: 'challenge' })
    expect(fake.sent).toEqual([])
  }, 60_000)

  it('fails closed as reauth_required when signed out', async () => {
    const { fake, page, driver } = await site({ signedIn: false })
    await expect(driver.ask(page, 'x', { conversation: 'temporary' })).rejects.toMatchObject({ kind: 'reauth_required' })
    expect(fake.sent).toEqual([])
  }, 30_000)
})
