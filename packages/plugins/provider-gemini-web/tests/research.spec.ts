import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('GeminiWebDriver against the fake site: Deep research and its presets', { timeout: 60_000 }, () => {
  const { open } = fakeSite()

  it('runs Deep research: chosen from More tools, its plan started, and its report returned with the sources it used', async () => {
    const { page, driver, fake } = await open()
    const result = await driver.ask(page, 'Compare HTTP/2 and HTTP/3', { conversation: 'persistent', feature: 'deep-research' })
    expect(result.text).toBe('HTTP/3 runs over QUIC, not TCP.\n\nSources:\n- RFC 9114: HTTP/3 https://www.rfc-editor.org/rfc/rfc9114')
    expect(fake.sent).toEqual([expect.objectContaining({ deepResearch: true, temporary: false })])
    expect(fake.started).toEqual([result.binding])
  })
})
