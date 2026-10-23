import { describe, expect, it } from 'vitest'
import type { WireWorkerRequest } from '../src/fetch/adapters/wire-http/protocol.ts'
import {
  runWireRequest,
  WireWorkerFailureError,
  type ImpitModuleLike,
} from '../src/fetch/adapters/wire-http/worker-handler.ts'
import { runWireWorker } from '../src/fetch/adapters/wire-http/transport.ts'

const request: WireWorkerRequest = {
  url: 'https://public.example/article',
  profile: 'chrome',
  timeoutMs: 10_000,
  maxRedirects: 3,
  maxResponseBytes: 1_000,
  proxyUrl: 'http://127.0.0.1:43210',
  locale: 'zh-CN',
}

const fixtureWorker = new URL('./fixtures/wire-worker-fixture.mjs', import.meta.url)

function responseOf(body: string, init: { status?: number; headers?: Record<string, string>; url?: string } = {}) {
  const bytes = new TextEncoder().encode(body)
  return {
    status: init.status ?? 200,
    url: init.url ?? request.url,
    headers: new Headers(init.headers ?? { 'content-type': 'text/html; charset=utf-8' }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  }
}

function fakeImpit(fetchImpl: (url: string, init?: Record<string, unknown>) => Promise<ReturnType<typeof responseOf>>): {
  module: ImpitModuleLike
  options: Record<string, unknown>[]
  requests: Array<{ url: string; init: Record<string, unknown> | undefined }>
} {
  const options: Record<string, unknown>[] = []
  const requests: Array<{ url: string; init: Record<string, unknown> | undefined }> = []
  class FakeImpit {
    constructor(config: Record<string, unknown>) {
      options.push(config)
    }

    async fetch(url: string, init?: Record<string, unknown>) {
      requests.push({ url, init })
      return await fetchImpl(url, init)
    }
  }
  return { module: { Impit: FakeImpit }, options, requests }
}

describe('wire worker handler', () => {
  it('configures Impit with the proxy, browser profile, and no credentials', async () => {
    const fake = fakeImpit(async () => responseOf('<html><body><article>Hello</article></body></html>'))
    const result = await runWireRequest(request, { loadImpit: async () => fake.module })
    expect(fake.options[0]).toEqual({
      browser: 'chrome',
      proxyUrl: 'http://127.0.0.1:43210',
      timeout: 10_000,
      followRedirects: true,
      maxRedirects: 3,
      http3: false,
      ignoreTlsErrors: false,
      vanillaFallback: false,
    })
    expect(fake.requests[0]?.init).toEqual({
      method: 'GET',
      headers: { 'accept-language': 'zh-CN' },
      redirect: 'follow',
    })
    expect(fake.requests[0]?.init).not.toHaveProperty('authorization')
    expect(result.status).toBe(200)
    expect(new TextDecoder().decode(result.body)).toContain('Hello')
    expect(result.headers['content-type']).toContain('text/html')
  })

  it('maps timeout, redirect, proxy-block, invalid-target, and network errors', async () => {
    const timeout = fakeImpit(async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }) })
    await expect(runWireRequest(request, { loadImpit: async () => timeout.module }))
      .rejects.toMatchObject({ code: 'WIRE_TIMEOUT' })

    const redirect = fakeImpit(async () => { throw Object.assign(new Error('loop'), { name: 'TooManyRedirects' }) })
    await expect(runWireRequest(request, { loadImpit: async () => redirect.module }))
      .rejects.toMatchObject({ code: 'WIRE_REDIRECT_BLOCKED' })

    const blocked = fakeImpit(async () => {
      throw Object.assign(new Error('proxy blocked'), { name: 'ProxyTunnelError', status: 403 })
    })
    await expect(runWireRequest(request, { loadImpit: async () => blocked.module }))
      .rejects.toMatchObject({ code: 'WIRE_REDIRECT_BLOCKED' })

    const invalid = fakeImpit(async () => { throw Object.assign(new Error('bad url'), { name: 'InvalidURL' }) })
    await expect(runWireRequest(request, { loadImpit: async () => invalid.module }))
      .rejects.toMatchObject({ code: 'WIRE_INVALID_TARGET' })

    const network = fakeImpit(async () => { throw new Error('connection reset') })
    await expect(runWireRequest(request, { loadImpit: async () => network.module }))
      .rejects.toMatchObject({ code: 'WIRE_NETWORK' })
  })

  it('fails closed on missing runtime and oversized responses', async () => {
    await expect(runWireRequest(request, {
      loadImpit: async () => { throw new Error('native binding missing') },
    })).rejects.toMatchObject({ code: 'WIRE_RUNTIME_UNAVAILABLE' })

    const declared = fakeImpit(async () => responseOf('x', {
      headers: { 'content-type': 'text/plain', 'content-length': '5000' },
    }))
    await expect(runWireRequest({ ...request, maxResponseBytes: 100 }, { loadImpit: async () => declared.module }))
      .rejects.toMatchObject({ code: 'WIRE_RESPONSE_TOO_LARGE' })

    const streamed = fakeImpit(async () => responseOf('x'.repeat(200), { headers: { 'content-type': 'text/plain' } }))
    await expect(runWireRequest({ ...request, maxResponseBytes: 100 }, { loadImpit: async () => streamed.module }))
      .rejects.toMatchObject({ code: 'WIRE_RESPONSE_TOO_LARGE' })
  })

  it('exposes a structured failure for non-Wire errors', async () => {
    expect(new WireWorkerFailureError('WIRE_NETWORK', 'x')).toMatchObject({ code: 'WIRE_NETWORK' })
    const network = fakeImpit(async () => { throw new Error('boom') })
    try {
      await runWireRequest(request, { loadImpit: async () => network.module })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(WireWorkerFailureError)
      expect((error as WireWorkerFailureError).code).toBe('WIRE_NETWORK')
    }
  })
})

describe('one-request worker transport', () => {
  it('runs a fixture worker and always terminates it', async () => {
    const result = await runWireWorker(request, { timeoutMs: 2_000, workerFile: fixtureWorker })
    expect(result.status).toBe(200)
    expect(new TextDecoder().decode(result.body)).toBe('worker:http://127.0.0.1:43210')
  })

  it('maps an error reply to the stable code', async () => {
    await expect(runWireWorker({ ...request, url: 'https://public.example/error' }, {
      timeoutMs: 2_000,
      workerFile: fixtureWorker,
    })).rejects.toMatchObject({ code: 'WIRE_NETWORK', message: 'fixture failure' })
  })

  it('times out and aborts without leaving a worker running', async () => {
    await expect(runWireWorker({ ...request, url: 'https://public.example/never' }, {
      timeoutMs: 80,
      workerFile: fixtureWorker,
    })).rejects.toMatchObject({ code: 'WIRE_TIMEOUT' })

    const controller = new AbortController()
    const pending = runWireWorker({ ...request, url: 'https://public.example/never' }, {
      timeoutMs: 2_000,
      signal: controller.signal,
      workerFile: fixtureWorker,
    })
    setTimeout(() => { controller.abort(new Error('stop')) }, 20)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('rejects a missing worker file as an unavailable runtime', async () => {
    await expect(runWireWorker(request, {
      timeoutMs: 2_000,
      workerFile: new URL('./fixtures/missing-worker.mjs', import.meta.url),
    })).rejects.toMatchObject({ code: 'WIRE_RUNTIME_UNAVAILABLE' })
  })
})
