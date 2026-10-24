import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { FetchAdapter, SearchAdapter } from '../src/core/host-types.ts'
import { AdapterRegistry, SearchToolsService } from '../src/core/service.ts'
import type { AdapterManifest } from '../src/core/types.ts'

function manifest(kind: 'search' | 'fetch', id: string): AdapterManifest {
  return {
    kind,
    id,
    label: id,
    description: `${id} adapter`,
    fields: [],
    defaults: {},
  }
}

function searchAdapter(id = 'search'): SearchAdapter {
  return {
    manifest: manifest('search', id),
    validate: () => ({ ok: true, issues: [] }),
    create: () => ({
      available: () => true,
      search: async () => ({ sources: [], truncated: false }),
    }),
  }
}

function fetchAdapter(id = 'fetch'): FetchAdapter {
  return {
    manifest: manifest('fetch', id),
    validate: () => ({ ok: true, issues: [] }),
    create: () => ({
      available: () => true,
      fetch: async () => ({
        url: 'https://example.com/',
        statusCode: 200,
        body: { kind: 'text' as const, content: 'ok' },
        truncated: false,
      }),
    }),
  }
}

describe('adapter registry', () => {
  it('rejects empty and duplicate ids and disposes only the matching registration', () => {
    const registry = new AdapterRegistry<SearchAdapter>()
    const empty = searchAdapter('')
    expect(() => registry.add(empty)).toThrow('adapter id must not be empty')

    const first = searchAdapter('same')
    const dispose = registry.add(first)
    expect(() => registry.add(searchAdapter('same'))).toThrow('adapter "same" is already registered for search')
    expect(registry.get('same')).toBe(first)
    expect(registry.list()).toEqual([first])

    const replacement = searchAdapter('same')
    registry.clear()
    const disposeReplacement = registry.add(replacement)
    dispose()
    expect(registry.get('same')).toBe(replacement)
    disposeReplacement()
    expect(registry.get('same')).toBeUndefined()
  })

  it('supports idempotent disposal and empty/list/clear reads', () => {
    const registry = new AdapterRegistry<SearchAdapter>()
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.list()).toEqual([])
    const dispose = registry.add(searchAdapter('one'))
    dispose()
    dispose()
    expect(registry.list()).toEqual([])
    registry.add(searchAdapter('two'))
    registry.clear()
    expect(registry.list()).toEqual([])
  })
})

describe('search tools service', () => {
  it('registers search and fetch adapters and exposes their manifests', async () => {
    const ctx = new Context()
    const service = new SearchToolsService(ctx)
    expect(typeof ctx.get('searchTools')?.registerSearchAdapter).toBe('function')

    const searchDispose = service.registerSearchAdapter(searchAdapter('search'))
    const fetchDispose = service.registerFetchAdapter(fetchAdapter('fetch'))
    expect(service.getSearchAdapter('search')?.manifest.id).toBe('search')
    expect(service.getFetchAdapter('fetch')?.manifest.id).toBe('fetch')
    expect(service.listAdapters()).toEqual({
      search: [manifest('search', 'search')],
      fetch: [manifest('fetch', 'fetch')],
    })

    searchDispose()
    fetchDispose()
    expect(service.listAdapters()).toEqual({ search: [], fetch: [] })
    await ctx.fiber.dispose()
  })

  it('rejects an adapter registered under the wrong kind', () => {
    const ctx = new Context()
    const service = new SearchToolsService(ctx)
    expect(() => service.registerSearchAdapter(fetchAdapter() as unknown as SearchAdapter))
      .toThrow('adapter "fetch" is not a search adapter')
    expect(() => service.registerFetchAdapter(searchAdapter() as unknown as FetchAdapter))
      .toThrow('adapter "search" is not a fetch adapter')
  })

  it('rejects duplicate ids through the service and clears registries on disposal', async () => {
    const ctx = new Context()
    const service = new SearchToolsService(ctx)
    service.registerSearchAdapter(searchAdapter('dup'))
    expect(() => service.registerSearchAdapter(searchAdapter('dup')))
      .toThrow('adapter "dup" is already registered for search')

    await ctx.fiber.dispose()
    expect(service.listAdapters()).toEqual({ search: [], fetch: [] })
  })
})
