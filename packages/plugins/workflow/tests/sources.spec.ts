import { describe, expect, it } from 'vitest'
import { focusShortfall } from '../src/sources.ts'


describe('focusShortfall: a review never gives a verdict on a focus file it did not show', () => {
  const snapshot = {
    files: [{ path: 'src/index.ts', sha: 'b'.repeat(40), text: 'x' }],
    unread: [
      { path: 'src/repositories.ts', why: 'bounds' as const }, { path: 'src/big.ts', why: 'too-large' as const },
      { path: 'src/logo.png', why: 'binary' as const }, { path: 'pnpm-lock.yaml', why: 'lockfile' as const }, { path: 'src/other.ts', why: 'not-selected' as const },
    ],
  }

  it('refuses an exactly named file that was not shown, for any bound, and never a shown or unreadable one', () => {
    expect(focusShortfall(['src/repositories.ts', 'src/big.ts', 'src/index.ts', 'src/logo.png', 'pnpm-lock.yaml'], snapshot).missing).toEqual(['src/repositories.ts (bounds)', 'src/big.ts (too-large)'])
    // A plain path the tree does not have (a typo, or absent at this commit) is refused too; a directory stays a glob.
    expect(focusShortfall(['src/repositries.ts', 'src'], snapshot).missing).toEqual(['src/repositries.ts (not in the repository at this commit)'])
  })
})
