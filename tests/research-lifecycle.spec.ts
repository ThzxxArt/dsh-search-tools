import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import { createResearchToolSync } from '../src/research/lifecycle.ts'
import { DEFAULT_RESEARCH_CONFIG, DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

function configOf(stored: StoredConfig): Config {
  return {
    search: { get: () => stored.search },
    fetch: { get: () => stored.fetch },
    research: { get: () => stored.research },
    activation: { get: () => stored.activation },
  } as unknown as Config
}

describe('research tool lifecycle', () => {
  it('awaits disposal before re-registering and unregisters on disable', async () => {
    const disposers: Array<ReturnType<typeof vi.fn>> = []
    const fiberDisposes: Array<ReturnType<typeof vi.fn>> = []
    const inject = vi.fn((_services: string[], callback: (child: unknown) => void) => {
      let cleanup: (() => void) | undefined
      const child = {
        effect: (effect: () => () => void) => {
          cleanup = effect()
        },
      }
      callback(child)
      const dispose = vi.fn(async () => { cleanup?.() })
      fiberDisposes.push(dispose)
      return { dispose }
    })
    const ctx = {
      logger: { warn: () => {} },
      inject,
    } as unknown as Context
    const applyTool = vi.fn(() => {
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    })
    const stored = {
      ...DEFAULT_STORED_CONFIG,
      research: { ...DEFAULT_RESEARCH_CONFIG, enabled: true, timeoutMs: 1_000 },
    }
    const config = configOf(stored)
    const sync = createResearchToolSync(ctx, config, applyTool)
    await sync.sync()
    expect(inject).toHaveBeenCalledTimes(1)
    expect(sync.registered()).toBe(true)

    stored.research = { ...stored.research, timeoutMs: 2_000 }
    const first = sync.sync()
    const second = sync.sync()
    await Promise.all([first, second])
    expect(inject).toHaveBeenCalledTimes(2)
    expect(fiberDisposes[0]).toHaveBeenCalledTimes(1)
    expect(sync.registered()).toBe(true)

    stored.research = { ...stored.research, enabled: false }
    await sync.sync()
    expect(fiberDisposes[1]).toHaveBeenCalledTimes(1)
    expect(sync.registered()).toBe(false)
    expect(applyTool).toHaveBeenCalledTimes(2)
  })
})
