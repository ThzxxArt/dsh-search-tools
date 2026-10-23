import { describe, expect, it } from 'vitest'
import type { AdapterContext, CredentialLookup } from '../src/core/host-types.ts'
import { SearxngRuntime, parseRetryAfterMs, probeSearxng } from '../src/search/adapters/searxng/client.ts'

const logger = { debug() {}, warn() {}, error() {} }

function context(fetchImpl: AdapterContext['fetch'], credentials?: CredentialLookup): AdapterContext {
  return {
    logger,
    getCredentials: () => credentials,
    env: {},
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

class Recorder {
  readonly calls: Array<{ url: URL; init: RequestInit & { dispatcher?: unknown } }> = []
}

function recordingFetch(body: (call: number) => Response | Promise<Response>, recorder: Recorder): AdapterContext['fetch'] {
  return async (input, init) => {
    recorder.calls.push({ url: new URL(String(input)), init: (init ?? {}) as RequestInit & { dispatcher?: unknown } })
    return await body(recorder.calls.length)
  }
}

describe('SearXNG request contract', () => {
  it('sends the configured UA, accept-language, auth, and query parameters', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch(() => jsonResponse(), recorder)), () => config({
      language: 'zh-CN',
      userAgent: 'dsh-search-tools test/1.0',
      engines: ['google'],
      categories: ['general'],
      safesearch: 2,
      timeRange: 'week',
    }))

    await runtime.search({ query: 'deepseek', maxResults: 3 })

    expect(recorder.calls).toHaveLength(1)
    const call = recorder.calls[0]!
    expect(call.url.searchParams.get('q')).toBe('deepseek')
    expect(call.url.searchParams.get('pageno')).toBe('1')
    expect(call.url.searchParams.get('engines')).toBe('google')
    expect(call.url.searchParams.get('categories')).toBe('general')
    expect(call.url.searchParams.get('language')).toBe('zh-CN')
    expect(call.url.searchParams.get('safesearch')).toBe('2')
    expect(call.url.searchParams.get('time_range')).toBe('week')
    expect(call.url.searchParams.get('format')).toBe('json')
    expect(call.init.headers).toMatchObject({
      'user-agent': 'dsh-search-tools test/1.0',
      'accept-language': 'zh-CN,zh;q=0.9',
    })
  })

  it('merges successful pages and records a failed page as a note', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch((call) => {
      if (call === 1) return jsonResponse([{ url: 'https://example.com/a', title: 'A' }])
      return new Response('boom', { status: 500 })
    }, recorder)), () => config({ pages: 2, cacheMaxEntries: 10, cacheTtlMs: 10_000 }))

    const result = await runtime.search({ query: 'partial' })

    expect(result.sources.map(source => source.url)).toEqual(['https://example.com/a'])
    expect(result.notes?.join(' ')).toContain('page 2')
  })

  it('uses POST form bodies, round-robin order, and the request result cap', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch((call) => {
      const host = recorder.calls[call - 1]?.url.host
      return jsonResponse([
        { url: `https://${host}/a`, title: 'A' },
        { url: `https://${host}/b`, title: 'B' },
      ])
    }, recorder)), () => config({
      method: 'POST',
      strategy: 'round-robin',
      instances: [
        { url: 'http://127.0.0.1:8888', enabled: true, label: '' },
        { url: 'http://127.0.0.1:9999', enabled: true, label: '' },
      ],
      maxResults: 2,
    }))

    const first = await runtime.search({ query: 'post', maxResults: 1 })
    const second = await runtime.search({ query: 'post', maxResults: 1 })
    expect(recorder.calls[0]?.url.host).toBe('127.0.0.1:8888')
    expect(recorder.calls[1]?.url.host).toBe('127.0.0.1:9999')
    expect(recorder.calls[0]?.url.search).toBe('')
    expect(String(recorder.calls[0]?.init.body)).toContain('q=post')
    expect(recorder.calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
    expect(first.sources).toHaveLength(1)
    expect(second.sources).toHaveLength(1)
  })

  it('applies includeDomains and excludeDomains from the live config', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch(() => jsonResponse([
      { url: 'https://example.com/keep', title: 'Keep' },
      { url: 'https://other.example/drop', title: 'Other' },
      { url: 'https://spam.example/drop', title: 'Spam' },
    ]), recorder)), () => config({ includeDomains: ['example.com'], excludeDomains: ['spam.example'] }))

    const result = await runtime.search({ query: 'domains' })
    expect(result.sources.map(source => source.url)).toEqual(['https://example.com/keep'])
  })

  it('omits accept-language for language=all and caps returned sources', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch(() => jsonResponse([
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/b', title: 'B' },
      { url: 'https://example.com/c', title: 'C' },
    ]), recorder)), () => config({ language: 'all', maxResults: 2 }))

    const result = await runtime.search({ query: 'caps', maxResults: 2 })
    expect(recorder.calls[0]?.init.headers).not.toHaveProperty('accept-language')
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('falls back from JSON to HTML on 403 in auto mode, but not on 401', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch((call) => call === 1
      ? new Response('forbidden', { status: 403 })
      : htmlResponse(), recorder)), () => config({ format: 'auto' }))

    const result = await runtime.search({ query: 'fallback' })
    expect(result.sources[0]?.url).toBe('https://example.com/html')
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[1]?.url.searchParams.get('format')).toBe('html')

    const unauthorized = new Recorder()
    const authRuntime = new SearxngRuntime(context(recordingFetch(() => new Response('', { status: 401 }), unauthorized)), () => config({ format: 'auto', retries: 2 }))
    await expect(authRuntime.search({ query: 'auth' })).rejects.toMatchObject({ code: 'SEARXNG_AUTH' })
    expect(unauthorized.calls).toHaveLength(1)
  })

  it('stops at the configured deadline even with retries', async () => {
    const runtime = new SearxngRuntime(context(async (_input, init) => {
      const signal = init?.signal
      if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }), () => config({ deadlineMs: 1_000, requestTimeoutMs: 5_000, retries: 5 }))

    const started = Date.now()
    await expect(runtime.search({ query: 'slow' })).rejects.toMatchObject({ code: 'SEARXNG_DEADLINE' })
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  it('honors Retry-After on 429 instead of exponential backoff', async () => {
    const recorder = new Recorder()
    const times: number[] = []
    const runtime = new SearxngRuntime(context(recordingFetch((call) => {
      times.push(Date.now())
      if (call === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '0.05' } })
      return jsonResponse()
    }, recorder)), () => config({ retries: 1, requestTimeoutMs: 1_000, deadlineMs: 5_000 }))

    const result = await runtime.search({ query: 'retry-after' })
    expect(result.sources).toHaveLength(1)
    expect(times).toHaveLength(2)
    const delay = times[1]! - times[0]!
    expect(delay).toBeGreaterThanOrEqual(40)
    expect(delay).toBeLessThan(300)
  })

  it('does not retry after the caller aborts', async () => {
    let calls = 0
    const controller = new AbortController()
    const runtime = new SearxngRuntime(context(async (_input, init) => {
      calls++
      const signal = init?.signal
      if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }), () => config({ deadlineMs: 5_000, requestTimeoutMs: 5_000, retries: 5 }))

    setTimeout(() => controller.abort(), 10)
    await expect(runtime.search({ query: 'cancel' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(calls).toBe(1)
  })
})

describe('SearXNG cache contract', () => {
  it('honors TTL 0 as disabled', async () => {
    const recorder = new Recorder()
    const runtime = new SearxngRuntime(context(recordingFetch(() => jsonResponse(), recorder)), () => config({
      cacheMaxEntries: 10,
      cacheTtlMs: 0,
    }))

    await runtime.search({ query: 'no-cache' })
    await runtime.search({ query: 'no-cache' })
    expect(recorder.calls).toHaveLength(2)
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('misses when UA or auth type changes', async () => {
    const recorder = new Recorder()
    let current = config({ cacheMaxEntries: 10, cacheTtlMs: 10_000, userAgent: 'ua-one' })
    const runtime = new SearxngRuntime(
      context(recordingFetch(() => jsonResponse(), recorder), { resolve: async () => ({ value: 'token' }) }),
      () => current,
    )

    await runtime.search({ query: 'key' })
    await runtime.search({ query: 'key' })
    expect(recorder.calls).toHaveLength(1)

    current = config({ cacheMaxEntries: 10, cacheTtlMs: 10_000, userAgent: 'ua-two' })
    await runtime.search({ query: 'key' })
    expect(recorder.calls).toHaveLength(2)

    current = config({ cacheMaxEntries: 10, cacheTtlMs: 10_000, userAgent: 'ua-two', auth: { type: 'bearer' } })
    await runtime.search({ query: 'key' })
    expect(recorder.calls).toHaveLength(3)
  })
})

describe('SearXNG Retry-After parser', () => {
  const now = Date.parse('2026-10-23T00:00:00.000Z')

  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('3', now)).toBe(3_000)
    expect(parseRetryAfterMs('0.05', now)).toBe(50)
    expect(parseRetryAfterMs('Fri, 23 Oct 2026 00:00:05 GMT', now)).toBe(5_000)
  })

  it('ignores invalid, negative, and missing values', () => {
    expect(parseRetryAfterMs(null, now)).toBeUndefined()
    expect(parseRetryAfterMs('', now)).toBeUndefined()
    expect(parseRetryAfterMs('-1', now)).toBeUndefined()
    expect(parseRetryAfterMs('later', now)).toBeUndefined()
  })
})

describe('SearXNG probe contract', () => {
  it('uses the configured UA and falls back to /search when /config is missing', async () => {
    const recorder = new Recorder()
    const result = await probeSearxng(context(recordingFetch((call) => {
      if (call === 1) return new Response('not found', { status: 404 })
      return jsonResponse([])
    }, recorder)), config({ userAgent: 'probe-agent' }), AbortSignal.timeout(2_000))

    expect(result.ok).toBe(true)
    expect(result.json).toBe(true)
    expect(result.html).toBe(true)
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[0]?.url.pathname).toBe('/config')
    expect(recorder.calls[1]?.url.pathname).toBe('/search')
    expect(recorder.calls[0]?.init.headers).toMatchObject({ 'user-agent': 'probe-agent' })
  })

  it('falls back to /search when /config is malformed JSON', async () => {
    const recorder = new Recorder()
    const result = await probeSearxng(context(recordingFetch((call) => {
      if (call === 1) return new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })
      return jsonResponse([])
    }, recorder)), config(), AbortSignal.timeout(2_000))

    expect(result.ok).toBe(true)
    expect(recorder.calls.map(call => call.url.pathname)).toEqual(['/config', '/search'])
  })

  it('reports a reachable HTML-only instance without calling /search', async () => {
    const recorder = new Recorder()
    const result = await probeSearxng(context(recordingFetch(() => htmlResponse(), recorder)), config(), AbortSignal.timeout(2_000))
    expect(result).toMatchObject({ ok: true, json: false, html: true })
    expect(recorder.calls).toHaveLength(1)
  })

  it('uses the configured POST method for the /search probe fallback', async () => {
    const recorder = new Recorder()
    const result = await probeSearxng(context(recordingFetch((call) => {
      if (call === 1) return new Response('not found', { status: 404 })
      return jsonResponse([])
    }, recorder)), config({ method: 'POST' }), AbortSignal.timeout(2_000))

    expect(result.ok).toBe(true)
    expect(recorder.calls[1]?.init.method).toBe('POST')
    expect(String(recorder.calls[1]?.init.body)).toContain('format=json')
  })

  it('bounds a hanging probe by requestTimeoutMs even with a longer caller signal', async () => {
    const started = Date.now()
    const result = await probeSearxng(context(async (_input, init) => {
      if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }), config({ requestTimeoutMs: 1_000 }), AbortSignal.timeout(5_000))

    expect(result.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('passes the configured proxy to search and probe requests', async () => {
    const recorder = new Recorder()
    const proxy = 'http://127.0.0.1:7890'
    const runtime = new SearxngRuntime(context(recordingFetch(() => jsonResponse(), recorder)), () => config({ proxy }))
    await runtime.search({ query: 'proxy' })
    expect(recorder.calls[0]?.init.dispatcher).toBeDefined()

    const probeRecorder = new Recorder()
    await probeSearxng(context(recordingFetch((call) => call === 1
      ? new Response('missing', { status: 404 })
      : jsonResponse([]), probeRecorder)), config({ proxy }), AbortSignal.timeout(2_000))
    expect(probeRecorder.calls[0]?.init.dispatcher).toBeDefined()
    expect(probeRecorder.calls[1]?.init.dispatcher).toBeDefined()
  })
})
