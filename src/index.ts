/** Host entry: stable providers, adapter registry, research tool, settings routes. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { Config, type Config as ConfigShape } from './config.ts'
import { Diagnostics } from './core/diagnostics.ts'
import { FetchDispatcher, SearchDispatcher } from './core/dispatchers.ts'
import { SearchToolsService } from './core/service.ts'
import { jinaReaderAdapter } from './fetch/adapters/jina-reader/adapter.ts'
import { readableHttpAdapter } from './fetch/adapters/readable-http/adapter.ts'
import { wireHttpAdapter } from './fetch/adapters/wire-http/adapter.ts'
import { registerRoutes } from './host/routes.ts'
import { createResearchToolSync } from './research/lifecycle.ts'
import { localDirectAdapter } from './search/adapters/local-direct/adapter.ts'
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
  ctx.effect(() => adapters.registerSearchAdapter(localDirectAdapter), 'dsh-search-tools: local-direct adapter')
  ctx.effect(() => adapters.registerFetchAdapter(readableHttpAdapter), 'dsh-search-tools: readable-http adapter')
  ctx.effect(() => adapters.registerFetchAdapter(jinaReaderAdapter), 'dsh-search-tools: jina-reader adapter')
  ctx.effect(() => adapters.registerFetchAdapter(wireHttpAdapter), 'dsh-search-tools: wire-http adapter')

  const search = new SearchDispatcher(ctx, config, adapters, diagnostics)
  const fetch = new FetchDispatcher(ctx, config, adapters, diagnostics)

  ctx.effect(() => ctx.web.registerSearchProvider(search), 'dsh-search-tools: search provider')
  ctx.effect(() => ctx.web.registerFetchProvider(fetch), 'dsh-search-tools: fetch provider')

  // The research tool follows the live config. Disabling it removes its schema
  // from the model instead of leaving a tool that always throws. The declared
  // deadline is re-registered when the configured timeout changes.
  const researchTool = createResearchToolSync(ctx, config)
  ;(ctx.on as unknown as (event: string, listener: () => void) => void)('loader/volatile-update', () => {
    void researchTool.sync()
  })
  void researchTool.sync()

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    registerRoutes(webCtx, {
      config,
      search,
      fetch,
      adapters,
      diagnostics,
      researchRegistered: () => researchTool.registered(),
    })
  })
}
