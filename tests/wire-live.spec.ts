import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import type { AdapterContext } from '../src/core/host-types.ts'
import { EgressGuard } from '../src/fetch/adapters/wire-http/egress-proxy.ts'
import { WireHttpRuntime } from '../src/fetch/adapters/wire-http/provider.ts'
import { normalizeWireHttpConfig } from '../src/fetch/adapters/wire-http/schema.ts'
import { runWireWorker } from '../src/fetch/adapters/wire-http/transport.ts'
import { runResearch } from '../src/research/pipeline.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

const live = process.env.WIRE_LIVE === '1'
const logger = { debug() {}, warn() {}, error() {} }

function context(): AdapterContext {
  return {
    logger,
    getCredentials: () => undefined,
    env: {},
    fetch: globalThis.fetch,
    now: () => Date.now(),
  }
}

describe.skipIf(!live)('wire-http real worker and egress guard', () => {
  it('fetches a public page through the real Impit native client', async () => {
    const guard = new EgressGuard()
    const proxyUrl = await guard.start()
    try {
      const result = await runWireWorker({
        url: 'https://example.com/',
        profile: 'chrome',
        timeoutMs: 25_000,
        maxRedirects: 5,
        maxResponseBytes: 2_000_000,
        proxyUrl,
        locale: 'en-US',
      }, {
        timeoutMs: 25_000,
        workerFile: new URL('../lib/wire-worker.js', import.meta.url),
      })
      expect(result.status).toBe(200)
      const text = new TextDecoder().decode(result.body)
      expect(text.toLowerCase()).toContain('example domain')
    } finally {
      await guard.close()
    }
  }, 40_000)

  it('fetches plain HTTP through the absolute-form guard path', async () => {
    const guard = new EgressGuard()
    const proxyUrl = await guard.start()
    try {
      const result = await runWireWorker({
        url: 'http://example.com/',
        profile: 'chrome',
        timeoutMs: 25_000,
        maxRedirects: 5,
        maxResponseBytes: 2_000_000,
        proxyUrl,
        locale: 'en-US',
      }, {
        timeoutMs: 25_000,
        workerFile: new URL('../lib/wire-worker.js', import.meta.url),
      })
      expect(result.status).toBe(200)
      expect(new TextDecoder().decode(result.body)).toContain('Example Domain')
    } finally {
      await guard.close()
    }
  }, 40_000)

  it('follows an HTTP to HTTPS redirect through the same guard', async () => {
    const guard = new EgressGuard()
    const proxyUrl = await guard.start()
    try {
      const result = await runWireWorker({
        url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F',
        profile: 'chrome',
        timeoutMs: 25_000,
        maxRedirects: 5,
        maxResponseBytes: 2_000_000,
        proxyUrl,
        locale: 'en-US',
      }, {
        timeoutMs: 25_000,
        workerFile: new URL('../lib/wire-worker.js', import.meta.url),
      })
      expect(result.status).toBe(200)
      expect(result.url.startsWith('https://example.com')).toBe(true)
    } finally {
      await guard.close()
    }
  }, 40_000)

  it('runs the full runtime with real Readability', async () => {
    const runtime = new WireHttpRuntime(context(), () => normalizeWireHttpConfig({
      timeoutMs: 25_000,
      minArticleChars: 20,
      maxArticleChars: 10_000,
    }), {
      workerFile: new URL('../lib/wire-worker.js', import.meta.url),
    })
    const result = await runtime.fetch({ url: 'https://example.com/' })
    expect(result.statusCode).toBe(200)
    expect(result.body.kind).toBe('html')
    expect(result.body.content.toLowerCase()).toContain('this domain')
    expect(result.body.content).toContain('data-dsh-readable="1"')
  }, 40_000)

  it('runs web_research through wire-http for three pages', async () => {
    const runtime = new WireHttpRuntime(context(), () => normalizeWireHttpConfig({
      timeoutMs: 25_000,
      minArticleChars: 20,
      maxArticleChars: 10_000,
    }), {
      workerFile: new URL('../lib/wire-worker.js', import.meta.url),
    })
    const sources = [
      { url: 'https://example.com/?wire-research=1', title: 'Wire One' },
      { url: 'https://example.com/?wire-research=2', title: 'Wire Two' },
      { url: 'https://example.com/?wire-research=3', title: 'Wire Three' },
    ]
    const ctx = {
      web: {
        search: async () => ({ sources, truncated: false }),
        fetch: async ({ url }: { url: string }) => await runtime.fetch({ url }),
      },
      logger: { warn() {}, debug() {}, error() {} },
    } as unknown as Context
    const stored: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      fetch: { ...DEFAULT_STORED_CONFIG.fetch, adapter: 'wire-http' },
      research: {
        ...DEFAULT_STORED_CONFIG.research,
        maxCharsPerPage: 2_000,
        maxTotalChars: 6_000,
      },
    }
    const config = {
      search: { get: () => stored.search },
      fetch: { get: () => stored.fetch },
      research: { get: () => stored.research },
      activation: { get: () => stored.activation },
    } as unknown as Config

    const result = await runResearch(ctx, config, {
      query: 'wire research',
      fetch_top: 3,
      max_chars: 2_000,
    }, new AbortController().signal)

    expect(result.fetched).toHaveLength(3)
    expect(result.fetched.every(page => page.error === undefined)).toBe(true)
    expect(result.fetched.every(page => page.content.length > 0)).toBe(true)
    expect(result.sources).toHaveLength(3)
  }, 90_000)
})
