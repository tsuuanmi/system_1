import { describe, expect, it } from 'vitest'
import { GUIDE_SECTIONS, guidesTouching, parseGuide } from '../src/review-guides.ts'

// Review guides (docs/design/handbook.md#review-guides-reviewmd, T267): the format, the selection of
// the areas a change touches, and what a repository's `docs/review/` yields. The brief a review step
// gets is tested where the engine runs one (profile-software-development `algorithm-development.spec.ts`).

const guide = (paths: string[], extra: { owner?: string | null; version?: string | null; sections?: readonly string[] } = {}): string => [
  '---', 'paths:', ...paths.map((p) => `  - ${p}`),
  ...(extra.owner === null ? [] : [`owner: ${extra.owner ?? 'lead'}`]), ...(extra.version === null ? [] : [`version: ${extra.version ?? '1'}`]), '---',
  '# Review guide: an area', '', ...(extra.sections ?? GUIDE_SECTIONS).flatMap((s) => [`## ${s}`, `Text of ${s}.`, '']),
].join('\n')

describe('the guides a change touches', () => {
  const all = ['packages/a/', 'packages/b/', 'docs/'].map((p, i) => {
    const read = parseGuide(`docs/review/${i}.REVIEW.md`, guide([p]))
    if (!read.ok) throw new Error(read.problem)
    return read.guide
  })

  it('gives every guide when the change\'s paths are unknown or some part could not be read: an unknown path is no reason to leave a rule out (INV-2)', () => {
    expect(guidesTouching(all, { paths: [], unreadable: [] })).toMatchObject({ left: 0, all: true })
    expect(guidesTouching(all, { paths: ['packages/a/x.ts'], unreadable: ['a part could not be read'] }).selected).toHaveLength(3)
  })
})
