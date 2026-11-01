import { Context, Service } from '@deepseek-ai/cordis'
import type { ModelEntry } from '@tsuuanmi/system-models-core'
import { describe, expect, it, onTestFinished } from 'vitest'
import { LlmModels } from '../src/index.ts'

/** How a fake route's stream misbehaves: it ignores the abort signal in every case. */
type Mode = 'never-opens' | 'never-yields' | 'slow'

const ENTRY: ModelEntry & { route: string; model: string } = { id: 'fast', route: 'fake', model: 'm1', tier: 'economy', quotaClass: 'metered', locality: 'remote', maxTokens: 64 }
const IDLE_MS = 200

const boot = async (modes: Mode[]) => {
  const sends: number[] = []
  class FakeLlm extends Service {
    constructor(ctx: Context) {
      super(ctx, 'llm')
    }

    listProviders() {
      return [{ id: 'fake', name: 'fake' }]
    }

    async resolveModelInfo() {
      return { id: 'm1' }
    }

    providerRetryPolicy() {
      return { mode: 'normal', maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5, retryableCodes: ['TIMEOUT'] }
    }

    stream() {
      const mode = modes[sends.length] ?? 'slow'
      sends.push(sends.length)
      // Nothing here looks at the request's signal: a stalled connection does not answer an abort.
      if (mode === 'never-opens') return new Promise(() => undefined)
      return (async function* () {
        if (mode === 'never-yields') await new Promise(() => undefined)
        for (const text of ['a', 'b', 'c', 'd', 'e']) {
          await new Promise((resolve) => setTimeout(resolve, IDLE_MS / 2))
          yield { type: 'text-delta', index: 0, text }
        }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'abcde' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    }
  }
  const ctx = new Context()
  const fibers = [ctx.plugin(FakeLlm), ctx.plugin(LlmModels, { models: [ENTRY], maxRetries: 1, idleTimeoutMs: IDLE_MS })]
  await Promise.all(fibers)
  onTestFinished(async () => {
    for (const fiber of [...fibers].reverse()) await fiber.dispose()
  })
  return { ctx, sends }
}

describe('LlmModels: every phase of an attempt is bounded by idleTimeoutMs (T374)', () => {
  for (const mode of ['never-opens', 'never-yields'] as const) {
    it(`fails a stream that ${mode.replace('-', ' ')} as a timeout, and re-attempts it per the route's policy`, async () => {
      const { ctx, sends } = await boot([mode, mode])
      const failure = await ctx.models.complete({ model: 'fast', prompt: 'x' }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ failure: 'timeout' })
      expect(sends).toHaveLength(2)
      // A stall, then an answer: the re-attempt answers.
      const { ctx: again, sends: resent } = await boot([mode])
      expect(await again.models.complete({ model: 'fast', prompt: 'x' })).toMatchObject({ text: 'abcde', attempts: 2 })
      expect(resent).toHaveLength(2)
    }, 10_000)
  }

  it('does not stop a slow stream that keeps yielding', async () => {
    const { ctx, sends } = await boot([])
    // Five parts, one per half bound: well past the bound in all, never silent for it.
    expect(await ctx.models.complete({ model: 'fast', prompt: 'x' })).toMatchObject({ text: 'abcde', attempts: 1 })
    expect(sends).toHaveLength(1)
  }, 10_000)
})
