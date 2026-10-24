import { describe, expect, it } from 'vitest'
import type { LocalDirectWorkerRequest } from '../src/search/adapters/local-direct/protocol.ts'
import {
  failureOf as localFailureOf, runLocalDirectRequest, type LocalDirectImpitModuleLike,
} from '../src/search/adapters/local-direct/worker-handler.ts'
import type { WireWorkerRequest } from '../src/fetch/adapters/wire-http/protocol.ts'
import {
  failureOf as wireFailureOf, runWireRequest, type ImpitModuleLike,
} from '../src/fetch/adapters/wire-http/worker-handler.ts'

function responseOf(body: string | null, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  })
}

const localRequest: LocalDirectWorkerRequest = {
  targets: [{ engine: 'duckduckgo', url: 'https://html.duckduckgo.com/html/?q=x' }],
  profile: 'chrome',
  timeoutMs: 1_000,
  maxResponseBytes: 1_000,
  proxyUrl: '',
  locale: '',
}

const wireRequest: WireWorkerRequest = {
  url: 'https://public.example/article',
  profile: 'chrome',
  timeoutMs: 1_000,
  maxRedirects: 3,
  maxResponseBytes: 1_000,
  proxyUrl: '',
  locale: '',
}

function localModule(fetchImpl: () => Promise<Response>): LocalDirectImpitModuleLike {
  class Impit {
    async fetch() { return await fetchImpl() }
  }
  return { Impit }
}

function wireModule(fetchImpl: () => Promise<Response>): ImpitModuleLike {
  class Impit {
    async fetch() { return await fetchImpl() }
  }
  return { Impit }
}

describe('local-direct worker handler branches', () => {
  it('fails closed when the Impit constructor throws', async () => {
    class Failing {
      constructor() { throw new Error('constructor failed') }
    }
    await expect(runLocalDirectRequest(localRequest, {
      loadImpit: async () => ({ Impit: Failing as never }),
    })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE' })
  })

  it('omits accept-language for an empty locale and accepts a null body', async () => {
    const seen: Array<Record<string, string>> = []
    const result = await runLocalDirectRequest(localRequest, {
      loadImpit: async () => ({
        Impit: class {
          async fetch(_url: string, init?: { headers?: Record<string, string> }) {
            seen.push(init?.headers ?? {})
            return responseOf(null)
          }
        } as never,
      }),
    })
    expect(seen[0]).not.toHaveProperty('accept-language')
    expect(result.targets[0]).toMatchObject({ ok: true })
    expect(result.targets[0]?.body).toHaveLength(0)
  })

  it('classifies non-Error, unsupported protocol, and invalid content-length failures', async () => {
    const unknown = await runLocalDirectRequest(localRequest, {
      loadImpit: async () => localModule(async () => { throw 'boom' }),
    })
    expect(unknown.targets[0]).toMatchObject({ ok: false, code: 'LOCAL_DIRECT_NETWORK', message: 'engine request failed: boom' })

    const unsupported = await runLocalDirectRequest(localRequest, {
      loadImpit: async () => localModule(async () => {
        throw Object.assign(new Error('bad protocol'), { name: 'UnsupportedProtocol' })
      }),
    })
    expect(unsupported.targets[0]).toMatchObject({ code: 'LOCAL_DIRECT_INVALID_TARGET' })

    const invalidLength = await runLocalDirectRequest(localRequest, {
      loadImpit: async () => localModule(async () => responseOf('ok', 200, { 'content-length': 'bad' })),
    })
    expect(invalidLength.targets[0]).toMatchObject({ ok: true })
  })

  it('normalizes every structured failure shape', () => {
    expect(localFailureOf({ code: 'CUSTOM', message: 'message' })).toEqual({ code: 'CUSTOM', message: 'message' })
    expect(localFailureOf({ code: 'CUSTOM' })).toEqual({ code: 'CUSTOM', message: 'CUSTOM' })
    expect(localFailureOf({ code: 42, message: 'numeric' })).toEqual({
      code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE',
      message: '[object Object]',
    })
    expect(localFailureOf('plain')).toEqual({
      code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE',
      message: 'plain',
    })
  })
})

describe('wire worker handler branches', () => {
  it('fails closed when the Impit constructor throws', async () => {
    class Failing {
      constructor() { throw new Error('constructor failed') }
    }
    await expect(runWireRequest(wireRequest, {
      loadImpit: async () => ({ Impit: Failing as never }),
    })).rejects.toMatchObject({ code: 'WIRE_RUNTIME_UNAVAILABLE' })
  })

  it('omits accept-language for an empty locale and accepts a null body', async () => {
    const seen: Array<Record<string, string>> = []
    await runWireRequest(wireRequest, {
      loadImpit: async () => ({
        Impit: class {
          async fetch(_url: string, init?: { headers?: Record<string, string> }) {
            seen.push(init?.headers ?? {})
            return responseOf(null)
          }
        } as never,
      }),
    })
    expect(seen[0]).not.toHaveProperty('accept-language')
  })

  it('classifies non-Error failures and invalid content-length responses', async () => {
    await expect(runWireRequest(wireRequest, {
      loadImpit: async () => wireModule(async () => { throw 'boom' }),
    })).rejects.toMatchObject({ code: 'WIRE_NETWORK', message: 'wire-http request failed: boom' })

    await expect(runWireRequest(wireRequest, {
      loadImpit: async () => wireModule(async () => responseOf('ok', 200, { 'content-length': 'bad' })),
    })).resolves.toMatchObject({ status: 200 })
  })

  it('normalizes every structured failure shape', () => {
    expect(wireFailureOf({ code: 'CUSTOM', message: 'message' })).toEqual({ code: 'CUSTOM', message: 'message' })
    expect(wireFailureOf({ code: 'CUSTOM' })).toEqual({ code: 'CUSTOM', message: 'CUSTOM' })
    expect(wireFailureOf({ code: 42, message: 'numeric' })).toEqual({ code: 'WIRE_NETWORK', message: '[object Object]' })
    expect(wireFailureOf('plain')).toEqual({ code: 'WIRE_NETWORK', message: 'plain' })
  })
})
