import { describe, expect, it } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { ballot, browserStack, findings, isProposal } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: review teams and their findings', () => {

  it('never lends one member\'s confirmed quote to another\'s blocking claim, and does not confirm a trivial quote (record integrity)', async () => {
    const material = 'Review this change:\nfunction f() {\n  const lease = acquire()\n  work()\n}'
    const { ctx, fake } = await boot({
      // m1: a correct quote, but only info. m2: blocking, on the same line, with a quote that is not there.
      fake: { answer: (prompt) => (isProposal(prompt) ? findings([{ severity: 'info', claim: 'A lease is taken', quote: { path: 'material', line: 3, text: 'const lease = acquire()' } }]) : ballot('pass', [], 'review')) },
      gemini: { answer: (prompt) => (isProposal(prompt)
        ? findings([
          { severity: 'blocking', claim: 'The lease leaks', quote: { path: 'material', line: 3, text: 'const lease = leak()' } },
          // `}` is on line 5, but it identifies no line: never confirmed.
          { severity: 'blocking', claim: 'The function never ends', quote: { path: 'material', line: 5, text: '}' } },
          // More findings on one line from one member fold into its one report there.
          ...[1, 2, 3, 4, 5].map((i) => ({ severity: 'warning' as const, claim: `Extra ${i}`, quote: { path: 'material', line: 3, text: `const lease = other${i}()` } })),
        ])
        : ballot('pass', [], 'review')) },
    })
    const done = await ctx.workflow.wait(ctx.workflow.start({ template: 'review', input: material }).runId, 120_000)
    // No report is both confirmed and blocking: the vote decides (both pass).
    expect(done.answer).toMatch(/^outcome: pass; method: team-majority;/)
    const final = ctx.artifacts.get(ctx.workflow.records(done.runId).at(-1)!.outputReceipt!.acceptance)!.body as { vote: { findings: Array<{ id: string; reports: unknown[] }> } }
    // The finding's own class and severity are one report's (the most severe): never m1's class beside m2's severity.
    expect(final.vote.findings[0]).toMatchObject({ id: 'F1', member: 'm2', class: 'needs-verification', severity: 'blocking', claim: expect.stringMatching(/^The lease leaks; also/), reports: [
      { member: 'm1', severity: 'info', claim: 'A lease is taken', class: 'confirmed' },
      { member: 'm2', severity: 'blocking', claim: expect.stringMatching(/^The lease leaks; also warning needs-verification: Extra 1; .*Extra 5$/), class: 'needs-verification', why: 'quote not found within ±2 lines of material:3' },
    ] })
    expect(final.vote.findings[0]!.reports).toHaveLength(2)
    // Voters see each report's class and severity, never a confirmed blocking finding.
    const ballotPrompt = fake.sent.map((s) => s.prompt).find((p) => !isProposal(p))!
    expect(ballotPrompt).toMatch(/F1 at material:3 \(evidence: read it\) \[m1 info confirmed: A lease is taken; m2 blocking needs-verification: The lease leaks; also/)
    expect(final.vote.findings[1]).toMatchObject({ class: 'needs-verification', why: expect.stringMatching(/too short to identify one line/) })
  }, 240_000)
})
