import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { fakeSite } from './site.ts'

describe.runIf(canRunBrowser)('ChatGptWebDriver against the fake site, with no real account (QA-10): reading a Deep research report', () => {
  const { site } = fakeSite()

  it('runs Deep research from the + tools in a persistent conversation, with the prompt free of the tool chip (REQ-PRV-6)', async () => {
    const report = 'A detailed report <a href="https://src.example/a">[1]</a> with <a href="https://src.example/b">sources</a> <a href="https://src.example/a">[1]</a>.'
    const { fake, page, driver } = await site({ report })
    const reports: unknown[] = []
    driver.onReport = (event) => void reports.push(event)
    const turn = await driver.ask(page, 'Survey the DSH plugin catalog', { conversation: 'persistent', feature: 'deep-research' })
    // Not the acknowledgement: the report from the research frame, with its citation links kept.
    expect(turn.text).toBe('Research findings\nA detailed report [1] with sources [1].\n\nSources:\n- [1] https://src.example/a\n- sources https://src.example/b')
    expect(turn.binding).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.sent[0]).toMatchObject({ prompt: 'Survey the DSH plugin catalog', deepResearch: true, mode: 'chat', temporary: false })
    await expect.poll(() => reports).toEqual([{ provider: 'chatgpt-web', path: 'frame', chars: turn.text.length, links: 2 }])
    await expect(driver.ask(page, 'x', { conversation: 'temporary', feature: 'deep-research' })).rejects.toMatchObject({ kind: 'invalid_input' })
  }, 60_000)
})
