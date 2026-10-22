import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../src/config.ts'
import type { AdapterContext, CredentialLookup, SearchAdapter } from '../src/core/host-types.ts'
import { createAdapterContext, SearchDispatcher } from '../src/core/dispatchers.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import type { SearchToolsService } from '../src/core/service.ts'
import { DEFAULT_ACTIVATION_CONFIG, DEFAULT_RESEARCH_CONFIG } from '../src/shared/defaults.ts'
import { SearxngRuntime } from '../src/search/adapters/searxng/client.ts'

const logger = { debug() {}, warn() {}, error() {} }

function fakeFetch(seen: Array<Record<string, string>>): AdapterContext['fetch'] {
  return async (_input, init) => {
    seen.push((init?.headers ?? {}) as Record<string, string>)
    return new Response(JSON.stringify({
      results: [{ url: 'https://example.com/a', title: 'A', content: 'snippet' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    instances: [{ url: 'http://127.0.0.1:8888', enabled: true, label: '' }],
    auth: { type: 'bearer' },
    cacheMaxEntries: 2,
    cacheTtlMs: 10_000,
    requestTimeoutMs: 1_000,
    deadlineMs: 5_000,
    retries: 0,
    ...overrides,
  }
}

describe('adapter context', () => {
  it('resolves credentials at call time, after a late mount', async () => {
    let credentials: CredentialLookup | undefined
    const ctx = {
      logger,
      get: (name: string) => name === 'credentials' ? credentials : undefined,
    } as unknown as Context
    const adapterCtx = createAdapterContext(ctx)
    expect(adapterCtx.getCredentials()).toBeUndefined()

    credentials = { resolve: async () => ({ value: 'late-token' }) }
    await expect(adapterCtx.getCredentials()?.resolve('SEARXNG_TOKEN'))
      .resolves.toEqual({ value: 'late-token' })
  })
})

describe('SearXNG runtime credentials and cache', () => {
  it('uses the live bearer credential and caches a hit', async () => {
    const seen: Array<Record<string, string>> = []
    let credentials: CredentialLookup | undefined = { resolve: async () => ({ value: 'live-token' }) }
    const ctx: AdapterContext = {
      logger,
      getCredentials: () => credentials,
      env: {},
      fetch: fakeFetch(seen),
      now: () => Date.now(),
    }
    const runtime = new SearxngRuntime(ctx, () => baseConfig())

    const first = await runtime.search({ query: 'q', maxResults: 1 })
    expect(first.sources).toHaveLength(1)
    expect(seen[0]?.authorization).toBe('Bearer live-token')
    expect(runtime.cacheStats()).toMatchObject({ size: 1, hits: 0, misses: 1 })

    await runtime.search({ query: 'q', maxResults: 1 })
    expect(runtime.cacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })
    expect(seen).toHaveLength(1)

    // A late credential mount must be visible to the next uncached search.
    credentials = { resolve: async () => ({ value: 'rotated-token' }) }
    runtime.clearCache()
    await runtime.search({ query: 'q2', maxResults: 1 })
    expect(seen[1]?.authorization).toBe('Bearer rotated-token')
  })

  it('rebuilds the cache when the live bounds change', async () => {
    let config = baseConfig({ auth: { type: 'none' } })
    const ctx: AdapterContext = {
      logger,
      getCredentials: () => undefined,
      env: {},
      fetch: fakeFetch([]),
      now: () => Date.now(),
    }
    const runtime = new SearxngRuntime(ctx, () => config)
    await runtime.search({ query: 'q', maxResults: 1 })
    expect(runtime.cacheStats().size).toBe(1)

    config = baseConfig({ auth: { type: 'none' }, cacheMaxEntries: 0 })
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('keeps Basic auth out of YAML and builds the header from the credential', async () => {
    const seen: Array<Record<string, string>> = []
    const ctx: AdapterContext = {
      logger,
      getCredentials: () => ({ resolve: async () => ({ value: 'user:pass' }) }),
      env: {},
      fetch: fakeFetch(seen),
      now: () => Date.now(),
    }
    const runtime = new SearxngRuntime(ctx, () => baseConfig({ auth: { type: 'basic' } }))
    await runtime.search({ query: 'q', maxResults: 1 })
    expect(seen[0]?.authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
  })
})

describe('stable search provider', () => {
  it('selects the configured adapter while the provider id stays fixed', async () => {
    const adapter: SearchAdapter = {
      manifest: {
        kind: 'search',
        id: 'fake',
        label: 'Fake',
        description: 'Test adapter',
        fields: [],
        defaults: {},
      },
      validate: () => ({ ok: true, issues: [] }),
      create: () => ({
        available: () => true,
        search: async () => ({
          sources: [{ url: 'https://example.com/fake', title: 'Fake result' }],
          truncated: false,
        }),
      }),
    }
    const adapters = {
      getSearchAdapter: (id: string) => id === 'fake' ? adapter : undefined,
      listAdapters: () => ({ search: [adapter.manifest], fetch: [] }),
    } as unknown as SearchToolsService
    const config = {
      search: { get: () => ({ adapter: 'fake', adapters: { fake: {} } }) },
      fetch: { get: () => ({ adapter: 'readable-http', adapters: {} }) },
      research: { get: () => DEFAULT_RESEARCH_CONFIG },
      activation: { get: () => DEFAULT_ACTIVATION_CONFIG },
    } as unknown as Config
    const ctx = { logger, get: () => undefined } as unknown as Context
    const dispatcher = new SearchDispatcher(ctx, config, adapters, new Diagnostics())

    expect(dispatcher.id).toBe('dsh-search-tools')
    expect(dispatcher.available()).toBe(true)
    const result = await dispatcher.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://example.com/fake')
  })
})
