/** Host entry: stable providers, adapter registry, research tool, settings routes. */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { Config, snapshot, type Config as ConfigShape } from './config.ts'
import { Diagnostics } from './core/diagnostics.ts'
import { FetchDispatcher, SearchDispatcher } from './core/dispatchers.ts'
import { SearchToolsService } from './core/service.ts'
import { readableHttpAdapter } from './fetch/adapters/readable-http/adapter.ts'
import { registerRoutes } from './host/routes.ts'
import { applyResearchTool } from './research/tool.ts'
import { searxngAdapter } from './search/adapters/searxng/adapter.ts'

export { Config }
export type { ConfigShape }
export { SEARCH_PROVIDER_ID, FETCH_PROVIDER_ID } from './core/dispatchers.ts'

/** Cordis plugin name. */
export const name = 'dsh-search-tools'

/** The Web capability seam. Routes and tools are optional children. */
export const inject = ['web']

export function apply(ctx: Context, config: ConfigShape): void {
  const adapters = new SearchToolsService(ctx)
  const diagnostics = new Diagnostics()

  ctx.effect(() => adapters.registerSearchAdapter(searxngAdapter), 'dsh-search-tools: searxng adapter')
  ctx.effect(() => adapters.registerFetchAdapter(readableHttpAdapter), 'dsh-search-tools: readable-http adapter')

  const search = new SearchDispatcher(ctx, config, adapters, diagnostics)
  const fetch = new FetchDispatcher(ctx, config, adapters, diagnostics)

  ctx.effect(() => ctx.web.registerSearchProvider(search), 'dsh-search-tools: search provider')
  ctx.effect(() => ctx.web.registerFetchProvider(fetch), 'dsh-search-tools: fetch provider')

  // The research tool follows the live config. Disabling it removes its schema
  // from the model instead of leaving a tool that always throws. The declared
  // deadline is re-registered when the configured timeout changes.
  let toolFiber: Fiber | undefined
  let toolTimeout = -1
  let researchToolRegistered = false
  const syncTool = (): void => {
    const state = snapshot(config)
    const enabled = state.research.enabled
    const timeout = state.research.timeoutMs
    if (enabled && (toolFiber === undefined || toolTimeout !== timeout)) {
      if (toolFiber !== undefined) void toolFiber.dispose()
      toolTimeout = timeout
      toolFiber = ctx.inject(['tools'], (child) => {
        child.effect(() => {
          const dispose = applyResearchTool(child, config, timeout)
          researchToolRegistered = true
          return () => {
            researchToolRegistered = false
            dispose()
          }
        }, 'dsh-search-tools: web_research tool')
      })
    } else if (!enabled && toolFiber !== undefined) {
      void toolFiber.dispose()
      toolFiber = undefined
      toolTimeout = -1
      researchToolRegistered = false
    }
  }
  ;(ctx.on as unknown as (event: string, listener: () => void) => void)('loader/volatile-update', syncTool)
  syncTool()

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    registerRoutes(webCtx, {
      config,
      search,
      fetch,
      adapters,
      diagnostics,
      researchRegistered: () => researchToolRegistered,
    })
  })
}
