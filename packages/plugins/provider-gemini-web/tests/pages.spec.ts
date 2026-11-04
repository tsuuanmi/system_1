import type { DriftEvent } from '@tsuuanmi/system-ui-ops'
import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { GeminiWebDriver } from '../src/index.ts'
import { fakeSite, PRESETS, TIMEOUTS } from './site.ts'


describe.runIf(canRunBrowser)('GeminiWebDriver against the fake site: sign-in, challenges, and the site\'s own pages', { timeout: 60_000 }, () => {
  const { open } = fakeSite()

  it('names no one when two shown account buttons name different accounts: the hidden fallback is never read past them, nor past two hidden ones', async () => {
    const { page, fake } = await open()
    const driver = new GeminiWebDriver({ origin: fake.origin, modes: PRESETS, defaultMode: 'flash', timeouts: { ...TIMEOUTS, readyMs: 1500, accountMs: 500 } })
    await page.goto(`${fake.origin}/app`)
    expect(await driver.identity(page)).toBe('Test User (test@example.test)')
    // A second shown link naming another account, and a hidden one naming the first: ambiguous, never the hidden one's or the first shown one's.
    await page.evaluate(() => document.querySelector('header')!.insertAdjacentHTML('beforeend', '<a href="#" aria-label="Google Account: Other User (other@example.test)">O</a><a href="#" aria-label="Google Account: Test User (test@example.test)" hidden>T</a>'))
    const saving = new GeminiWebDriver({ origin: fake.origin, modes: PRESETS, defaultMode: 'flash', timeouts: { ...TIMEOUTS, readyMs: 1500, accountMs: 500 } })
    const drifts: DriftEvent[] = []
    saving.onDrift = (event) => void drifts.push(event)
    await expect(saving.identity(page)).rejects.toMatchObject({ kind: 'ui_drift', message: expect.stringMatching(/exactly one account/) })
    expect(drifts).toEqual([expect.objectContaining({ element: 'auth.account', kind: 'unresolved', matches: [{ found: 3, shown: 2 }, { found: 0, shown: 0 }] })])
    expect(await saving.checkAuth(page, { save: true })).toBe('unknown')
    // All hidden, naming two accounts: no one either.
    await page.evaluate(() => { for (const link of document.querySelectorAll('header a')) link.setAttribute('hidden', '') })
    await expect(saving.identity(page)).rejects.toMatchObject({ kind: 'ui_drift' })
    expect(await saving.checkAuth(page, { save: true })).toBe('unknown')
    // Hidden and naming one account only (the other removed): that account.
    await page.evaluate(() => document.querySelector('[aria-label^="Google Account: Other"]')!.remove())
    expect(await saving.identity(page)).toBe('Test User (test@example.test)')
  })

  it('fails a page that shows neither signed in nor signed out once, as drift, never as a session to retry', async () => {
    const { page, fake } = await open({ interstitial: true })
    const driver = new GeminiWebDriver({ origin: fake.origin, modes: PRESETS, defaultMode: 'flash', timeouts: { readyMs: 1500 } })
    await expect(driver.ask(page, 'hello', { conversation: 'temporary' })).rejects.toMatchObject({
      kind: 'ui_drift', disposition: 'CONFIG_FIX',
      message: 'gemini-web: the page showed neither the app, the signed-in account, nor a sign-in page within 1.5 s; a dialog or menu is open (outlined as a ui.drift of auth.account)',
    })
    expect(fake.sent).toEqual([])
  })
})
