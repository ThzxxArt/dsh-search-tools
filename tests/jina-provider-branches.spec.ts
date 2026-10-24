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

function context(fetchImpl: AdapterContext['fetch'], env: Record<string, string | undefined> = {}): AdapterContext {
  return {
    logger: { debug() {}, warn() {}, error() {} },
    getCredentials: () => undefined,
    env,
    fetch: fetchImpl,
    now: () => 100,
  }
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' || body === null ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function capture(): { fetch: AdapterContext['fetch']; calls: Array<{ input: string | URL | Request; init: RequestInit | undefined }> } {
  const calls: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = []
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ input, init })
      return response({ data: { content: 'ok', url: 'https://target.example/' } })
    },
  }
}

function runtime(config: unknown, fetchImpl: AdapterContext['fetch'], env: Record<string, string | undefined> = {}): JinaReaderRuntime {
  return new JinaReaderRuntime(context(fetchImpl, env), () => normalizeJinaReaderConfig(config))
}

beforeEach(() => {
  target.resolve.mockReset()
  target.resolve.mockImplementation(async (raw: string) => new URL(raw))
})

describe('Jina provider edge branches', () => {
  it('rejects disabled and oversized targets before fetching', async () => {
    const fake = capture()
    await expect(runtime({ enabled: false }, fake.fetch).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_DISABLED' })
    await expect(runtime({}, fake.fetch).fetch({ url: `https://target.example/${'x'.repeat(2_048)}` }))
      .rejects.toMatchObject({ code: 'JINA_INVALID_TARGET' })
    expect(fake.calls).toHaveLength(0)
  })

  it('maps auth, rate-limit, and HTTP payload codes', async () => {
    for (const [code, expected] of [[401, 'JINA_AUTH'], [403, 'JINA_AUTH'], [429, 'JINA_RATE_LIMIT'], [400, 'JINA_HTTP']] as const) {
      const reader = runtime({}, async () => response({ code }, 200))
      await expect(reader.fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: expected })
    }

    const retry = runtime({}, async () => response({ code: 429 }, 200, { 'retry-after': '3' }))
    try {
      await retry.fetch({ url: 'https://target.example/' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toMatchObject({ code: 'JINA_RATE_LIMIT', retryAfterMs: 3_000 })
    }
  })

  it('rejects invalid JSON, non-object payloads, and missing data fields', async () => {
    await expect(runtime({}, async () => response('{not-json')).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
    await expect(runtime({}, async () => response([])).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
    await expect(runtime({}, async () => response({ data: { url: 'https://target.example/' } }))
      .fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: 'JINA_BAD_RESPONSE' })
  })

  it('uses warning/httpStatus target status and preserves the selected mode', async () => {
    const warning = runtime({}, async () => response({
      data: { warning: 'Target URL returned error 404', content: '' },
    }))
    await expect(warning.fetch({ url: 'https://target.example/' })).resolves.toMatchObject({
      statusCode: 404,
      body: { kind: 'text', content: '' },
    })

    const noMatch = runtime({}, async () => response({
      data: { warning: 'Target URL returned an error', httpStatus: '503' },
    }))
    await expect(noMatch.fetch({ url: 'https://target.example/' })).resolves.toMatchObject({ statusCode: 503 })

    const html = runtime({ responseMode: 'html' }, async () => response({
      data: { html: '<article>content</article>', url: 'ftp://bad.example/' },
    }))
    await expect(html.fetch({ url: 'https://target.example/' })).resolves.toMatchObject({
      url: 'https://target.example/',
      body: { kind: 'html', content: '<article>content</article>' },
    })
  })

  it('rejects empty 2xx bodies and preserves empty non-2xx bodies', async () => {
    await expect(runtime({}, async () => response({ data: { content: '' } }))
      .fetch({ url: 'https://target.example/' })).rejects.toMatchObject({ code: 'JINA_EMPTY_BODY' })
    await expect(runtime({}, async () => response({ data: { httpStatus: 502 } }))
      .fetch({ url: 'https://target.example/' }))
      .resolves.toMatchObject({ statusCode: 502, body: { content: '' } })
  })

  it('maps 429 without Retry-After and 500 without a body', async () => {
    await expect(runtime({}, async () => response('', 429)).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_RATE_LIMIT' })
    await expect(runtime({}, async () => response('', 500)).fetch({ url: 'https://target.example/' }))
      .rejects.toMatchObject({ code: 'JINA_HTTP' })
  })

  it('clips long HTML at a tag boundary and long text without splitting a surrogate', async () => {
    const htmlBody = `<p>hello</p><p>${'x'.repeat(2_000)}</p>`
    const html = runtime({ responseMode: 'html', maxBodyChars: 1_024 }, async () => response({
      data: { html: htmlBody },
    }))
    const htmlResult = await html.fetch({ url: 'https://target.example/' })
    expect(htmlResult.truncated).toBe(true)
    expect(htmlResult.body.content.length).toBeLessThanOrEqual(1_024)
    expect(htmlResult.body.content.endsWith('>')).toBe(true)

    const text = runtime({ maxBodyChars: 1_024 }, async () => response({
      data: { content: `${'x'.repeat(1_023)}😀` },
    }))
    const textResult = await text.fetch({ url: 'https://target.example/' })
    expect(textResult.truncated).toBe(true)
    expect(textResult.body.content.length).toBe(1_023)
  })

  it('passes all optional headers and the environment API key', async () => {
    const fake = capture()
    fake.fetch = async (input, init) => {
      fake.calls.push({ input, init })
      return response({ data: { html: 'ok', url: 'https://target.example/' } })
    }
    const reader = new JinaReaderRuntime(context(fake.fetch, { JINA_API_KEY: 'env-key' }), () => normalizeJinaReaderConfig({
      endpoint: 'https://reader.example/',
      engine: 'browser',
      responseMode: 'html',
      waitForSelector: 'main',
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
      userAgent: 'agent',
    }))
    await reader.fetch({ url: 'https://target.example/' })
    expect(fake.calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer env-key',
      'x-engine': 'browser',
      'x-wait-for-selector': 'main',
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
      'x-user-agent': 'agent',
    })
  })

  it('reports non-2xx probes instead of throwing', async () => {
    const probe = await runtime({}, async () => response({ data: { content: '' } }, 500))
      .probe('https://target.example/')
    expect(probe).toMatchObject({ ok: false, message: expect.stringContaining('JINA_HTTP') })
  })
})
