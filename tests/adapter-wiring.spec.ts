import { describe, expect, it } from 'vitest'
import { adapterConfig } from '../src/config.ts'
import type { AdapterContext } from '../src/core/host-types.ts'
import { jinaReaderAdapter } from '../src/fetch/adapters/jina-reader/adapter.ts'
import { readableHttpAdapter } from '../src/fetch/adapters/readable-http/adapter.ts'
import { wireHttpAdapter } from '../src/fetch/adapters/wire-http/adapter.ts'
import { localDirectAdapter } from '../src/search/adapters/local-direct/adapter.ts'
import { searxngAdapter } from '../src/search/adapters/searxng/adapter.ts'

const logger = { debug() {}, warn() {}, error() {} }

function contextOf(fetch: AdapterContext['fetch'] = async () => new Response('', { status: 200 })): AdapterContext {
  return {
    logger,
    getCredentials: () => undefined,
    env: {},
    fetch,
    now: () => Date.now(),
  }
}

describe('adapter wiring', () => {
  it('validates and creates every built-in adapter runtime', () => {
    const ctx = contextOf()
    const getConfig = () => ({})
    for (const adapter of [searxngAdapter, localDirectAdapter, readableHttpAdapter, jinaReaderAdapter, wireHttpAdapter]) {
      expect(adapter.validate({}).ok).toBe(true)
      const runtime = adapter.create(ctx, getConfig)
      expect(runtime.available()).toBeTypeOf('boolean')
    }
  })

  it('probes SearXNG through the adapter seam', async () => {
    const ctx = contextOf(async (input) => {
      const url = String(input)
      if (url.endsWith('/config')) return new Response('missing', { status: 404 })
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const result = await searxngAdapter.probe!(ctx, {
      instances: [{ url: 'http://127.0.0.1:8888', enabled: true, label: '' }],
      auth: { type: 'none' },
    }, AbortSignal.timeout(2_000))
    expect(result.ok).toBe(true)
  })

  it('probes Jina Reader through the adapter seam', async () => {
    const ctx = contextOf(async () => new Response(JSON.stringify({
      data: { content: 'reader text', url: 'https://example.com/' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const result = await jinaReaderAdapter.probe!(ctx, {}, 'https://example.com/', AbortSignal.timeout(2_000))
    expect(result.ok).toBe(true)
  })

  it('reads a stored adapter config or an empty object', () => {
    expect(adapterConfig({ adapter: 'one', adapters: { one: { value: 1 } } }, 'one')).toEqual({ value: 1 })
    expect(adapterConfig({ adapter: 'one', adapters: {} }, 'missing')).toEqual({})
  })
})
