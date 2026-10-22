/** Adapter registries and the `ctx.searchTools` extension service. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { FetchAdapter, SearchAdapter } from './host-types.ts'
import type { AdapterListResponse, AdapterManifest } from './types.ts'

interface HasManifest {
  readonly manifest: AdapterManifest
}

/** A small id-keyed registry; duplicate ids are configuration errors. */
export class AdapterRegistry<T extends HasManifest> {
  private readonly map = new Map<string, T>()

  /** Register one adapter; returns a disposer. */
  add(adapter: T): () => void {
    const { id, kind } = adapter.manifest
    if (id.trim().length === 0) throw new Error('adapter id must not be empty')
    if (this.map.has(id)) throw new Error(`adapter "${id}" is already registered for ${kind}`)
    this.map.set(id, adapter)
    return () => {
      if (this.map.get(id) === adapter) this.map.delete(id)
    }
  }

  get(id: string): T | undefined {
    return this.map.get(id)
  }

  list(): T[] {
    return [...this.map.values()]
  }

  clear(): void {
    this.map.clear()
  }
}

/**
 * The extension seam: `ctx.searchTools.registerSearchAdapter(adapter)`.
 * Adapter packages depend on this service, not on the settings page.
 */
export class SearchToolsService extends Service {
  private readonly search = new AdapterRegistry<SearchAdapter>()
  private readonly fetch = new AdapterRegistry<FetchAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'searchTools')
    ctx.effect(() => () => {
      this.search.clear()
      this.fetch.clear()
    }, 'dsh-search-tools: clear adapters')
  }

  /** Register a search backend. Wrap the returned disposer in the caller's `ctx.effect`. */
  registerSearchAdapter(adapter: SearchAdapter): () => void {
    if (adapter.manifest.kind !== 'search') throw new Error(`adapter "${adapter.manifest.id}" is not a search adapter`)
    return this.search.add(adapter)
  }

  /** Register a fetch backend. Wrap the returned disposer in the caller's `ctx.effect`. */
  registerFetchAdapter(adapter: FetchAdapter): () => void {
    if (adapter.manifest.kind !== 'fetch') throw new Error(`adapter "${adapter.manifest.id}" is not a fetch adapter`)
    return this.fetch.add(adapter)
  }

  getSearchAdapter(id: string): SearchAdapter | undefined {
    return this.search.get(id)
  }

  getFetchAdapter(id: string): FetchAdapter | undefined {
    return this.fetch.get(id)
  }

  listAdapters(): AdapterListResponse {
    return {
      search: this.search.list().map(adapter => adapter.manifest),
      fetch: this.fetch.list().map(adapter => adapter.manifest),
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Adapter registry owned by dsh-search-tools. */
    searchTools: SearchToolsService
  }
}
