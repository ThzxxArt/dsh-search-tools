import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-web-fetch-http', () => ({
  HttpFetchProvider: class {
    async fetch() {
      return {
        url: 'https://example.com/',
        statusCode: 200,
        body: { kind: 'text' as const, content: 'ok' },
        truncated: false,
      }
    }
  },
}))

import { FetchDispatcher } from '../src/core/dispatchers.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import type { FetchAdapter } from '../src/core/host-types.ts'
import type { SearchToolsService } from '../src/core/service.ts'
import type { Config } from '../src/config.ts'
import { readableHttpAdapter } from '../src/fetch/adapters/readable-http/adapter.ts'
import { DEFAULT_ACTIVATION_CONFIG, DEFAULT_RESEARCH_CONFIG } from '../src/shared/defaults.ts'

function configOf(): Config {
  return {
    search: { get: () => ({ adapter: 'searxng', adapters: {} }) },
    fetch: { get: () => ({ adapter: 'readable-http', adapters: { 'readable-http': {} } }) },
    research: { get: () => DEFAULT_RESEARCH_CONFIG },
    activation: { get: () => DEFAULT_ACTIVATION_CONFIG },
  } as unknown as Config
}

function contextOf(): Context {
  return {
    logger: { debug() {}, warn() {}, error() {} },
    get: () => undefined,
  } as unknown as Context
}

describe('readable-http probe', () => {
  it('exposes a real adapter probe instead of FETCH_PROBE_UNSUPPORTED', async () => {
    const adapters = {
      getFetchAdapter: (id: string) => id === 'readable-http' ? readableHttpAdapter : undefined,
    } as unknown as SearchToolsService
    const dispatcher = new FetchDispatcher(contextOf(), configOf(), adapters, new Diagnostics())

    const result = await dispatcher.probe('readable-http', {}, 'https://example.com/', AbortSignal.timeout(2_000))
    expect(result.ok).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.contentType).toBe('text')
    expect(result.readable).toBe(true)
    expect(result.code).not.toBe('FETCH_PROBE_UNSUPPORTED')
  })

  it('keeps the manifest capability and implementation in sync', async () => {
    expect(readableHttpAdapter.manifest.capabilities).toContain('probe')
    expect(typeof (readableHttpAdapter as FetchAdapter).probe).toBe('function')
    const adapterCtx = {
      logger: { debug() {}, warn() {}, error() {} },
      getCredentials: () => undefined,
      env: {},
      fetch: globalThis.fetch,
      now: () => Date.now(),
    }
    const result = await readableHttpAdapter.probe?.(
      adapterCtx,
      { readability: false },
      'https://example.com/',
      AbortSignal.timeout(2_000),
    )
    expect(result?.ok).toBe(true)
  })
})
