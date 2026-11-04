import { Context } from '@deepseek-ai/cordis'
import { type XvfbHandle, startXvfb } from '@tsuuanmi/system-display-virtual'
import { Display, type PreparedDisplay, ProviderError } from '@tsuuanmi/system-provider-core'
import { describe, expect, it } from 'vitest'
import BrowserPool from '../src/index.ts'
import { canRunBrowser as canRun, testChrome as chrome, fileDisplay, scaled } from './support.ts'

/** These tests exercise the patchright provider itself, so they use its concrete page and context types. */
const pool = (ctx: Context): BrowserPool => ctx.browser as unknown as BrowserPool

/** A display provider whose Xvfb the test can kill, to simulate a lost display. */
class KillableDisplay extends Display {
  xvfb: XvfbHandle | undefined
  private prepared: PreparedDisplay | undefined
  private generation = 0

  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => async () => {
      await this.xvfb?.stop()
    })
  }

  private starting: Promise<PreparedDisplay> | undefined

  protected prepareInvisible(): Promise<PreparedDisplay> {
    if (this.prepared && !this.prepared.lost.aborted) return Promise.resolve(this.prepared)
    // Concurrent callers share one startup (found by the display conformance suite).
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    return this.starting
  }

  private async start(): Promise<PreparedDisplay> {
    const xvfb = await startXvfb({ executable: 'Xvfb', startupTimeoutMs: scaled(5000) })
    const lost = new AbortController()
    void xvfb.exited.then(() => lost.abort(new ProviderError('session_broken', 'Xvfb exited')))
    this.xvfb = xvfb
    this.prepared = { kind: 'virtual', env: { DISPLAY: xvfb.display, XAUTHORITY: xvfb.authority }, windowArgs: ['--window-size=1920,1080'], viewport: null, generation: ++this.generation, lost: lost.signal }
    return this.prepared
  }
}

/** A display that never becomes ready, like a launch stalled under load. */
class StalledDisplay extends Display {
  protected prepareInvisible(): Promise<PreparedDisplay> {
    return new Promise<PreparedDisplay>(() => undefined)
  }
}

describe('ctx.browser: a stalled launch never holds an aborted turn (live 2026-10-12)', () => {
  it('rejects openTurn as soon as its signal aborts, even while the browser is still launching', async () => {
    const ctx = new Context()
    await ctx.plugin(StalledDisplay)
    await ctx.plugin(BrowserPool, {})
    const controller = new AbortController()
    const opening = pool(ctx).openTurn('acct-a', { signal: controller.signal })
    setTimeout(() => controller.abort(new ProviderError('aborted', 'turn runtime stopped')), 100)
    const started = Date.now()
    await expect(opening).rejects.toMatchObject({ kind: 'aborted' })
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

if (canRun) {
  const { displayConformance } = await import('../../../provider-core/conformance/display.ts')
  const { browserConformance } = await import('../../../provider-core/conformance/browser.ts')
  displayConformance('KillableDisplay (the test fake)', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(KillableDisplay)
    await fiber
    return { ctx, dispose: () => fiber.dispose() }
  })
  // The test fake that gives a whole test file one Xvfb (support.ts).
  const FileDisplay = fileDisplay()
  displayConformance('the file display (the test fake)', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(FileDisplay)
    await fiber
    return { ctx, dispose: () => fiber.dispose() }
  })
  browserConformance('browser-patchright', async () => {
    const ctx = new Context()
    const display = ctx.plugin(KillableDisplay)
    await display
    const browser = ctx.plugin(BrowserPool, { chromePath: chrome! })
    await browser
    return { ctx, dispose: async () => { await browser.dispose(); await display.dispose() } }
  }, {
    goto: async (page, url) => { await (page as import('patchright-core').Page).goto(url) },
    read: (page) => (page as import('patchright-core').Page).evaluate(() => ({ cookie: document.cookie, storage: localStorage.length, visibility: document.visibilityState })),
    setStorage: (page, key, value) => (page as import('patchright-core').Page).evaluate(([k, v]) => localStorage.setItem(k!, v!), [key, value]),
  })
}
