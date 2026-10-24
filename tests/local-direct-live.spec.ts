import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import type { AdapterContext } from '../src/core/host-types.ts'
import { LocalDirectRuntime } from '../src/search/adapters/local-direct/provider.ts'
import { runLocalDirectWorker } from '../src/search/adapters/local-direct/transport.ts'
import { runResearch } from '../src/research/pipeline.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

const live = process.env.SEARCH_LIVE === '1'
const logger = { debug() {}, warn() {}, error() {} }
const workerFile = new URL('../lib/local-direct-worker.js', import.meta.url)

function context(): AdapterContext {
  return {
    logger,
    getCredentials: () => undefined,
    env: {},
    fetch: globalThis.fetch,
    now: () => Date.now(),
  }
}

describe.skipIf(!live)('local-direct real engines', () => {
  it('loads the real Impit worker and queries both fixed engines', async () => {
    const result = await runLocalDirectWorker({
      targets: [
        { engine: 'duckduckgo', url: 'https://html.duckduckgo.com/html/?q=deepseek+harness&kl=us-en&kp=-1' },
        { engine: 'bing', url: 'https://www.bing.com/search?q=deepseek+harness&setlang=en&cc=US&adlt=moderate' },
      ],
      profile: 'chrome',
      timeoutMs: 15_000,
      maxResponseBytes: 3_000_000,
      proxyUrl: '',
      locale: 'en-US,en;q=0.9',
    }, { timeoutMs: 20_000, workerFile })

    expect(result.targets).toHaveLength(2)
    expect(result.targets.every(target => target.ok === true)).toBe(true)
    expect(result.targets.every(target => (target.status ?? 0) === 200)).toBe(true)
    expect(result.targets.every(target => (target.body?.byteLength ?? 0) > 1_000)).toBe(true)
  }, 30_000)

  it('returns local fused sources and a reachable-engine probe', async () => {
    const runtime = new LocalDirectRuntime(context(), () => ({
      profile: 'chrome',
      requestTimeoutMs: 15_000,
      deadlineMs: 25_000,
      retries: 0,
      minIntervalMs: 0,
      cacheTtlMs: 0,
      maxResults: 5,
    }), { workerFile })

    const result = await runtime.search({ query: 'deepseek harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.sources.every(source => source.url.startsWith('http'))).toBe(true)

    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.engines?.length).toBeGreaterThan(0)
  }, 40_000)

  it('feeds local search results into web_research for three pages', async () => {
    const runtime = new LocalDirectRuntime(context(), () => ({
      profile: 'chrome',
      requestTimeoutMs: 15_000,
      deadlineMs: 25_000,
      retries: 0,
      minIntervalMs: 0,
      cacheTtlMs: 0,
      maxResults: 3,
    }), { workerFile })
    const ctx = {
      web: {
        search: async (request: { query: string; maxResults?: number }) => await runtime.search(request),
        fetch: async ({ url }: { url: string }) => ({
          url,
          statusCode: 200,
          body: { kind: 'text' as const, content: `Local research page for ${url}. ${'content '.repeat(80)}` },
          truncated: false,
        }),
      },
      logger,
    } as unknown as Context
    const stored: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      search: { ...DEFAULT_STORED_CONFIG.search, adapter: 'local-direct' },
      research: {
        ...DEFAULT_STORED_CONFIG.research,
        maxResults: 3,
        maxFetch: 3,
        defaultFetchTop: 3,
        maxCharsPerPage: 1_000,
        maxTotalChars: 3_000,
      },
    }
    const config = {
      search: { get: () => stored.search },
      fetch: { get: () => stored.fetch },
      research: { get: () => stored.research },
      activation: { get: () => stored.activation },
    } as unknown as Config

    const value = await runResearch(ctx, config, { query: 'deepseek harness', fetch_top: 3 }, new AbortController().signal)
    expect(value.sources.length).toBeGreaterThan(0)
    expect(value.fetched).toHaveLength(Math.min(3, value.sources.length))
    expect(value.fetched.some(page => page.content.length > 0)).toBe(true)
  }, 60_000)
})
