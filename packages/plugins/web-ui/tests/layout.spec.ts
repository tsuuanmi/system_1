import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { builtClient } from './client-build.ts'

// The page's three files as the server serves them: the shell and the styles as written, the script as the build compiles it.
const PAGE = readFileSync(join(builtClient(), 'index.html'), 'utf8')
const APP_CSS = readFileSync(join(builtClient(), 'app.css'), 'utf8')
const APP_JS = readFileSync(join(builtClient(), 'app.js'), 'utf8')

// The page at a glance (T239, docs/design/web-ui.md), over the store-backed board, queue, and engine: the Board's first
// screen holds at most half the words it held before; every section has a heading; nothing scrolls sideways on a 360 px
// phone and every button there is within the screen; each button's effect is a tooltip a keyboard reaches. The words on
// Home, a run, and Workers are bounded in web-ui.spec.ts, over its fuller roster and queue.
vi.setConfig({ testTimeout: 180_000 })




describe('web UI: one spacing scale, one type scale (T239)', () => {
  const declarations = (property: RegExp): string[] => [...APP_CSS.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)].filter(([, name]) => property.test(name!)).map(([, name, value]) => `${name}: ${value!.trim()}`)

  it('sizes text in three sizes only, each a token of the type scale', () => {
    expect(APP_CSS).toMatch(/--small: 12px; --body: 14px; --large: 18px;/)
    for (const d of declarations(/^font-size$/)) expect(d).toMatch(/^font-size: var\(--(small|body|large)\)$/)
    for (const d of declarations(/^font$/)) expect(d).toMatch(/^font: (inherit|var\(--(small|body|large)\)\/[\d.]+ .+)$/)
  })

  it('spaces margins, paddings, and gaps by the spacing scale only, or by a safe-area token made of it (T240)', () => {
    expect(APP_CSS).toMatch(/--s1: 4px; --s2: 8px; --s3: 16px; --s4: 24px;/)
    // A safe-area token is a step of the scale, or the screen's own inset where that is larger (T240).
    for (const side of ['top', 'right', 'bottom', 'left']) expect(APP_CSS).toMatch(new RegExp(`--safe-${side}: max\\(var\\(--s[1-4]\\), env\\(safe-area-inset-${side}\\)\\);`))
    expect(APP_CSS).toContain('--safe-bar: max(var(--s2), env(safe-area-inset-bottom)); --bar-room: calc(var(--s4) * 4 + env(safe-area-inset-bottom));')
    const spaced = declarations(/^(margin|padding|gap)(-(top|right|bottom|left))?$/)
    expect(spaced.length).toBeGreaterThan(50)
    const step = '(0|auto|var\\(--s[1-4]\\)|var\\(--safe-(top|right|bottom|left|bar)\\)|var\\(--bar-room\\))'
    for (const d of spaced) expect(d).toMatch(new RegExp(`^[a-z-]+: ${step}( ${step}){0,3}$`))
  })

  it('takes light and dark from the system\'s preference, and stills motion when reduced motion is asked', () => {
    expect(APP_CSS).toContain('color-scheme: light dark')
    expect(APP_CSS).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root \{ --fg: /)
    expect(APP_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important;/)
  })

  it('serves a script that parses, and loads nothing from another origin: no font, no CDN', () => {
    expect(() => new Function(APP_JS)).not.toThrow()
    for (const asset of [PAGE, APP_CSS, APP_JS]) {
      expect(asset).not.toMatch(/@import|@font-face|url\(\s*['"]?(https?:)?\/\//)
      expect(asset).not.toMatch(/<(script|link)[^>]+(src|href)="(https?:)?\/\//)
    }
  })
})

describe('web UI: the operator\'s iPhone 16 Pro (T240)', () => {
  it('lets Safari lay the page under the Dynamic Island and the home indicator, and follows the phone\'s light or dark', () => {
    expect(PAGE).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    expect(PAGE).toContain('<meta name="color-scheme" content="light dark">')
    // Text on a touch screen is 16 px, so Safari never zooms into a field it focuses; the scale keeps its three sizes.
    expect(APP_CSS).toMatch(/@media \(pointer: coarse\) \{\s*:root \{ --small: 13px; --body: 16px; --large: 20px; \}/)
  })
})

