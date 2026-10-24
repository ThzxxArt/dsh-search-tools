import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'
import type {
  LocalDirectWorkerRequest, LocalDirectWorkerResult,
} from '../src/search/adapters/local-direct/protocol.ts'
import { LocalDirectRuntime } from '../src/search/adapters/local-direct/provider.ts'
import type { LocalDirectEngine } from '../src/search/adapters/local-direct/schema.ts'
import { normalizeLocalDirectConfig } from '../src/search/adapters/local-direct/schema.ts'
import { SearchToolsError } from '../src/shared/errors.ts'

const fixtures: Record<LocalDirectEngine, string> = {
  duckduckgo: readFileSync(new URL('./fixtures/local-direct-ddg.html', import.meta.url), 'utf8'),
  bing: readFileSync(new URL('./fixtures/local-direct-bing.html', import.meta.url), 'utf8'),
  brave: readFileSync(new URL('./fixtures/local-direct-brave.html', import.meta.url), 'utf8'),
  so360: readFileSync(new URL('./fixtures/local-direct-so360.html', import.meta.url), 'utf8'),
}

const origins: Record<LocalDirectEngine, string> = {
  duckduckgo: 'https://html.duckduckgo.com',
  bing: 'https://www.bing.com',
  brave: 'https://search.brave.com',
  so360: 'https://www.so.com',
}

const logger = { debug() {}, warn() {}, error() {} }

function context(now?: () => number): AdapterContext {
  return {
    logger,
    getCredentials: () => undefined,
    env: {},
    fetch: globalThis.fetch,
    now: now ?? (() => Date.now()),
  }
}

function target(engine: LocalDirectEngine, html: string, failure?: string) {
  return failure === undefined
    ? {
        engine,
        ok: true,
        status: 200,
        url: `${origins[engine]}/`,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: new TextEncoder().encode(html),
      }
    : { engine, ok: false, code: failure, message: 'engine failed' }
}

/** Production sends one target per worker; tests return only that engine. */
function responseFor(
  request: LocalDirectWorkerRequest,
  overrides: Partial<Record<LocalDirectEngine, string | { failure: string } | { status: number; body: string }>> = {},
): LocalDirectWorkerResult {
  const engine = request.targets[0]!.engine
  const override = overrides[engine]
  if (override !== undefined && typeof override === 'object' && 'failure' in override) {
    return { targets: [target(engine, '', override.failure)] }
  }
  if (override !== undefined && typeof override === 'object' && 'status' in override) {
    return {
      targets: [{
        engine,
        ok: true,
        status: override.status,
        headers: { 'content-type': 'text/html' },
        body: new TextEncoder().encode(override.body),
      }],
    }
  }
  return { targets: [target(engine, typeof override === 'string' ? override : fixtures[engine])] }
}

function runtimeWith(
  worker: (request: LocalDirectWorkerRequest) => Promise<LocalDirectWorkerResult>,
  config: Record<string, unknown> = {},
  now?: () => number,
): LocalDirectRuntime {
  return new LocalDirectRuntime(context(now), () => normalizeLocalDirectConfig({
    requestTimeoutMs: 1_000,
    deadlineMs: 5_000,
    retries: 0,
    minIntervalMs: 0,
    cacheTtlMs: 300_000,
    cacheMaxEntries: 10,
    ...config,
  }), {
    runWorker: async request => await worker(request),
  })
}

describe('local-direct runtime', () => {
  it('sends one worker per engine and fuses their results locally', async () => {
    const seen: string[][] = []
    const runtime = runtimeWith(async (request) => {
      seen.push(request.targets.map(item => item.engine))
      return responseFor(request)
    })

    const result = await runtime.search({ query: 'deepseek', maxResults: 10 })
    expect(seen.sort()).toEqual([['bing'], ['duckduckgo']])
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.com/one?keep=1',
      'https://example.com/two',
      'https://example.org/two',
    ])
    expect(result.notes).toBeUndefined()
  })

  it('uses Brave’s Firefox transport profile without changing the configured profile for other engines', async () => {
    const profiles: Record<string, string> = {}
    const runtime = runtimeWith(async (request) => {
      profiles[request.targets[0]!.engine] = request.profile
      return responseFor(request)
    }, { engines: ['duckduckgo', 'brave'] })
    await runtime.search({ query: 'profile' })
    expect(profiles).toEqual({ duckduckgo: 'chrome', brave: 'firefox' })
  })

  it('keeps a successful engine when another engine never settles', async () => {
    const runtime = runtimeWith(async (request) => {
      if (request.targets[0]!.engine === 'bing') return await new Promise<LocalDirectWorkerResult>(() => {})
      return responseFor(request)
    }, { engines: ['duckduckgo', 'bing'], deadlineMs: 1_000, retries: 0, cacheTtlMs: 0 })
    const started = Date.now()
    const result = await runtime.search({ query: 'slow bing' })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.notes?.join(' ')).toContain('Bing')
    expect(result.notes?.join(' ')).toContain('deadline')
  }, 4_000)

  it('returns partial results with notes and never caches a partial response', async () => {
    let calls = 0
    const runtime = runtimeWith(async (request) => {
      calls++
      return responseFor(request, { bing: { failure: 'LOCAL_DIRECT_TIMEOUT' } })
    })

    const first = await runtime.search({ query: 'partial' })
    expect(first.sources.length).toBeGreaterThan(0)
    expect(first.notes?.join(' ')).toContain('Bing')
    expect(first.notes?.join(' ')).toContain('engine failed')
    expect(runtime.cacheStats().size).toBe(0)

    await runtime.search({ query: 'partial' })
    expect(calls).toBe(4)
  })

  it('caches only a complete success and exposes hit/miss stats', async () => {
    let calls = 0
    const runtime = runtimeWith(async (request) => {
      calls++
      return responseFor(request)
    })

    await runtime.search({ query: 'cached' })
    await runtime.search({ query: 'cached' })
    expect(calls).toBe(2)
    expect(runtime.cacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })

    runtime.clearCache()
    expect(runtime.cacheStats()).toEqual({ size: 0, hits: 0, misses: 0 })
  })

  it('raises a stable all-failed error when every engine fails', async () => {
    const runtime = runtimeWith(async (request) => responseFor(request, {
      duckduckgo: { failure: 'LOCAL_DIRECT_TIMEOUT' },
      bing: { failure: 'LOCAL_DIRECT_HTTP' },
    }))
    await expect(runtime.search({ query: 'failed' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
    })
  })

  it('probes engines with a fixed query and does not write the cache', async () => {
    const queries: string[] = []
    const runtime = runtimeWith(async (request) => {
      queries.push(new URL(request.targets[0]!.url).searchParams.get('q') ?? '')
      return responseFor(request)
    })

    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.partial).toBe(false)
    expect(probe.engines).toEqual(['DuckDuckGo', 'Bing'])
    expect(probe.engineResults?.map(engine => engine.ok)).toEqual([true, true])
    expect(probe.html).toBe(true)
    expect(queries).toEqual(['dsh-search-tools probe', 'dsh-search-tools probe'])
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('reports partial probe state and failed engines explicitly', async () => {
    const runtime = runtimeWith(async (request) => responseFor(request, {
      bing: { failure: 'LOCAL_DIRECT_TIMEOUT' },
    }))
    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.partial).toBe(true)
    expect(probe.engines).toEqual(['DuckDuckGo'])
    expect(probe.failedEngines).toEqual(['Bing'])
    expect(probe.engineResults?.find(engine => engine.engine === 'Bing')).toMatchObject({
      ok: false,
      code: 'LOCAL_DIRECT_TIMEOUT',
    })
  })

  it('reports unavailable without an enabled engine', () => {
    const runtime = runtimeWith(async () => ({ targets: [] }), { enabled: false })
    expect(runtime.available()).toBe(false)
  })

  it('rejects an empty or oversized query before launching a worker', async () => {
    let calls = 0
    const runtime = runtimeWith(async (request) => {
      calls++
      return responseFor(request)
    })
    await expect(runtime.search({ query: '   ' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_QUERY_INVALID' })
    await expect(runtime.search({ query: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_QUERY_INVALID' })
    expect(calls).toBe(0)
  })

  it('honors the request cap and aborts pending workers on caller cancellation', async () => {
    let calls = 0
    const runtime = runtimeWith(async (request) => {
      calls++
      return responseFor(request)
    })
    const capped = await runtime.search({ query: 'cap', maxResults: 1 })
    expect(capped.sources).toHaveLength(1)
    expect(capped.truncated).toBe(true)

    const pending = new LocalDirectRuntime(context(), () => normalizeLocalDirectConfig({
      requestTimeoutMs: 1_000,
      deadlineMs: 5_000,
      retries: 0,
      minIntervalMs: 0,
      cacheTtlMs: 0,
    }), {
      runWorker: async (_request, options) => await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    })
    const controller = new AbortController()
    const search = pending.search({ query: 'abort' }, controller.signal)
    setTimeout(() => { controller.abort(new Error('stop')) }, 10)
    await expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(calls).toBe(2)
  })

  it('maps the overall deadline even when no worker replies', async () => {
    const runtime = new LocalDirectRuntime(context(), () => normalizeLocalDirectConfig({
      requestTimeoutMs: 1_000,
      deadlineMs: 1_000,
      retries: 0,
      minIntervalMs: 0,
      cacheTtlMs: 0,
    }), {
      runWorker: async (_request, options) => await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('deadline')), { once: true })
      }),
    })
    await expect(runtime.search({ query: 'deadline' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_DEADLINE' })
  }, 4_000)

  it('returns the successful engine when the deadline prevents a retry', async () => {
    const runtime = runtimeWith(async (request) => {
      if (request.targets[0]!.engine === 'bing') {
        return responseFor(request, { bing: { failure: 'LOCAL_DIRECT_TIMEOUT' } })
      }
      await new Promise(resolve => setTimeout(resolve, 700))
      return responseFor(request)
    }, { deadlineMs: 1_000, retries: 1 })
    const result = await runtime.search({ query: 'partial deadline' })
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.notes?.join(' ')).toContain('Bing')
  }, 4_000)

  it('does not retry a fatal native-runtime failure', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      throw new SearchToolsError('native runtime missing', 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE')
    }, { engines: ['duckduckgo'], retries: 2 })
    await expect(runtime.search({ query: 'fatal' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE',
    })
    expect(calls).toBe(1)
  })

  it('honors an already-aborted caller even when the result is cached', async () => {
    const runtime = runtimeWith(async (request) => responseFor(request))
    await runtime.search({ query: 'cached abort' })
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(runtime.search({ query: 'cached abort' }, controller.signal)).rejects.toMatchObject({
      code: 'WEB_ABORTED',
    })
  })

  it('aborts while waiting for an engine gate instead of sleeping the full interval', async () => {
    const runtime = runtimeWith(async (request) => responseFor(request), { minIntervalMs: 500, cacheTtlMs: 0 })
    await runtime.search({ query: 'gate-one' })
    const controller = new AbortController()
    const started = Date.now()
    const pending = runtime.search({ query: 'gate-two' }, controller.signal)
    setTimeout(() => { controller.abort(new Error('stop')) }, 20)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(Date.now() - started).toBeLessThan(300)
  })

  it('treats a filtered-empty engine response as success, not as engine failure', async () => {
    const runtime = runtimeWith(async (request) => responseFor(request), {
      includeDomains: ['only-this.example'], retries: 1,
    })
    const result = await runtime.search({ query: 'filtered' })
    expect(result.sources).toEqual([])
    expect(result.notes?.join(' ')).toContain('domain filters')
    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.engines).toEqual(['DuckDuckGo', 'Bing'])
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('treats an explicit engine no-results page as successful empty results', async () => {
    const noResults = '<div class="no-results">No results found</div>'
    const runtime = runtimeWith(async (request) => responseFor(request, { duckduckgo: noResults, bing: noResults }))
    const result = await runtime.search({ query: 'nothing' })
    expect(result.sources).toEqual([])
    expect(result.notes?.join(' ')).toContain('no results')
    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.engines).toEqual(['DuckDuckGo', 'Bing'])
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('drops stale failure notes when a retry completes successfully', async () => {
    let bingCalls = 0
    let duckCalls = 0
    const runtime = runtimeWith(async (request) => {
      if (request.targets[0]!.engine === 'duckduckgo') {
        duckCalls++
        return responseFor(request)
      }
      bingCalls++
      return bingCalls === 1
        ? responseFor(request, { bing: { failure: 'LOCAL_DIRECT_TIMEOUT' } })
        : responseFor(request)
    }, { retries: 1 })
    const first = await runtime.search({ query: 'retry notes' })
    expect(first.notes).toBeUndefined()
    expect(duckCalls).toBe(1)
    expect(bingCalls).toBe(2)
    const second = await runtime.search({ query: 'retry notes' })
    expect(second.notes).toBeUndefined()
    expect(duckCalls).toBe(1)
    expect(bingCalls).toBe(2)
  })

  it('retries only the engine that failed, never a successful engine', async () => {
    const calls: Record<string, number> = { duckduckgo: 0, bing: 0 }
    const runtime = runtimeWith(async (request) => {
      const engine = request.targets[0]!.engine
      calls[engine] = (calls[engine] ?? 0) + 1
      if (engine === 'bing' && calls.bing === 1) {
        return responseFor(request, { bing: { failure: 'LOCAL_DIRECT_TIMEOUT' } })
      }
      return responseFor(request)
    }, { retries: 1 })
    const result = await runtime.search({ query: 'retry' })
    expect(calls).toEqual({ duckduckgo: 1, bing: 2 })
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.notes).toBeUndefined()
  })

  it('honors Retry-After on a 429 before retrying the engine', async () => {
    let calls = 0
    const runtime = runtimeWith(async (request) => {
      calls++
      if (calls === 1) {
        return {
          targets: [{
            engine: request.targets[0]!.engine,
            ok: true,
            status: 429,
            headers: { 'content-type': 'text/html', 'retry-after': '0.05' },
            body: new TextEncoder().encode('slow down'),
          }],
        }
      }
      return responseFor(request)
    }, { engines: ['duckduckgo'], retries: 1 })
    const result = await runtime.search({ query: 'retry-after' })
    expect(result.sources.length).toBeGreaterThan(0)
    expect(calls).toBe(2)
  })

  it('does not treat a non-2xx, empty, or unparseable target as success', async () => {
    const runtime = runtimeWith(async (request) => {
      const engine = request.targets[0]!.engine
      return engine === 'duckduckgo'
        ? {
            targets: [{
              engine,
              ok: true,
              status: 403,
              headers: { 'content-type': 'text/html' },
              body: new TextEncoder().encode('<html>blocked</html>'),
            }],
          }
        : responseFor(request, { bing: '' })
    })
    await expect(runtime.search({ query: 'blocked' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
    })
  })

  it('treats 202 and unparseable 200 pages as failures, not empty success', async () => {
    const captcha = new TextEncoder().encode('<html><body><h1>CAPTCHA</h1></body></html>')
    const runtime = runtimeWith(async (request) => {
      const engine = request.targets[0]!.engine
      return {
        targets: [{
          engine,
          ok: true,
          status: engine === 'duckduckgo' ? 202 : 200,
          headers: { 'content-type': 'text/html' },
          body: captcha,
        }],
      }
    })
    await expect(runtime.search({ query: 'blocked' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
    })
  })

  it('queries 360 through its fixed descriptor', async () => {
    const seen: string[] = []
    const runtime = runtimeWith(async (request) => {
      seen.push(request.targets[0]!.url)
      return responseFor(request)
    }, { engines: ['so360'], maxPerHost: 3, maxResults: 20 })
    const result = await runtime.search({ query: 'deepseek harness' })
    expect(seen.map(url => new URL(url).origin)).toEqual(['https://www.so.com'])
    expect(result.sources.map(source => source.url).sort()).toEqual([
      'https://example.com/360-one',
      'https://example.org/360-two',
    ])
    expect(result.sources.some(source => source.url.includes('ads.example'))).toBe(false)
  })

  it('expires cache entries and evicts beyond cacheMaxEntries', async () => {
    let calls = 0
    const runtime = new LocalDirectRuntime(context(), () => normalizeLocalDirectConfig({
      requestTimeoutMs: 1_000,
      deadlineMs: 5_000,
      retries: 0,
      minIntervalMs: 0,
      cacheTtlMs: 15,
      cacheMaxEntries: 1,
    }), {
      runWorker: async (request) => {
        calls++
        return responseFor(request)
      },
    })
    await runtime.search({ query: 'expiry-a' })
    await runtime.search({ query: 'expiry-b' })
    await runtime.search({ query: 'expiry-a' })
    expect(calls).toBe(6)
    await new Promise(resolve => setTimeout(resolve, 30))
    await runtime.search({ query: 'expiry-a' })
    expect(calls).toBe(8)
    expect(runtime.cacheStats().size).toBe(1)
  }, 4_000)
})
