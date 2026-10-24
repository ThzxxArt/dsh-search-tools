/** Serialize research-tool registration against live config changes. */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { snapshot, type Config } from '../config.ts'
import { applyResearchTool } from './tool.ts'

export interface ResearchToolSync {
  /** Queue a reconciliation; resolves after this generation has settled. */
  sync: () => Promise<void>
  /** True only while the tool effect is actually registered. */
  registered: () => boolean
}

export function createResearchToolSync(
  ctx: Context,
  config: Config,
  applyTool: typeof applyResearchTool = applyResearchTool,
): ResearchToolSync {
  let toolFiber: Fiber | undefined
  let toolTimeout = -1
  let toolRegistered = false
  let generation = 0
  let queue: Promise<void> = Promise.resolve()

  const reconcile = async (requested: number): Promise<void> => {
    if (requested !== generation) return
    const state = snapshot(config)
    const enabled = state.research.enabled
    const timeout = state.research.timeoutMs

    if (!enabled) {
      const fiber = toolFiber
      toolFiber = undefined
      toolTimeout = -1
      toolRegistered = false
      if (fiber !== undefined) await Promise.resolve(fiber.dispose())
      return
    }
    if (toolFiber !== undefined && toolTimeout === timeout) return

    if (toolFiber !== undefined) {
      const fiber = toolFiber
      toolFiber = undefined
      toolRegistered = false
      await Promise.resolve(fiber.dispose())
      // A newer update arrived while the old fiber was disposing.
      if (requested !== generation) return
    }
    if (requested !== generation) return

    toolTimeout = timeout
    toolFiber = ctx.inject(['tools'], (child) => {
      child.effect(() => {
        const dispose = applyTool(child, config, timeout)
        toolRegistered = true
        return () => {
          toolRegistered = false
          dispose()
        }
      }, 'dsh-search-tools: web_research tool')
    })
  }

  return {
    sync: () => {
      const requested = ++generation
      queue = queue.then(() => reconcile(requested)).catch((error: unknown) => {
        ctx.logger.warn(
          'dsh-search-tools: research tool sync failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      })
      return queue
    },
    registered: () => toolRegistered,
  }
}
