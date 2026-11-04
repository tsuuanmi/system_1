import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('GeminiWebDriver against the fake site: a Deep research run in progress', { timeout: 60_000 }, () => {
  const { open } = fakeSite()

  it('loads a conversation once more when its plan never renders, resending nothing, then starts the plan (live 2026-10-19)', async () => {
    const { page, driver, fake } = await open({ planHangs: true }, { timeouts: { readyMs: 5000, stableMs: 300, pollMs: 100, turnMs: 30_000, stallMs: 15_000, planHangMs: 2000 } })
    const reloads: unknown[] = []
    const stalls: Array<{ phase: string }> = []
    driver.onReload = (event) => void reloads.push(event)
    driver.onStall = (event) => void stalls.push(event)
    const result = await driver.ask(page, 'Compare HTTP/2 and HTTP/3', { conversation: 'persistent', feature: 'deep-research' })
    expect(result.text).toBe('HTTP/3 runs over QUIC, not TCP.\n\nSources:\n- RFC 9114: HTTP/3 https://www.rfc-editor.org/rfc/rfc9114')
    expect(reloads).toEqual([{ provider: 'gemini-web', phase: 'research-plan', binding: result.binding }])
    // The page as it hung is outlined before the reload.
    expect(stalls.map((e) => e.phase)).toEqual(['research-plan'])
    expect(fake.sent).toHaveLength(1)
    expect(fake.started).toEqual([result.binding])
  })
})
