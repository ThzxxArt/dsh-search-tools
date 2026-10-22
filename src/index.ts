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
  // from the model instead of leaving a tool that always throws.
  let toolFiber: Fiber | undefined
  const syncTool = (): void => {
    const enabled = snapshot(config).research.enabled
    if (enabled && toolFiber === undefined) {
      toolFiber = ctx.inject(['tools'], (child) => {
        child.effect(() => applyResearchTool(child, config), 'dsh-search-tools: web_research tool')
      })
    } else if (!enabled && toolFiber !== undefined) {
      void toolFiber.dispose()
      toolFiber = undefined
    }
  }
  ;(ctx.on as unknown as (event: string, listener: () => void) => void)('loader/volatile-update', syncTool)
  syncTool()

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    registerRoutes(webCtx, { config, search, fetch, adapters, diagnostics })
  })
}
