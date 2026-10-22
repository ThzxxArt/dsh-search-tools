/**
 * Stable DSH providers. Their ids never change when an adapter is added or
 * swapped; the selected adapter lives in plugin Config.
 */

import type { Context } from '@deepseek-ai/cordis'
import { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import type { Config } from '../config.ts'
import { snapshot } from '../config.ts'
import type { AdapterContext, CredentialLookup, FetchAdapter, SearchAdapter } from './host-types.ts'
import { Diagnostics } from './diagnostics.ts'
import { SearchToolsService } from './service.ts'
import type { AdapterListResponse, CacheStats, ProbeResult } from './types.ts'
import type { JsonObject } from './types.ts'

export const SEARCH_PROVIDER_ID = 'dsh-search-tools'
export const FETCH_PROVIDER_ID = 'dsh-search-tools-fetch'

/** Build the host services an adapter is allowed to use. */
export function createAdapterContext(ctx: Context): AdapterContext {
  return {
    logger: ctx.logger,
    // Resolve at call time: credentials can mount after this plugin applies.
    getCredentials: () => ctx.get('credentials') as CredentialLookup | undefined,
    env: process.env,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => Date.now(),
  }
}

export class SearchDispatcher implements WebSearchProvider {
  readonly id = SEARCH_PROVIDER_ID
  private readonly runtimes = new Map<string, ReturnType<SearchAdapter['create']>>()
  private readonly diagnostics: Diagnostics
  private readonly adapterContext: AdapterContext

  constructor(
    ctx: Context,
    private readonly config: Config,
    private readonly adapters: SearchToolsService,
    diagnostics: Diagnostics,
  ) {
    this.diagnostics = diagnostics
    this.adapterContext = createAdapterContext(ctx)
  }

  available(): boolean {
    const state = snapshot(this.config)
    const adapter = this.adapters.getSearchAdapter(state.search.adapter)
    return adapter !== undefined && this.runtimeFor(state.search.adapter)?.available() === true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const state = snapshot(this.config)
    const adapterId = state.search.adapter
    const adapter = this.adapters.getSearchAdapter(adapterId)
    if (adapter === undefined) {
      throw new WebError(`search adapter "${adapterId}" is not registered`, 'SEARCH_ADAPTER_MISSING')
    }
    const runtime = this.runtimeFor(adapterId)
    if (runtime === undefined || !runtime.available()) {
      throw new WebError(`search adapter "${adapterId}" is unavailable`, 'SEARCH_ADAPTER_UNAVAILABLE')
    }
    try {
      return await runtime.search(request, signal) as WebSearchResult
    } catch (error) {
      this.diagnostics.record(error, 'SEARCH_FAILED', adapterId)
      throw error
    }
  }

  clearCache(): void {
    for (const runtime of this.runtimes.values()) runtime.clearCache?.()
  }

  cacheStats(): CacheStats {
    const state = snapshot(this.config)
    return this.runtimeFor(state.search.adapter)?.cacheStats?.() ?? { size: 0, hits: 0, misses: 0 }
  }

  manifests(): AdapterListResponse {
    return this.adapters.listAdapters()
  }

  async probe(adapterId: string, rawConfig: JsonObject, signal?: AbortSignal): Promise<ProbeResult> {
    const adapter = this.adapters.getSearchAdapter(adapterId)
    if (adapter === undefined) {
      return { ok: false, code: 'SEARCH_ADAPTER_MISSING', message: `adapter "${adapterId}" is not registered`, latencyMs: 0 }
    }
    if (adapter.probe === undefined) {
      return { ok: false, code: 'SEARCH_PROBE_UNSUPPORTED', message: 'adapter has no probe', latencyMs: 0 }
    }
    return adapter.probe(this.adapterContext, rawConfig, signal ?? AbortSignal.timeout(15_000))
  }

  /** Run one search with unsaved draft config, without touching the cache. */
  async preview(
    adapterId: string,
    rawConfig: JsonObject,
    request: { query: string; maxResults?: number },
    signal?: AbortSignal,
  ): Promise<{ sources: unknown[]; content?: string; truncated: boolean; notes?: readonly string[] }> {
    const adapter = this.adapters.getSearchAdapter(adapterId)
    if (adapter === undefined) throw new WebError(`search adapter "${adapterId}" is not registered`, 'SEARCH_ADAPTER_MISSING')
    const runtime = adapter.create(this.adapterContext, () => rawConfig)
    const result = await runtime.search(request, signal)
    return {
      sources: [...result.sources],
      ...(result.content === undefined ? {} : { content: result.content }),
      truncated: result.truncated,
      ...(result.notes === undefined ? {} : { notes: result.notes }),
    }
  }

  private runtimeFor(adapterId: string): ReturnType<SearchAdapter['create']> | undefined {
    const existing = this.runtimes.get(adapterId)
    if (existing !== undefined) return existing
    const adapter = this.adapters.getSearchAdapter(adapterId)
    if (adapter === undefined) return undefined
    const runtime = adapter.create(this.adapterContext, () => {
      const state = snapshot(this.config)
      return state.search.adapters[adapterId] ?? {}
    })
    this.runtimes.set(adapterId, runtime)
    return runtime
  }
}

export class FetchDispatcher implements WebFetchProvider {
  readonly id = FETCH_PROVIDER_ID
  private readonly runtimes = new Map<string, ReturnType<FetchAdapter['create']>>()
  private readonly diagnostics: Diagnostics
  private readonly adapterContext: AdapterContext

  constructor(
    ctx: Context,
    private readonly config: Config,
    private readonly adapters: SearchToolsService,
    diagnostics: Diagnostics,
  ) {
    this.diagnostics = diagnostics
    this.adapterContext = createAdapterContext(ctx)
  }

  available(): boolean {
    const state = snapshot(this.config)
    return this.runtimeFor(state.fetch.adapter)?.available() === true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const state = snapshot(this.config)
    const adapterId = state.fetch.adapter
    const adapter = this.adapters.getFetchAdapter(adapterId)
    if (adapter === undefined) {
      throw new WebError(`fetch adapter "${adapterId}" is not registered`, 'FETCH_ADAPTER_MISSING')
    }
    const runtime = this.runtimeFor(adapterId)
    if (runtime === undefined || !runtime.available()) {
      throw new WebError(`fetch adapter "${adapterId}" is unavailable`, 'FETCH_ADAPTER_UNAVAILABLE')
    }
    try {
      return await runtime.fetch(request, signal) as WebFetchResult
    } catch (error) {
      this.diagnostics.record(error, 'FETCH_FAILED', adapterId)
      throw error
    }
  }

  manifests(): AdapterListResponse {
    return this.adapters.listAdapters()
  }

  async probe(adapterId: string, rawConfig: JsonObject, url: string, signal?: AbortSignal): Promise<ProbeResult> {
    const adapter = this.adapters.getFetchAdapter(adapterId)
    if (adapter === undefined) {
      return { ok: false, code: 'FETCH_ADAPTER_MISSING', message: `adapter "${adapterId}" is not registered`, latencyMs: 0 }
    }
    if (adapter.probe === undefined) {
      return { ok: false, code: 'FETCH_PROBE_UNSUPPORTED', message: 'adapter has no probe', latencyMs: 0 }
    }
    return adapter.probe(this.adapterContext, rawConfig, url, signal ?? AbortSignal.timeout(20_000))
  }

  /** Run one fetch with unsaved draft config, without touching any cache. */
  async preview(
    adapterId: string,
    rawConfig: JsonObject,
    request: { url: string },
    signal?: AbortSignal,
  ): Promise<WebFetchResult> {
    const adapter = this.adapters.getFetchAdapter(adapterId)
    if (adapter === undefined) throw new WebError(`fetch adapter "${adapterId}" is not registered`, 'FETCH_ADAPTER_MISSING')
    const runtime = adapter.create(this.adapterContext, () => rawConfig)
    return await runtime.fetch(request, signal) as WebFetchResult
  }

  private runtimeFor(adapterId: string): ReturnType<FetchAdapter['create']> | undefined {
    const existing = this.runtimes.get(adapterId)
    if (existing !== undefined) return existing
    const adapter = this.adapters.getFetchAdapter(adapterId)
    if (adapter === undefined) return undefined
    const runtime = adapter.create(this.adapterContext, () => {
      const state = snapshot(this.config)
      return state.fetch.adapters[adapterId] ?? {}
    })
    this.runtimes.set(adapterId, runtime)
    return runtime
  }
}
