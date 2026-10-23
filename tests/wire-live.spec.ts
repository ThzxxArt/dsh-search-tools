import { describe, expect, it } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'
import { EgressGuard } from '../src/fetch/adapters/wire-http/egress-proxy.ts'
import { WireHttpRuntime } from '../src/fetch/adapters/wire-http/provider.ts'
import { normalizeWireHttpConfig } from '../src/fetch/adapters/wire-http/schema.ts'
import { runWireWorker } from '../src/fetch/adapters/wire-http/transport.ts'

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
})
