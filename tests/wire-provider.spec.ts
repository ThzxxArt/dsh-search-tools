import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'
import type { WireWorkerResult } from '../src/fetch/adapters/wire-http/protocol.ts'
import { WireHttpRuntime, type WireHttpRuntimeOptions } from '../src/fetch/adapters/wire-http/provider.ts'
import { normalizeWireHttpConfig } from '../src/fetch/adapters/wire-http/schema.ts'
import { SearchToolsError } from '../src/shared/errors.ts'
import type { PublicAddressResolver } from '../src/shared/public-target.ts'

const publicResolver: PublicAddressResolver = async () => [{ address: '93.184.216.34', family: 4 }]
const logger = { debug() {}, warn() {}, error() {} }

function context(): AdapterContext {
  return {
    logger,
    getCredentials: () => undefined,
    env: {},
    fetch: globalThis.fetch,
    now: () => 100,
  }
}

function result(body: string, options: Partial<WireWorkerResult> = {}): WireWorkerResult {
  return {
    url: 'https://public.example/article',
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: new TextEncoder().encode(body),
    ...options,
  }
}

function runtime(
  rawConfig: unknown,
  runWorker: WireHttpRuntimeOptions['runWorker'],
  extra: WireHttpRuntimeOptions = {},
): WireHttpRuntime {
  return new WireHttpRuntime(context(), () => normalizeWireHttpConfig(rawConfig), {
    resolver: publicResolver,
    ...(runWorker === undefined ? {} : { runWorker }),
    ...extra,
  })
}

describe('wire-http runtime', () => {
  it('passes a loopback proxy URL and returns a readable HTML result', async () => {
    const seen: string[] = []
    const html = `<html><body><article><h1>Wire</h1><p>${'A local article body. '.repeat(20)}</p></article></body></html>`
    const wire = runtime({}, async (request) => {
      seen.push(request.proxyUrl)
      return result(html)
    })
    const fetched = await wire.fetch({ url: 'https://public.example/article' })
    expect(seen[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(fetched.statusCode).toBe(200)
    expect(fetched.body.kind).toBe('html')
    expect(fetched.body.content).toContain('A local article body')
  })

  it('returns raw HTML when readability is disabled and clips decoded text', async () => {
    const wire = runtime({ readability: false, maxBodyChars: 1_024 }, async () => result('<html><body><p>raw</p></body></html>'))
    const fetched = await wire.fetch({ url: 'https://public.example/article' })
    expect(fetched.body.kind).toBe('html')
    expect(fetched.body.content).toContain('raw')

    const clipped = runtime({ readability: false, maxBodyChars: 2_000 }, async () => result('a'.repeat(3_000), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }))
    const text = await clipped.fetch({ url: 'https://public.example/article' })
    expect(text.body.content).toHaveLength(2_000)
    expect(text.truncated).toBe(true)
  })

  it('fails open or closed when readability cannot extract an article', async () => {
    const open = runtime({ minArticleChars: 500, failOpen: true }, async () => result('<html><body><p>too short</p></body></html>'))
    const openResult = await open.fetch({ url: 'https://public.example/article' })
    expect(openResult.body.content).toContain('too short')

    const closed = runtime({ minArticleChars: 500, failOpen: false }, async () => result('<html><body><p>too short</p></body></html>'))
    await expect(closed.fetch({ url: 'https://public.example/article' }))
      .rejects.toMatchObject({ code: 'WIRE_UNREADABLE' })
  })

  it('extracts PDF text locally and enforces the PDF switches', async () => {
    const extractPdf = vi.fn(async () => ({
      text: 'PDF text body',
      pagesRead: 1,
      totalPages: 2,
      truncated: true,
    }))
    const wire = runtime({}, async () => result('%PDF-1.4 fake', {
      headers: { 'content-type': 'application/pdf' },
    }), { extractPdf })
    const fetched = await wire.fetch({ url: 'https://public.example/file.pdf' })
    expect(fetched.body).toEqual({ kind: 'text', content: 'PDF text body' })
    expect(fetched.truncated).toBe(true)
    expect(extractPdf).toHaveBeenCalledOnce()

    const disabled = runtime({ pdf: false }, async () => result('%PDF-1.4 fake', {
      headers: { 'content-type': 'application/pdf' },
    }))
    await expect(disabled.fetch({ url: 'https://public.example/file.pdf' }))
      .rejects.toMatchObject({ code: 'WIRE_UNSUPPORTED_CONTENT' })

    const empty = runtime({}, async () => result('%PDF-1.4 fake', {
      headers: { 'content-type': 'application/pdf' },
    }), {
      extractPdf: async () => ({ text: '', pagesRead: 1, totalPages: 1, truncated: false }),
    })
    await expect(empty.fetch({ url: 'https://public.example/file.pdf' }))
      .rejects.toMatchObject({ code: 'WIRE_PDF_UNREADABLE' })

    const invalid = runtime({}, async () => result('%PDF-1.4 fake', {
      headers: { 'content-type': 'application/pdf' },
    }), { extractPdf: async () => { throw new Error('bad pdf') } })
    await expect(invalid.fetch({ url: 'https://public.example/file.pdf' }))
      .rejects.toMatchObject({ code: 'WIRE_PDF_INVALID' })
  })

  it('extracts a real PDF fixture through the provider', async () => {
    const bytes = new Uint8Array(await readFile(new URL('./fixtures/hello.pdf', import.meta.url)))
    const wire = runtime({}, async () => ({
      url: 'https://public.example/file.pdf',
      status: 200,
      headers: { 'content-type': 'application/pdf' },
      body: bytes,
    }))
    const fetched = await wire.fetch({ url: 'https://public.example/file.pdf' })
    expect(fetched.body.kind).toBe('text')
    expect(fetched.body.content).toContain('Hello PDF')
  })

  it('preserves HTTP 404 with an empty body and rejects empty 200 bodies', async () => {
    const notFound = runtime({}, async () => result('', { status: 404, headers: { 'content-type': 'text/html' } }))
    const fetched = await notFound.fetch({ url: 'https://public.example/missing' })
    expect(fetched.statusCode).toBe(404)
    expect(fetched.body.content).toBe('')

    const empty = runtime({}, async () => result('', { headers: { 'content-type': 'text/html' } }))
    await expect(empty.fetch({ url: 'https://public.example/empty' }))
      .rejects.toMatchObject({ code: 'WIRE_EMPTY_BODY' })
  })

  it('decodes UTF-16 BOMs and preserves charset labels', async () => {
    const utf16 = new Uint8Array(2 + 10)
    utf16[0] = 0xff
    utf16[1] = 0xfe
    for (const [index, code] of [...'hello'].entries()) utf16[2 + index * 2] = code.charCodeAt(0)
    const wire = runtime({ readability: false }, async () => ({
      url: 'https://public.example/text',
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: utf16,
    }))
    const fetched = await wire.fetch({ url: 'https://public.example/text' })
    expect(fetched.body.kind).toBe('text')
    expect(fetched.body.content).toBe('hello')
  })

  it('rejects URL fragments before starting the worker', async () => {
    const runWorker = vi.fn(async () => result('never'))
    const wire = runtime({}, runWorker)
    await expect(wire.fetch({ url: 'https://public.example/article#section' }))
      .rejects.toMatchObject({ code: 'WIRE_INVALID_TARGET' })
    expect(runWorker).not.toHaveBeenCalled()
  })

  it('rejects private targets before starting the worker and maps probe failures', async () => {
    const runWorker = vi.fn(async () => result('never'))
    const privateRuntime = new WireHttpRuntime(context(), () => normalizeWireHttpConfig({}), {
      resolver: async () => [{ address: '10.0.0.7', family: 4 }],
      runWorker,
    })
    await expect(privateRuntime.fetch({ url: 'https://private.example/' }))
      .rejects.toMatchObject({ code: 'WIRE_TARGET_BLOCKED' })
    expect(runWorker).not.toHaveBeenCalled()

    const probe = await privateRuntime.probe('https://private.example/')
    expect(probe.ok).toBe(false)
    expect(probe.code).toBe('WIRE_PROBE_FAILED')
    expect(probe.message).toContain('WIRE_TARGET_BLOCKED')
  })

  it('propagates redirect blocks and maps abort and timeout', async () => {
    const blocked = runtime({}, async () => {
      throw new SearchToolsError('redirect target was blocked', 'WIRE_REDIRECT_BLOCKED')
    })
    await expect(blocked.fetch({ url: 'https://public.example/' }))
      .rejects.toMatchObject({ code: 'WIRE_REDIRECT_BLOCKED' })

    const controller = new AbortController()
    const pending = runtime({}, async (_request, options) => await new Promise<WireWorkerResult>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }))
    const fetching = pending.fetch({ url: 'https://public.example/' }, controller.signal)
    setTimeout(() => { controller.abort(new Error('stop')) }, 20)
    await expect(fetching).rejects.toMatchObject({ code: 'WEB_ABORTED' })

    const timed = runtime({ timeoutMs: 1_000 }, async (_request, options) => await new Promise<WireWorkerResult>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { reject(new Error('timeout')) }, { once: true })
    }))
    await expect(timed.fetch({ url: 'https://public.example/' }))
      .rejects.toMatchObject({ code: 'WIRE_TIMEOUT' })
  }, 10_000)

  it('reports disabled availability', () => {
    expect(runtime({ enabled: false }, async () => result('x')).available()).toBe(false)
    expect(runtime({}, async () => result('x')).available()).toBe(true)
  })
})
