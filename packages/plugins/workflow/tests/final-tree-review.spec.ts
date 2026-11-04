import { describe, expect, it } from 'vitest'
import { finalTreeReview } from '../src/risk.ts'

// A result's review verdict is the last review's of its final tree (T287). The reviews are the
// run's gates in run order: a review's earlier-round gate, and the verification gate that re-judged
// it, are of the tree before the fix.
const OLD = { ref: 'repo', version: 'aaa' }
const FINAL = { ref: 'repo', version: 'bbb' }
const gate = (node: string, verdict: string, subject: { ref: string; version: string }) => ({ node, verdict, subject })

describe('finalTreeReview (T287)', () => {

  it('reads changes-requested when the last review of the final tree requests changes', () => {
    const reviews = [
      gate('review:1', 'changes-requested', OLD),
      gate('review:1:review:2', 'approve', FINAL),
      gate('review:1:review:3', 'changes-requested', FINAL),
      gate('review:1', 'approve', OLD),
    ]
    expect(finalTreeReview(reviews, { type: 'git-head', ...FINAL })).toMatchObject({ node: 'review:1:review:3', verdict: 'changes-requested' })
  })
})
