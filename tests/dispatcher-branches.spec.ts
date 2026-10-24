import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import type { FetchAdapter, SearchAdapter } from '../src/core/host-types.ts'
import {
  createAdapterContext, FetchDispatcher, SearchDispatcher,
} from '../src/core/dispatchers.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import type { SearchToolsService } from '../src/core/service.ts'
import type { AdapterIssue, AdapterManifest, JsonObject } from '../src/core/types.ts'
import { DEFAULT_ACTIVATION_CONFIG, DEFAULT_RESEARCH_CONFIG } from '../src/shared/defaults.ts'

const logger = { debug() {}, warn() {}, error() {} }

function manifest(kind: 'search' | 'fetch', id: string): AdapterManifest {
  return { kind, id, label: id, description: id, fields: [], defaults: {} }
}

function configOf(search: JsonObject = {}, fetch: JsonObject = {}, searchId = 'search', fetchId = 'fetch'): Config {
  return {
    search: { get: () => ({ adapter: searchId, adapters: { [searchId]: search } }) },
    fetch: { get: () => ({ adapter: fetchId, adapters: { [fetchId]: fetch } }) },
    research: { get: () => DEFAULT_RESEARCH_CONFIG },
    activation: { get: () => DEFAULT_ACTIVATION_CONFIG },
  } as unknown as Config
}

function searchAdapter(options: {
  id?: string
  validate?: (config: unknown) => { ok: boolean; issues: readonly AdapterIssue[] }
  available?: boolean
  probe?: boolean
  search?: (request: unknown, signal?: AbortSignal) => Promise<unknown>
} = {}): SearchAdapter {
  const id = options.id ?? 'search'
  return {
    manifest: manifest('search', id),
    validate: options.validate ?? (() => ({ ok: true, issues: [] })),
    ...(options.probe === false ? {} : {
      probe: async (_ctx, _config, signal) => ({ ok: true, latencyMs: 1, ...(signal === undefined ? {} : {}) }),
    }),
    create: (_ctx, getConfig) => ({
      available: () => options.available ?? true,
      search: async (request, signal) => {
        getConfig()
        return options.search === undefined
          ? { sources: [{ url: 'https://example.com/a' }], truncated: false }
          : await options.search(request, signal) as never
      },
      clearCache: vi.fn(),
      cacheStats: () => ({ size: 1, hits: 2, misses: 3 }),
    }),
  }
}

function fetchAdapter(options: {
  id?: string
  validate?: (config: unknown) => { ok: boolean; issues: readonly AdapterIssue[] }
  available?: boolean
  probe?: boolean
  fetch?: (request: unknown, signal?: AbortSignal) => Promise<unknown>
} = {}): FetchAdapter {
  const id = options.id ?? 'fetch'
  return {
    manifest: manifest('fetch', id),
    validate: options.validate ?? (() => ({ ok: true, issues: [] })),
    ...(options.probe === false ? {} : {
      probe: async (_ctx, _config, _url, signal) => ({ ok: true, latencyMs: 1, ...(signal === undefined ? {} : {}) }),
    }),
    create: (_ctx, getConfig) => ({
      available: () => options.available ?? true,
      fetch: async (request, signal) => {
        getConfig()
        return options.fetch === undefined
          ? {
              url: 'https://example.com/a',
              statusCode: 200,
              body: { kind: 'text' as const, content: 'ok' },
              truncated: false,
            }
          : await options.fetch(request, signal) as never
      },
    }),
  }
}

function adaptersOf(search?: SearchAdapter, fetch?: FetchAdapter): SearchToolsService {
  return {
    getSearchAdapter: (id: string) => id === (search?.manifest.id ?? 'search') ? search : undefined,
    getFetchAdapter: (id: string) => id === (fetch?.manifest.id ?? 'fetch') ? fetch : undefined,
    listAdapters: () => ({
      search: search === undefined ? [] : [search.manifest],
      fetch: fetch === undefined ? [] : [fetch.manifest],
    }),
  } as unknown as SearchToolsService
}

function contextOf(): Context {
  return { logger, get: () => undefined } as unknown as Context
}

function invalidAdapter(): AdapterIssue[] {
  return [
    { path: 'a', message: 'one' },
    { path: 'b', message: 'two' },
    { path: 'c', message: 'three' },
    { path: 'd', message: 'four' },
    { path: 'e', message: 'five' },
  ]
}

describe('adapter context', () => {
  it('captures the live logger, credentials, env, fetch, and clock', async () => {
    const ctx = contextOf()
    const adapterCtx = createAdapterContext(ctx)
    expect(adapterCtx.logger).toBe(logger)
    expect(adapterCtx.env).toBe(process.env)
    expect(typeof adapterCtx.fetch).toBe('function')
    expect(adapterCtx.now()).toBeTypeOf('number')
    expect(adapterCtx.getCredentials()).toBeUndefined()
  })
})

describe('search dispatcher branches', () => {
  it('reports unavailable adapters and missing registrations', async () => {
    const diagnostics = new Diagnostics()
    const missing = new SearchDispatcher(contextOf(), configOf(), adaptersOf(), diagnostics)
    expect(missing.available()).toBe(false)
    await expect(missing.search({ query: 'q' })).rejects.toMatchObject({ code: 'SEARCH_ADAPTER_MISSING' })
    expect(diagnostics.list()).toEqual([])

    const unavailable = new SearchDispatcher(
      contextOf(), configOf(), adaptersOf(searchAdapter({ available: false })), diagnostics,
    )
    expect(unavailable.available()).toBe(false)
    await expect(unavailable.search({ query: 'q' })).rejects.toMatchObject({ code: 'SEARCH_ADAPTER_UNAVAILABLE' })
  })

  it('records invalid config and summarizes at most four issues', async () => {
    const diagnostics = new Diagnostics()
    const adapter = searchAdapter({
      validate: () => ({ ok: false, issues: invalidAdapter() }),
    })
    const dispatcher = new SearchDispatcher(contextOf(), configOf(), adaptersOf(adapter), diagnostics)
    await expect(dispatcher.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_CONFIG_INVALID',
      message: expect.stringContaining('a: one; b: two; c: three; d: four'),
    })
    expect(diagnostics.list()[0]?.code).toBe('SEARCH_CONFIG_INVALID')
  })

  it('returns search results, cache stats, manifests, and clears caches', async () => {
    const adapter = searchAdapter({
      search: async () => ({ sources: [{ url: 'https://example.com/live' }], truncated: false }),
    })
    const dispatcher = new SearchDispatcher(contextOf(), configOf(), adaptersOf(adapter), new Diagnostics())
    expect(dispatcher.available()).toBe(true)
    expect(dispatcher.manifests().search[0]?.id).toBe('search')
    expect(dispatcher.cacheStats()).toEqual({ size: 1, hits: 2, misses: 3 })
    dispatcher.clearCache()
    await expect(dispatcher.search({ query: 'q' })).resolves.toMatchObject({
      sources: [{ url: 'https://example.com/live' }],
    })
  })

  it('handles probe and preview success, missing, unsupported, and default adapters', async () => {
    const adapter = searchAdapter()
    const dispatcher = new SearchDispatcher(contextOf(), configOf(), adaptersOf(adapter), new Diagnostics())
    await expect(dispatcher.probe('search', {})).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.probe('missing', {})).resolves.toMatchObject({ code: 'SEARCH_ADAPTER_MISSING' })

    const unsupported = searchAdapter({ probe: false })
    const unsupportedDispatcher = new SearchDispatcher(
      contextOf(), configOf(), adaptersOf(unsupported), new Diagnostics(),
    )
    await expect(unsupportedDispatcher.probe('search', {})).resolves.toMatchObject({
      code: 'SEARCH_PROBE_UNSUPPORTED',
    })

    await expect(dispatcher.preview('search', {}, { query: 'q' })).resolves.toMatchObject({
      truncated: false,
      sources: [{ url: 'https://example.com/a' }],
    })
    await expect(dispatcher.preview('missing', {}, { query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_ADAPTER_MISSING',
    })

    const rich = searchAdapter({
      search: async () => ({
        sources: [],
        truncated: true,
        content: 'content',
        notes: ['note'],
      }),
    })
    const richDispatcher = new SearchDispatcher(contextOf(), configOf(), adaptersOf(rich), new Diagnostics())
    await expect(richDispatcher.preview('search', {}, { query: 'q' })).resolves.toMatchObject({
      content: 'content',
      notes: ['note'],
    })
  })

  it('covers context fallbacks and adapter validation in available()', () => {
    const invalid = searchAdapter({ validate: () => ({ ok: false, issues: [] }) })
    const dispatcher = new SearchDispatcher(contextOf(), configOf(), adaptersOf(invalid), new Diagnostics())
    expect(dispatcher.available()).toBe(false)
    expect(dispatcher.cacheStats()).toEqual({ size: 1, hits: 2, misses: 3 })

    const noRuntime = new SearchDispatcher(contextOf(), configOf(), adaptersOf(), new Diagnostics())
    expect(noRuntime.cacheStats()).toEqual({ size: 0, hits: 0, misses: 0 })
  })
})

describe('fetch dispatcher branches', () => {
  it('reports missing, invalid, unavailable, and available adapters', async () => {
    const diagnostics = new Diagnostics()
    const missing = new FetchDispatcher(contextOf(), configOf(), adaptersOf(), diagnostics)
    expect(missing.available()).toBe(false)
    await expect(missing.fetch({ url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'FETCH_ADAPTER_MISSING',
    })

    const invalid = fetchAdapter({ validate: () => ({ ok: false, issues: [{ path: 'x', message: 'bad' }] }) })
    const invalidDispatcher = new FetchDispatcher(contextOf(), configOf(), adaptersOf(undefined, invalid), diagnostics)
    expect(invalidDispatcher.available()).toBe(false)
    await expect(invalidDispatcher.fetch({ url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'FETCH_CONFIG_INVALID',
    })
    expect(diagnostics.list()[0]?.code).toBe('FETCH_CONFIG_INVALID')

    const unavailable = fetchAdapter({ available: false })
    const unavailableDispatcher = new FetchDispatcher(
      contextOf(), configOf(), adaptersOf(undefined, unavailable), diagnostics,
    )
    await expect(unavailableDispatcher.fetch({ url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'FETCH_ADAPTER_UNAVAILABLE',
    })
  })

  it('returns fetch results, manifests, and probes', async () => {
    const adapter = fetchAdapter()
    const dispatcher = new FetchDispatcher(contextOf(), configOf(), adaptersOf(undefined, adapter), new Diagnostics())
    expect(dispatcher.available()).toBe(true)
    expect(dispatcher.manifests().fetch[0]?.id).toBe('fetch')
    await expect(dispatcher.fetch({ url: 'https://example.com/' })).resolves.toMatchObject({ statusCode: 200 })
    await expect(dispatcher.probe('fetch', {}, 'https://example.com/')).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.probe('missing', {}, 'https://example.com/')).resolves.toMatchObject({
      code: 'FETCH_ADAPTER_MISSING',
    })

    const unsupported = fetchAdapter({ probe: false })
    const unsupportedDispatcher = new FetchDispatcher(
      contextOf(), configOf(), adaptersOf(undefined, unsupported), new Diagnostics(),
    )
    await expect(unsupportedDispatcher.probe('fetch', {}, 'https://example.com/')).resolves.toMatchObject({
      code: 'FETCH_PROBE_UNSUPPORTED',
    })
  })

  it('covers preview success, missing registrations, and fetch throws', async () => {
    const success = fetchAdapter()
    const dispatcher = new FetchDispatcher(contextOf(), configOf(), adaptersOf(undefined, success), new Diagnostics())
    await expect(dispatcher.preview('fetch', {}, { url: 'https://example.com/' }))
      .resolves.toMatchObject({ statusCode: 200 })
    await expect(dispatcher.preview('missing', {}, { url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'FETCH_ADAPTER_MISSING',
    })

    const failing = fetchAdapter({
      fetch: async () => { throw new Error('fetch failed') },
    })
    const failingDispatcher = new FetchDispatcher(
      contextOf(), configOf(), adaptersOf(undefined, failing), new Diagnostics(),
    )
    await expect(failingDispatcher.fetch({ url: 'https://example.com/' })).rejects.toThrow('fetch failed')
    await expect(failingDispatcher.preview('fetch', {}, { url: 'https://example.com/' })).rejects.toThrow('fetch failed')
  })

  it('skips invalid available() configs and uses a null runtime cache entry', () => {
    const invalid = fetchAdapter({ validate: () => ({ ok: false, issues: [] }) })
    const dispatcher = new FetchDispatcher(contextOf(), configOf(), adaptersOf(undefined, invalid), new Diagnostics())
    expect(dispatcher.available()).toBe(false)
  })
})
