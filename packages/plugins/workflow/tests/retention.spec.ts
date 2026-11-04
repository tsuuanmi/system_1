import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { canRunBrowser } from '../../browser-patchright/tests/support.ts'
import { browserStack, until } from './stack.ts'

const { boot } = browserStack()

describe.runIf(canRunBrowser)('ctx.workflow: retention', () => {
  it('clears a finished run\'s private text after the retention period, but keeps the run while run retention is off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'system-workflow-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    const first = await boot({ dir, workflow: { retainRunsDays: 0 } })
    const done = await first.ctx.workflow.wait(first.ctx.workflow.start({ template: 'ask', input: 'private words' }).runId, 30_000)
    first.ctx.store.db.prepare("UPDATE workflow_runs SET updated_at = '2000-01-01T00:00:00.000Z'").run()
    await first.stop()
    const second = await boot({ dir, shared: first.fake, workflow: { retainRunsDays: 0 } })
    await until(() => (second.ctx.store.db.prepare('SELECT input FROM workflow_runs').get() as { input: string }).input === '')
    expect(second.ctx.store.db.prepare('SELECT prompt FROM workflow_nodes').get()).toEqual({ prompt: null })
    expect(second.ctx.workflow.get(done.runId)).toMatchObject({ status: 'completed', answer: 'Plain answer.' })
  }, 90_000)
})
