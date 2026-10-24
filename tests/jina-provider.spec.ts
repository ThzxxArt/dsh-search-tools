import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'

const target = vi.hoisted(() => ({
  resolve: vi.fn(async (raw: string) => new URL(raw)),
}))

vi.mock('../src/fetch/adapters/jina-reader/target.ts', () => ({
  resolveJinaTarget: target.resolve,
  isPublicIpAddress: () => true,
}))

import { JinaReaderRuntime } from '../src/fetch/adapters/jina-reader/provider.ts'
import { normalizeJinaReaderConfig } from '../src/fetch/adapters/jina-reader/schema.ts'
import { SearchToolsError } from '../src/shared/errors.ts'

interface Captured {
  input: string | URL | Request
  init: RequestInit | undefined
}

const logger = { debug() {}, warn() {}, error() {} }

function context(fetchImpl: AdapterContext['fetch'], secret?: string): AdapterContext {
  return {
    logger,
    getCredentials: () => ({
      resolve: async () => secret === undefined ? undefined : { value: secret },
    }),
    env: {},
    fetch: fetchImpl,
    now: () => 100,
  }
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function capture(factory: (captured: Captured) => Promise<Response>): {
  fetch: AdapterContext['fetch']
  captured: Captured[]
} {
  const captured: Captured[] = []
  return {
    captured,
    fetch: async (input, init) => {
      const item = { input, init }
      captured.push(item)
      return await factory(item)
    },
  }
}

function runtime(config: unknown, fetchImpl: AdapterContext['fetch'], secret?: string): JinaReaderRuntime {
  return new JinaReaderRuntime(context(fetchImpl, secret), () => normalizeJinaReaderConfig(config))
}

beforeEach(() => {
  target.resolve.mockReset()
  target.resolve.mockImplementation(async (raw: string) => new URL(raw))
})

describe('Jina Reader runtime request mapping', () => {
  it('maps endpoint, key, engine, selectors, and all supported headers', async () => {
    const fake = capture(async () => response({
      data: {
        html: '<article>rendered</article>',
        url: 'https://target.example/final',
        warning: '',
      },
    }))
    const result = await runtime({
      endpoint: 'https://reader.example/',
      engine: 'browser',
      responseMode: 'html',
      timeoutMs: 60_000,
      waitForSelector: 'main article',
      targetSelector: 'article',
      removeSelector: 'nav',
      includeIframes: true,
      includeShadowDom: true,
      noCache: true,
      respectRobots: true,
      retainImages: 'all',
      retainLinks: 'none',
      upstreamProxy: 'auto',
      locale: 'zh-CN',
      userAgent: 'Custom Reader UA',
    }, fake.fetch, 'jina-secret').fetch({ url: 'https://target.example/start?q=1' })

    expect(target.resolve).toHaveBeenCalledWith('https://target.example/start?q=1', expect.any(AbortSignal))
    expect(fake.captured).toHaveLength(1)
    const { input, init } = fake.captured[0]!
    expect(String(input)).toBe('https://reader.example/')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({
      accept: 'application/json',
      authorization: 'Bearer jina-secret',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'dsh-search-tools/0.1.9 (+https://github.com/ThzxxArt/dsh-search-tools)',
      'x-engine': 'browser',
      'x-respond-with': 'html',
      'x-timeout': '59',
      'x-wait-for-selector': 'main article',
      'x-target-selector': 'article',
      'x-remove-selector': 'nav',
      'x-with-iframe': 'true',
      'x-with-shadow-dom': 'true',
      'x-no-cache': 'true',
      'x-robots-txt': 'dsh-search-tools',
      'x-retain-images': 'all',
      'x-retain-links': 'none',
      'x-proxy': 'auto',
      'x-locale': 'zh-CN',
      'x-user-agent': 'Custom Reader UA',
    })
    expect(init?.body).toBe('url=https%3A%2F%2Ftarget.example%2Fstart%3Fq%3D1')
    expect(result).toMatchObject({
      url: 'https://target.example/final',
      statusCode: 200,
      body: { kind: 'html', content: '<article>rendered</article>' },
      truncated: false,
    })
  })

  it('reads data.text for the text response mode', async () => {
    const fake = capture(async () => response({
      data: { text: 'plain text body', url: 'https://target.example/final' },
    }))
    const result = await runtime({ responseMode: 'text' }, fake.fetch).fetch({ url: 'https://target.example/' })
    expect(result.body).toEqual({ kind: 'text', content: 'plain text body' })
    expect((fake.captured[0]!.init?.headers as Record<string, string>)['x-respond-with']).toBe('text')
  })

  it('omits authorization and auto-only headers when no key is configured', async () => {
    const fake = capture(async () => response({ data: { content: 'body', url: 'https://target.example/' } }))
    await runtime({}, fake.fetch).fetch({ url: 'https://target.example/' })
    const headers = fake.captured[0]!.init?.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
    expect(headers['x-engine']).toBeUndefined()
    expect(headers['x-proxy']).toBeUndefined()
    expect(headers['x-respond-with']).toBe('markdown')
    expect(headers['x-timeout']).toBe('24')
  })

  it('reads JINA_API_KEY from the environment when no credential service value exists', async () => {
    const fake = capture(async () => response({ data: { content: 'body', url: 'https://target.example/' } }))
    const ctx = context(fake.fetch)
    ctx.env.JINA_API_KEY = 'env-secret'
    const reader = new JinaReaderRuntime(ctx, () => normalizeJinaReaderConfig({}))
    await reader.fetch({ url: 'https://target.example/' })
    expect((fake.captured[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer env-secret')
  })
})

describe('Jina Reader response and failure mapping', () => {
  it('maps a target 404 warning to statusCode 404 without pretending the Reader failed', async () => {
    const fake = capture(async () => response({
      data: { content: 'not found', url: 'https://target.example/missing', warning: 'Target URL returned error 404: Not Found' },
    }))
    const result = await runtime({}, fake.fetch).fetch({ url: 'https://target.example/missing' })
    expect(result.statusCode).toBe(404)
    expect(result.body).toEqual({ kind: 'text', content: 'not found' })
  })

  it('ignores an out-of-range warning status instead of emitting an invalid HTTP status', async () => {
    const fake = capture(async () => response({
      data: { content: 'body', url: 'https://target.example/', warning: 'Target URL returned error 999' },
    }))
    const result = await runtime({}, fake.fetch).fetch({ url: 'https://target.example/' })
    expect(result.statusCode).toBe(200)
  })

  it('strips credentials from a Reader-returned URL', async () => {
    const fake = capture(async () => response({
      data: {
        content: 'body',
        url: 'https://reader-user:reader-pass@target.example/final?q=1',
      },
    }))
    const result = await runtime({}, fake.fetch).fetch({ url: 'https://target.example/' })
    expect(result.url).toBe('https://target.example/final?q=1')
  })

  it('prefers a target warning over a misleading statusCode compatibility field', async () => {
    const fake = capture(async () => response({
      data: {
        content: 'missing',
        url: 'https://target.example/missing',
        statusCode: 200,
        warning: 'Target URL returned error 404: Not Found',
      },
    }))
    const result = await runtime({}, fake.fetch).fetch({ url: 'https://target.example/missing' })
    expect(result.statusCode).toBe(404)
  })

  it('uses httpStatus for an HTML target error without a content companion', async () => {
    const fake = capture(async () => response({
      data: {
        html: '<h1>Missing</h1>',
        httpStatus: 404,
        httpStatusText: 'Not Found',
        url: 'https://target.example/missing',
      },
    }))
    const result = await runtime({ responseMode: 'html' }, fake.fetch)
      .fetch({ url: 'https://target.example/missing' })
    expect(result).toMatchObject({
      statusCode: 404,
      body: { kind: 'html', content: '<h1>Missing</h1>' },
    })
    expect((fake.captured[0]!.init?.headers as Record<string, string>)['x-respond-with'])
      .toBe('html')
  })

  it('accepts a numeric-string httpStatus from compatible Readers', async () => {
    const result = await runtime({}, async () => response({
      data: { content: 'missing', httpStatus: '404' },
    })).fetch({ url: 'https://target.example/' })
    expect(result.statusCode).toBe(404)
  })

  it('reads the official httpStatus fallback when warning is absent', async () => {
    const fake = capture(async () => response({
      data: {
        content: 'missing without warning',
        url: 'https://target.example/missing',
        httpStatus: 404,
        httpStatusText: 'Not Found',
      },
    }))
    const result = await runtime({}, fake.fetch).fetch({ url: 'https://target.example/missing' })
    expect(result).toMatchObject({
      statusCode: 404,
      body: { kind: 'text', content: 'missing without warning' },
    })
  })

  it('preserves target status for HTML/text errors even when the selected field is absent', async () => {
    const html = await runtime({ responseMode: 'html' }, async () => response({
      data: {
        content: 'reader content branch',
        warning: 'Target URL returned error 404: Not Found',
        url: 'https://target.example/missing',
      },
    })).fetch({ url: 'https://target.example/missing' })
    expect(html).toMatchObject({
      statusCode: 404,
      body: { kind: 'html', content: '' },
    })

    const text = await runtime({ responseMode: 'text' }, async () => response({
      data: {
        warning: 'Target URL returned error 500: Server Error',
        url: 'https://target.example/broken',
      },
    })).fetch({ url: 'https://target.example/broken' })
    expect(text).toMatchObject({
      statusCode: 500,
      body: { kind: 'text', content: '' },
    })
  })

  it('maps authentication, rate limit, and server failures to stable codes', async () => {
    await expect(runtime({}, async () => response({ code: 401, message: 'bad key' }, 401)).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_AUTH' })
    await expect(runtime({}, async () => response({ code: 403, message: 'forbidden' }, 403)).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_AUTH' })
    await expect(runtime({}, async () => response({ code: 429, message: 'slow down' }, 429, { 'retry-after': '2' })).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_RATE_LIMIT', retryAfterMs: 2_000 })
    const retryDate = new Date(Date.now() + 5_000).toUTCString()
    await expect(runtime({}, async () => response({ code: 429 }, 429, { 'retry-after': retryDate })).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_RATE_LIMIT', retryAfterMs: expect.any(Number) })
    await expect(runtime({}, async () => response({ code: 429 }, 429, { 'retry-after': '999999999' })).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_RATE_LIMIT', retryAfterMs: 3_600_000 })
    await expect(runtime({}, async () => response({ code: 429 }, 200, { 'retry-after': '2' })).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_RATE_LIMIT', retryAfterMs: 2_000 })
    await expect(runtime({}, async () => response({ message: 'boom' }, 503)).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_HTTP' })
  })

  it('maps transport failures to JINA_NETWORK', async () => {
    await expect(runtime({}, async () => { throw new Error('socket closed') }).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_NETWORK' })
  })

  it('clips content and reports truncation', async () => {
    const content = 'x'.repeat(2_000)
    const result = await runtime({ maxBodyChars: 1_024 }, async () => response({ data: { content, url: 'https://target.example/' } }))
      .fetch({ url: 'https://target.example/' })
    expect(result.body.kind).toBe('text')
    expect(result.body.content).toHaveLength(1_024)
    expect(result.truncated).toBe(true)
  })

  it('rejects an oversized Reader envelope before parsing it', async () => {
    const huge = JSON.stringify({ data: { content: 'x'.repeat(5_000), url: 'https://target.example/' } })
    await expect(runtime({ maxResponseBytes: 1_024 }, async () => new Response(huge, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })).fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: 'JINA_RESPONSE_TOO_LARGE' })
  })

  it('rejects an oversized declared content-length before reading the body', async () => {
    const fake = capture(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
    }))
    await expect(runtime({ maxResponseBytes: 1_024 }, fake.fetch).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_RESPONSE_TOO_LARGE' })
  })

  it('rejects malformed JSON, missing content, and an empty 2xx body', async () => {
    await expect(runtime({}, async () => response('not json')).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
    await expect(runtime({}, async () => response({ data: { url: 'https://target.example/' } })).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
    await expect(runtime({}, async () => response({ data: { content: '   ', url: 'https://target.example/' } }))
      .fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: 'JINA_EMPTY_BODY' })
    await expect(runtime({ responseMode: 'html' }, async () => response({ data: { content: 'wrong field', url: 'https://target.example/' } }))
      .fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
    await expect(runtime({ responseMode: 'text' }, async () => response({ data: { content: 'wrong field', url: 'https://target.example/' } }))
      .fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
  })

  it('does not call the Reader when the target guard rejects the URL', async () => {
    const fake = capture(async () => response({ data: { content: 'must not run', url: 'https://target.example/' } }))
    target.resolve.mockRejectedValueOnce(new SearchToolsError('blocked', 'JINA_TARGET_BLOCKED'))
    await expect(runtime({}, fake.fetch).fetch({ url: 'https://private.example/' }))
      .rejects.toMatchObject({ code: 'JINA_TARGET_BLOCKED' })
    expect(fake.captured).toHaveLength(0)
  })

  it('maps consumer abort and its own timeout', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('stop'))
    await expect(runtime({}, async () => response({ data: { content: 'body', url: 'https://target.example/' } }))
      .fetch({ url: 'https://target.example/' }, aborted.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })

    const fake = capture(async (_captured) => await new Promise<Response>((_resolve, reject) => {
      const signal = _captured.init?.signal
      signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    }))
    await expect(runtime({ timeoutMs: 2_000 }, fake.fetch).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_TIMEOUT' })
  })

  it('maps a timeout during target resolution without calling the Reader', async () => {
    target.resolve.mockImplementationOnce(async (_raw: string, signal?: AbortSignal) => await new Promise<URL>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    const fake = capture(async () => response({ data: { content: 'must not run', url: 'https://target.example/' } }))
    await expect(runtime({ timeoutMs: 2_000 }, fake.fetch).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_TIMEOUT' })
    expect(fake.captured).toHaveLength(0)
  })

  it('bounds a hanging credential lookup by the same request deadline', async () => {
    const fake = capture(async () => response({ data: { content: 'must not run', url: 'https://target.example/' } }))
    const ctx = context(fake.fetch)
    ctx.getCredentials = () => ({
      resolve: async () => await new Promise<never>(() => {}),
    })
    const reader = new JinaReaderRuntime(ctx, () => normalizeJinaReaderConfig({ timeoutMs: 2_000 }))
    await expect(reader.fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_TIMEOUT' })
    expect(fake.captured).toHaveLength(0)
  })
})

describe('Jina Reader probe', () => {
  it('uses the real fetch path and reports status, kind, and readable content', async () => {
    const fake = capture(async () => response({ data: { content: 'hello', url: 'https://target.example/' } }))
    const result = await runtime({}, fake.fetch).probe('https://target.example/')
    expect(result).toMatchObject({
      ok: true,
      latencyMs: 0,
      statusCode: 200,
      contentType: 'text',
      readable: true,
    })
    expect(result.message).toBeUndefined()
  })

  it('returns a coded failure instead of throwing from probe', async () => {
    const result = await runtime({}, async () => response({ code: 401, message: 'no key' }, 401)).probe('https://target.example/')
    expect(result).toMatchObject({ ok: false, code: 'JINA_PROBE_FAILED' })
    expect(result.message).toContain('JINA_AUTH')
  })
})

describe('Jina Reader research chain', () => {
  it('feeds a Jina text result through web_research clipping', async () => {
    const fake = capture(async () => response({
      data: {
        content: 'Jina research body. '.repeat(100),
        url: 'https://target.example/article',
      },
    }))
    const reader = new JinaReaderRuntime(context(fake.fetch), () => normalizeJinaReaderConfig({ maxBodyChars: 20_000 }))
    const { runResearch } = await import('../src/research/pipeline.ts')
    const { DEFAULT_RESEARCH_CONFIG, DEFAULT_STORED_CONFIG } = await import('../src/shared/defaults.ts')
    const stored = {
      ...DEFAULT_STORED_CONFIG,
      fetch: { adapter: 'jina-reader', adapters: { 'jina-reader': normalizeJinaReaderConfig({}) } },
      research: { ...DEFAULT_RESEARCH_CONFIG, maxCharsPerPage: 1_000, maxTotalChars: 2_000 },
    }
    const ctx = {
      web: {
        search: async () => ({
          sources: [{ url: 'https://target.example/article', title: 'Article' }],
          truncated: false,
        }),
        fetch: async (request: { url: string }, signal?: AbortSignal) => await reader.fetch(request, signal),
      },
      logger: { warn() {} },
    }
    const value = await runResearch(ctx as never, {
      search: { get: () => stored.search },
      fetch: { get: () => stored.fetch },
      research: { get: () => stored.research },
      activation: { get: () => stored.activation },
    } as never, { query: 'jina', fetch_top: 1, max_chars: 1_000 }, new AbortController().signal)
    expect(value.fetched[0]?.content).toContain('Jina research body')
    expect(value.fetched[0]?.content.length).toBeLessThanOrEqual(1_000)
    expect(value.fetched[0]?.error).toBeUndefined()
    expect(value.truncated).toBe(true)
  }, 60_000)
})

describe('Jina Reader engine value', () => {
  it('uses the documented curl value for the lightweight engine', async () => {
    const fake = capture(async () => response({ data: { content: 'body', url: 'https://target.example/' } }))
    await runtime({ engine: 'curl' }, fake.fetch).fetch({ url: 'https://target.example/' })
    expect((fake.captured[0]!.init?.headers as Record<string, string>)['x-engine']).toBe('curl')
  })
})
