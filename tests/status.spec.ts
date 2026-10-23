import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import type { FetchDispatcher, SearchDispatcher } from '../src/core/dispatchers.ts'
import type { SearchToolsService } from '../src/core/service.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import { buildStatus, type RouteDeps } from '../src/host/routes.ts'
import { jinaReaderManifest } from '../src/fetch/adapters/jina-reader/manifest.ts'
import { DEFAULT_READABLE_HTTP_CONFIG } from '../src/fetch/adapters/readable-http/schema.ts'
import { DEFAULT_SEARXNG_CONFIG } from '../src/search/adapters/searxng/schema.ts'

function configOf(
  researchEnabled: boolean,
  enabled: { search?: boolean | undefined; fetch?: boolean | undefined } = {},
): Config {
  return {
    search: {
      get: () => ({
        adapter: 'searxng',
        adapters: { searxng: { ...DEFAULT_SEARXNG_CONFIG, enabled: enabled.search ?? true } },
      }),
    },
    fetch: {
      get: () => ({
        adapter: 'readable-http',
        adapters: { 'readable-http': { ...DEFAULT_READABLE_HTTP_CONFIG, enabled: enabled.fetch ?? true } },
      }),
    },
    research: {
      get: () => ({
        enabled: researchEnabled,
        maxResults: 8,
        maxFetch: 8,
        defaultFetchTop: 3,
        maxCharsPerPage: 12_000,
        maxTotalChars: 40_000,
        concurrency: 3,
        timeoutMs: 120_000,
      }),
    },
    activation: { get: () => ({ previousSearchProvider: '', previousFetchProvider: '' }) },
  } as unknown as Config
}

function depsOf(options: {
  researchEnabled?: boolean
  searchAvailable?: boolean
  fetchAvailable?: boolean
  researchRegistered?: boolean
  searchEnabled?: boolean
  fetchEnabled?: boolean
} = {}): RouteDeps {
  const adapters = {
    getSearchAdapter: (id: string) => id === 'searxng' ? {} : undefined,
    getFetchAdapter: (id: string) => id === 'readable-http' ? {} : undefined,
    listAdapters: () => ({ search: [], fetch: [] }),
  } as unknown as SearchToolsService
  const search = {
    available: () => options.searchAvailable === true,
    cacheStats: () => ({ size: 0, hits: 0, misses: 0 }),
  } as unknown as SearchDispatcher
  const fetch = {
    available: () => options.fetchAvailable === true,
  } as unknown as FetchDispatcher
  return {
    config: configOf(options.researchEnabled === true, {
      search: options.searchEnabled,
      fetch: options.fetchEnabled,
    }),
    search,
    fetch,
    adapters,
    diagnostics: new Diagnostics(),
    researchRegistered: () => options.researchRegistered === true,
  }
}

const ctx = { get: () => undefined } as unknown as Context

describe('status truth', () => {
  it('reports fetch availability and research registration from live state', async () => {
    const status = await buildStatus(ctx, depsOf({
      researchEnabled: true,
      searchAvailable: true,
      fetchAvailable: true,
      researchRegistered: true,
    }))
    expect(status.version).toBe('0.1.5')
    expect(status.search.available).toBe(true)
    expect(status.search.registered).toBe(true)
    expect(status.fetch.available).toBe(true)
    expect(status.fetch.registered).toBe(true)
    expect(status.research.enabled).toBe(true)
    expect(status.research.registered).toBe(true)
  })

  it('does not hard-code available or registered when the runtime is off', async () => {
    const status = await buildStatus(ctx, depsOf({
      researchEnabled: false,
      searchAvailable: false,
      fetchAvailable: false,
      researchRegistered: false,
    }))
    expect(status.search.available).toBe(false)
    expect(status.fetch.available).toBe(false)
    expect(status.research.enabled).toBe(false)
    expect(status.research.registered).toBe(false)
  })

  it('reports adapter enabled flags instead of hard-coding them', async () => {
    const status = await buildStatus(ctx, depsOf({
      searchEnabled: false,
      fetchEnabled: false,
    }))
    expect(status.search.enabled).toBe(false)
    expect(status.fetch.enabled).toBe(false)
  })

  it('reports the Jina API key credential declared by its manifest', async () => {
    const deps = depsOf()
    deps.adapters = {
      getSearchAdapter: () => undefined,
      getFetchAdapter: (id: string) => id === 'readable-http' ? {} : undefined,
      listAdapters: () => ({ search: [], fetch: [jinaReaderManifest] }),
    } as unknown as SearchToolsService
    const credentialsCtx = {
      get: (name: string) => name === 'credentials'
        ? { describe: async (ref: string) => ({ configured: ref === 'JINA_API_KEY', writable: true }) }
        : undefined,
    } as unknown as Context
    const status = await buildStatus(credentialsCtx, deps)
    expect(status.credentials.JINA_API_KEY).toMatchObject({ configured: true, writable: true })
  })
})
