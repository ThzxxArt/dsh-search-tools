import { describe, expect, it } from 'vitest'
import type { LocalDirectWorkerRequest } from '../src/search/adapters/local-direct/protocol.ts'
import {
  LocalDirectWorkerFailureError, runLocalDirectRequest, type LocalDirectImpitModuleLike,
} from '../src/search/adapters/local-direct/worker-handler.ts'

const request: LocalDirectWorkerRequest = {
  targets: [
    { engine: 'duckduckgo', url: 'https://html.duckduckgo.com/html/?q=x' },
    { engine: 'bing', url: 'https://www.bing.com/search?q=x' },
  ],
  profile: 'chrome',
  timeoutMs: 8_000,
  maxResponseBytes: 1_000,
  proxyUrl: '',
  locale: 'en-US,en;q=0.9',
}

function responseOf(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const bytes = new TextEncoder().encode(body)
  return {
    status: init.status ?? 200,
    url: 'https://example.com/result',
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
  module: LocalDirectImpitModuleLike
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

describe('local-direct worker handler', () => {
  it('uses one Impit client, fixed requests, no redirects/cookies/auth, and bounded bodies', async () => {
    const fake = fakeImpit(async url => responseOf(url.includes('bing') ? '<li>bing</li>' : '<div>ddg</div>'))
    const result = await runLocalDirectRequest(request, { loadImpit: async () => fake.module })

    expect(fake.options[0]).toEqual({
      browser: 'chrome',
      timeout: 8_000,
      followRedirects: false,
      maxRedirects: 0,
      http3: false,
      ignoreTlsErrors: false,
      vanillaFallback: false,
    })
    expect(fake.requests).toHaveLength(2)
    expect(fake.requests[0]?.init).toEqual({
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
      timeout: 8_000,
    })
    expect(fake.requests[0]?.init).not.toHaveProperty('authorization')
    expect(fake.requests[0]?.init).not.toHaveProperty('cookie')
    expect(result.targets.map(target => target.engine)).toEqual(['duckduckgo', 'bing'])
    expect(result.targets.every(target => target.ok)).toBe(true)
    expect(new TextDecoder().decode(result.targets[0]?.body)).toBe('<div>ddg</div>')
  })

  it('passes an optional proxy and reports one engine failure without failing the other', async () => {
    const fake = fakeImpit(async (url) => {
      if (url.includes('duckduckgo')) throw Object.assign(new Error('slow'), { name: 'TimeoutError' })
      return responseOf('<li>bing</li>')
    })
    const result = await runLocalDirectRequest({ ...request, proxyUrl: 'http://127.0.0.1:7890' }, {
      loadImpit: async () => fake.module,
    })

    expect(fake.options[0]).toMatchObject({ proxyUrl: 'http://127.0.0.1:7890' })
    expect(result.targets[0]).toMatchObject({ engine: 'duckduckgo', ok: false, code: 'LOCAL_DIRECT_TIMEOUT' })
    expect(result.targets[1]).toMatchObject({ engine: 'bing', ok: true, status: 200 })
  })

  it('fails a target closed on a declared or streamed oversized body', async () => {
    const declared = fakeImpit(async () => responseOf('x', {
      headers: { 'content-type': 'text/html', 'content-length': '5000' },
    }))
    const result = await runLocalDirectRequest({ ...request, targets: [request.targets[0]!], maxResponseBytes: 100 }, {
      loadImpit: async () => declared.module,
    })
    expect(result.targets[0]).toMatchObject({ ok: false, code: 'LOCAL_DIRECT_RESPONSE_TOO_LARGE' })

    const streamed = fakeImpit(async () => responseOf('x'.repeat(200)))
    const large = await runLocalDirectRequest({ ...request, targets: [request.targets[0]!], maxResponseBytes: 100 }, {
      loadImpit: async () => streamed.module,
    })
    expect(large.targets[0]).toMatchObject({ ok: false, code: 'LOCAL_DIRECT_RESPONSE_TOO_LARGE' })
  })

  it('fails fatally when the native runtime is missing', async () => {
    await expect(runLocalDirectRequest(request, {
      loadImpit: async () => { throw new Error('native binding missing') },
    })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE' })
    expect(new LocalDirectWorkerFailureError('LOCAL_DIRECT_NETWORK', 'x')).toMatchObject({
      code: 'LOCAL_DIRECT_NETWORK',
    })
  })
})
