import { describe, expect, it } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'
import type { WireWorkerResult } from '../src/fetch/adapters/wire-http/protocol.ts'
import { WireHttpRuntime } from '../src/fetch/adapters/wire-http/provider.ts'
import { normalizeWireHttpConfig } from '../src/fetch/adapters/wire-http/schema.ts'
import type { PublicAddressResolver } from '../src/shared/public-target.ts'

const resolver: PublicAddressResolver = async () => [{ address: '93.184.216.34', family: 4 }]

function context(): AdapterContext {
  return {
    logger: { debug() {}, warn() {}, error() {} },
    getCredentials: () => undefined,
    env: {},
    fetch: globalThis.fetch,
    now: () => 100,
  }
}

function workerResult(body: Uint8Array, options: Partial<WireWorkerResult> = {}): WireWorkerResult {
  return {
    url: 'https://public.example/article',
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body,
    ...options,
  }
}

function runtime(config: Record<string, unknown>, result: WireWorkerResult): WireHttpRuntime {
  return new WireHttpRuntime(context(), () => normalizeWireHttpConfig(config), {
    resolver,
    runWorker: async () => result,
  })
}

describe('wire-http textual and BOM branches', () => {
  it('accepts every documented textual content type', async () => {
    for (const contentType of [
      'application/json',
      'application/ld+json',
      'application/xml',
      'application/javascript',
      'application/problem+json',
      'application/atom+xml',
    ]) {
      const wire = runtime({ readability: false }, workerResult(new TextEncoder().encode('body'), {
        headers: { 'content-type': contentType },
      }))
      await expect(wire.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
        body: { kind: 'text', content: 'body' },
      })
    }
  })

  it('treats an absent content type as text unless the bytes look binary', async () => {
    const text = runtime({ readability: false }, workerResult(new TextEncoder().encode('plain'), {
      headers: {},
    }))
    await expect(text.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
      body: { kind: 'text', content: 'plain' },
    })

    const binary = runtime({ readability: false }, workerResult(new Uint8Array([0, 1, 2]), {
      headers: {},
    }))
    await expect(binary.fetch({ url: 'https://public.example/article' }))
      .rejects.toMatchObject({ code: 'WIRE_UNSUPPORTED_CONTENT' })
  })

  it('rejects an explicit binary content type', async () => {
    const wire = runtime({ readability: false }, workerResult(new TextEncoder().encode('abc'), {
      headers: { 'content-type': 'application/octet-stream' },
    }))
    await expect(wire.fetch({ url: 'https://public.example/article' }))
      .rejects.toMatchObject({ code: 'WIRE_UNSUPPORTED_CONTENT' })
  })

  it('decodes UTF-8 and UTF-16BE BOMs', async () => {
    const utf8 = runtime({ readability: false }, workerResult(new Uint8Array([
      0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hello'),
    ]), { headers: { 'content-type': 'text/plain' } }))
    await expect(utf8.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
      body: { content: 'hello' },
    })

    const utf16be = activityBytes('hi')
    const utf16 = runtime({ readability: false }, workerResult(new Uint8Array([
      0xfe, 0xff, ...utf16be,
    ]), { headers: { 'content-type': 'text/plain' } }))
    await expect(utf16.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
      body: { content: 'hi' },
    })
  })
})

describe('wire-http result normalization branches', () => {
  it('normalizes invalid statuses, unsafe URLs, and credentials in returned URLs', async () => {
    for (const [status, expected] of [[99, 502], [600, 502], [201, 201]] as const) {
      const wire = runtime({ readability: false }, workerResult(new TextEncoder().encode('ok'), { status }))
      await expect(wire.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
        statusCode: expected,
      })
    }

    const ftp = runtime({ readability: false }, workerResult(new TextEncoder().encode('ok'), {
      url: 'ftp://bad.example/',
    }))
    await expect(ftp.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
      url: 'https://public.example/article',
    })

    const credentials = runtime({ readability: false }, workerResult(new TextEncoder().encode('ok'), {
      url: 'https://user:pass@public.example/final',
    }))
    await expect(credentials.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
      url: 'https://public.example/final',
    })

    const invalid = runtime({ readability: false }, workerResult(new TextEncoder().encode('ok'), {
      url: 'http://[',
    }))
    await expect(invalid.fetch({ url: 'https://public.example/article' })).resolves.toMatchObject({
      url: 'https://public.example/article',
    })
  })

  it('clips text without splitting a surrogate pair', async () => {
    const wire = runtime({ readability: false, maxBodyChars: 1_024 }, workerResult(
      new TextEncoder().encode(`${'x'.repeat(1_023)}😀`),
      { headers: { 'content-type': 'text/plain' } },
    ))
    const fetched = await wire.fetch({ url: 'https://public.example/article' })
    expect(fetched.truncated).toBe(true)
    expect(fetched.body.content.length).toBe(1_023)
  })
})

function activityBytes(value: string): number[] {
  const bytes: number[] = []
  for (const char of value) {
    bytes.push(0, char.charCodeAt(0))
  }
  return bytes
}
