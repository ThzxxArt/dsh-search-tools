import { describe, expect, it } from 'vitest'
import type { AdapterContext, CredentialLookup } from '../src/core/host-types.ts'
import {
  parseRetryAfterMs, probeSearxng, SearxngRuntime,
} from '../src/search/adapters/searxng/client.ts'

const logger = { debug() {}, warn() {}, error() {} }

function context(
  fetchImpl: AdapterContext['fetch'],
  credentials?: CredentialLookup,
  env: Record<string, string | undefined> = {},
): AdapterContext {
  return {
    logger,
    getCredentials: () => credentials,
    env,
    fetch: fetchImpl,
    now: () => Date.now(),
  }
}

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    instances: [{ url: 'http://127.0.0.1:8888', enabled: true, label: '' }],
    auth: { type: 'none' },
    pages: 1,
    maxResults: 5,
    retries: 0,
    cacheMaxEntries: 0,
    cacheTtlMs: 10_000,
    requestTimeoutMs: 1_000,
    deadlineMs: 5_000,
    format: 'json',
    language: 'all',
    ...overrides,
  }
}

function jsonResponse(results: unknown[] = [{ url: 'https://example.com/a', title: 'A', content: 'S' }]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function htmlResponse(): Response {
  return new Response(
    '<article class="result"><h3><a href="https://example.com/html">HTML result</a></h3><p class="content">From HTML</p></article>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

describe('SearXNG runtime edge branches', () => {
  it('handles disabled, unconfigured, and cache lifecycle states', async () => {
    const disabled = new SearxngRuntime(context(async () => jsonResponse()), () => config({ enabled: false }))
    expect(disabled.available()).toBe(false)
    await expect(disabled.search({ query: 'q' })).rejects.toMatchObject({ code: 'SEARXNG_DISABLED' })

    const empty = new SearxngRuntime(context(async () => jsonResponse()), () => config({ instances: [] }))
    expect(empty.available()).toBe(false)
    await expect(empty.search({ query: 'q' })).rejects.toMatchObject({ code: 'SEARXNG_NOT_CONFIGURED' })

    const runtime = new SearxngRuntime(context(async () => jsonResponse()), () => config({
      cacheMaxEntries: 4,
      cacheTtlMs: 10_000,
    }))
    await runtime.search({ query: 'q' })
    expect(runtime.cacheStats()).toMatchObject({ size: 1, misses: 1 })
    runtime.clearCache()
    expect(runtime.cacheStats()).toEqual({ size: 0, hits: 0, misses: 0 })
  })

  it('falls back to environment tokens and rejects incomplete Basic auth', async () => {
    const seen: Array<Record<string, string>> = []
    const bearer = new SearxngRuntime(context(async (_input, init) => {
      seen.push(init?.headers as Record<string, string>)
      return jsonResponse()
    }, undefined, { SEARXNG_TOKEN: 'env-token' }), () => config({ auth: { type: 'bearer' } }))
    await bearer.search({ query: 'env' })
    expect(seen[0]?.authorization).toBe('Bearer env-token')

    const missingBearer = new SearxngRuntime(context(async () => jsonResponse()), () => config({ auth: { type: 'bearer' } }))
    await expect(missingBearer.search({ query: 'missing' })).rejects.toMatchObject({ code: 'SEARXNG_AUTH' })

    const badBasic = new SearxngRuntime(context(async () => jsonResponse(), undefined, { SEARXNG_BASIC_AUTH: 'missing-colon' }), () => config({ auth: { type: 'basic' } }))
    await expect(badBasic.search({ query: 'basic' })).rejects.toMatchObject({ code: 'SEARXNG_AUTH' })

    const envBasic = new SearxngRuntime(context(async (_input, init) => {
      seen.push(init?.headers as Record<string, string>)
      return jsonResponse()
    }, undefined, { SEARXNG_BASIC_AUTH: 'user:pass' }), () => config({ auth: { type: 'basic' } }))
    await envBasic.search({ query: 'basic-ok' })
    expect(seen[1]?.authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
  })

  it('maps credential rejection, all-instance failures, and failed page sets', async () => {
    const rejecting = new SearxngRuntime(context(async () => jsonResponse(), {
      resolve: async () => { throw new Error('credential store failed') },
    }), () => config({ auth: { type: 'bearer' } }))
    await expect(rejecting.search({ query: 'credential' })).rejects.toThrow('credential store failed')

    const generic = new SearxngRuntime(context(async () => { throw new Error('network down') }), () => config())
    await expect(generic.search({ query: 'network' })).rejects.toMatchObject({ code: 'SEARXNG_ALL_FAILED' })

    const allPagesFail = new SearxngRuntime(context(async () => new Response('boom', { status: 500 })), () => config({
      pages: 2,
      retries: 0,
    }))
    await expect(allPagesFail.search({ query: 'pages' })).rejects.toMatchObject({ code: 'SEARXNG_ALL_FAILED' })
  })

  it('retries retryable 500 and 429 responses', async () => {
    let calls = 0
    const retrying = new SearxngRuntime(context(async () => {
      calls++
      return calls === 1 ? new Response('slow', { status: 429, headers: { 'retry-after': '0' } }) : jsonResponse()
    }), () => config({ retries: 1 }))
    await expect(retrying.search({ query: 'retry' })).resolves.toMatchObject({ sources: expect.any(Array) })

    let serverCalls = 0
    const serverRetry = new SearxngRuntime(context(async () => {
      serverCalls++
      return serverCalls === 1 ? new Response('boom', { status: 500 }) : jsonResponse()
    }), () => config({ retries: 1 }))
    await expect(serverRetry.search({ query: 'server' })).resolves.toMatchObject({ sources: expect.any(Array) })
  })

  it('honours auto format fallback for 415 and malformed JSON', async () => {
    const fallback415 = new SearxngRuntime(context(async (call) => {
      const input = String(call)
      return input.includes('format=html') ? htmlResponse() : new Response('unsupported', { status: 415 })
    }), () => config({ format: 'auto' }))
    await expect(fallback415.search({ query: '415' })).resolves.toMatchObject({
      sources: [{ url: 'https://example.com/html' }],
    })

    const badJson = new SearxngRuntime(context(async (call) => {
      const input = String(call)
      return input.includes('format=html')
        ? htmlResponse()
        : new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })
    }), () => config({ format: 'auto' }))
    await expect(badJson.search({ query: 'json' })).resolves.toMatchObject({
      sources: [{ url: 'https://example.com/html' }],
    })

    const jsonMode = new SearxngRuntime(context(async () => new Response('{not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })), () => config({ format: 'json' }))
    await expect(jsonMode.search({ query: 'bad-json' })).rejects.toMatchObject({ code: 'SEARXNG_BAD_RESPONSE' })
  })

  it('parses HTML directly, uses POST bodies, and applies a proxy dispatcher', async () => {
    let init: RequestInit | undefined
    const runtime = new SearxngRuntime(context(async (_input, requestInit) => {
      init = requestInit
      return htmlResponse()
    }), () => config({ format: 'html', method: 'POST', proxy: 'http://127.0.0.1:7890' }))
    const result = await runtime.search({ query: 'html' })
    expect(result.sources[0]?.url).toBe('https://example.com/html')
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('q=html')
    expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined()
  })

  it('merges duplicate pages, notes, titles, snippets, and truncation flags', async () => {
    const runtime = new SearxngRuntime(context(async (call) => {
      const page = new URL(String(call)).searchParams.get('pageno')
      return jsonResponse(page === '1'
        ? [{ url: 'https://example.com/a', title: 'Short', content: 'one', publishedDate: '2026-01-01' }]
        : [{ url: 'https://example.com/a', title: 'Longer title', content: 'two' }, { url: 'https://example.com/b', title: 'B' }])
    }), () => config({ pages: 2, maxResults: 1 }))
    const result = await runtime.search({ query: 'merge' })
    expect(result.sources).toEqual([
      { url: 'https://example.com/a', title: 'Longer title', snippet: 'one', publishedAt: '2026-01-01' },
    ])
    expect(result.truncated).toBe(true)
  })

  it('clips long titles, snippets, answers, and exposes page notes', async () => {
    const runtime = new SearxngRuntime(context(async (call) => {
      if (new URL(String(call)).searchParams.get('pageno') === '1') {
        return jsonResponse([{ url: 'https://example.com/a', title: 't'.repeat(600), snippet: 's'.repeat(2_100), content: 'a'.repeat(9_000) }])
      }
      return new Response('failed page', { status: 500 })
    }), () => config({ pages: 2 }))
    const result = await runtime.search({ query: 'clip' })
    expect(result.sources[0]?.title).toHaveLength(500)
    expect(result.notes?.join(' ')).toContain('page 2')
    expect(result.truncated).toBe(true)
  })

  it('interrupts retry sleep and credential waits on caller abort', async () => {
    const controller = new AbortController()
    const retry = new SearxngRuntime(context(async () => new Response('slow', {
      status: 429,
      headers: { 'retry-after': '5' },
    })), () => config({ retries: 1, deadlineMs: 10_000 }))
    setTimeout(() => controller.abort(), 10)
    await expect(retry.search({ query: 'abort-sleep' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })

    const controller2 = new AbortController()
    const credential = new SearxngRuntime(context(async () => jsonResponse(), {
      resolve: async () => await new Promise<never>(() => {}),
    }), () => config({ auth: { type: 'bearer' }, deadlineMs: 10_000 }))
    setTimeout(() => controller2.abort(), 10)
    await expect(credential.search({ query: 'abort-credential' }, controller2.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('exposes the runtime probe and language/date parsers', async () => {
    const runtime = new SearxngRuntime(context(async (call) => {
      const input = String(call)
      return input.endsWith('/config') ? new Response('missing', { status: 404 }) : jsonResponse([])
    }), () => config({ language: 'en-US' }))
    await expect(runtime.probe()).resolves.toMatchObject({ ok: true })

    expect(parseRetryAfterMs('later', 0)).toBeUndefined()
    expect(parseRetryAfterMs('-1', 0)).toBeUndefined()
    expect(parseRetryAfterMs('', 0)).toBeUndefined()
  })
})

describe('SearXNG probe edge branches', () => {
  it('reports missing instances and auth failures before probing', async () => {
    expect(await probeSearxng(context(async () => jsonResponse()), config({ instances: [] }), AbortSignal.timeout(2_000)))
      .toMatchObject({ ok: false, code: 'SEARXNG_NOT_CONFIGURED' })
    expect(await probeSearxng(context(async () => jsonResponse()), config({ auth: { type: 'bearer' } }), AbortSignal.timeout(2_000)))
      .toMatchObject({ ok: false, code: 'SEARXNG_AUTH' })
  })

  it('maps config 401/403 and search auth/rate/failure responses', async () => {
    const authConfig = await probeSearxng(context(async () => new Response('', { status: 401 })), config(), AbortSignal.timeout(2_000))
    expect(authConfig).toMatchObject({ ok: false, code: 'SEARXNG_AUTH' })

    const authSearch = await probeSearxng(context(async (call) => {
      const input = String(call)
      return input.endsWith('/config') ? new Response('missing', { status: 404 }) : new Response('', { status: 403 })
    }), config(), AbortSignal.timeout(2_000))
    expect(authSearch).toMatchObject({ ok: false, code: 'SEARXNG_AUTH' })

    const rate = await probeSearxng(context(async (call) => {
      const input = String(call)
      return input.endsWith('/config') ? new Response('missing', { status: 404 }) : new Response('', { status: 429 })
    }), config(), AbortSignal.timeout(2_000))
    expect(rate).toMatchObject({ ok: false, code: 'SEARXNG_RATE_LIMIT' })

    const failed = await probeSearxng(context(async (call) => {
      const input = String(call)
      return input.endsWith('/config') ? new Response('missing', { status: 404 }) : new Response('boom', { status: 500 })
    }), config(), AbortSignal.timeout(2_000))
    expect(failed).toMatchObject({ ok: false, code: 'SEARXNG_ALL_FAILED' })
  })

  it('returns JSON metadata, malformed-json html, and HTML-only success', async () => {
    const metadata = await probeSearxng(context(async () => new Response(JSON.stringify({
      version: '1.2.3',
      engines: ['google', { name: 'bing' }, 1],
      categories: ['general', { name: 'images' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })), config(), AbortSignal.timeout(2_000))
    expect(metadata).toMatchObject({
      ok: true,
      json: true,
      html: true,
      version: '1.2.3',
      engines: ['google', 'bing'],
      categories: ['general', 'images'],
    })

    const malformed = await probeSearxng(context(async (call) => {
      const input = String(call)
      if (input.endsWith('/config')) {
        return new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }), config(), AbortSignal.timeout(2_000))
    expect(malformed).toMatchObject({ ok: true, json: true })

    const html = await probeSearxng(context(async (call) => {
      const input = String(call)
      return input.endsWith('/config')
        ? new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
        : htmlResponse()
    }), config(), AbortSignal.timeout(2_000))
    expect(html).toMatchObject({ ok: true, json: false, html: true })
  })

  it('maps network errors and aborted probes to stable codes', async () => {
    const network = await probeSearxng(context(async () => { throw new Error('network failed') }), config(), AbortSignal.timeout(2_000))
    expect(network).toMatchObject({ ok: false, code: 'SEARXNG_ALL_FAILED' })

    const controller = new AbortController()
    controller.abort()
    const aborted = await probeSearxng(context(async () => { throw new DOMException('aborted', 'AbortError') }), config(), controller.signal)
    expect(aborted).toMatchObject({ ok: false, code: 'WEB_ABORTED' })
  })
})
