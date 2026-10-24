import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'
import type {
  LocalDirectWorkerRequest, LocalDirectWorkerResult,
} from '../src/search/adapters/local-direct/protocol.ts'
import { LocalDirectRuntime } from '../src/search/adapters/local-direct/provider.ts'
import { normalizeLocalDirectConfig } from '../src/search/adapters/local-direct/schema.ts'
import { SearchToolsError } from '../src/shared/errors.ts'

const ddg = readFileSync(new URL('./fixtures/local-direct-ddg.html', import.meta.url), 'utf8')
const bing = readFileSync(new URL('./fixtures/local-direct-bing.html', import.meta.url), 'utf8')
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

function target(engine: 'duckduckgo' | 'bing', html: string, failure?: string) {
  return failure === undefined
    ? {
        engine,
        ok: true,
        status: 200,
        url: `https://${engine === 'bing' ? 'www.bing.com' : 'html.duckduckgo.com'}/`,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: new TextEncoder().encode(html),
      }
    : { engine, ok: false, code: failure, message: 'engine failed' }
}

function runtimeWith(
  worker: (request: LocalDirectWorkerRequest) => Promise<LocalDirectWorkerResult>,
  config: Record<string, unknown> = {},
): LocalDirectRuntime {
  return new LocalDirectRuntime(context(), () => normalizeLocalDirectConfig({
    requestTimeoutMs: 1_000,
    deadlineMs: 5_000,
    retries: 0,
    minIntervalMs: 0,
    cacheTtlMs: 300_000,
    cacheMaxEntries: 10,
    ...config,
  }), {
    runWorker: async (request) => await worker(request),
  })
}

describe('local-direct runtime', () => {
  it('queries both fixed engines and fuses their results locally', async () => {
    let seen: LocalDirectWorkerRequest | undefined
    const runtime = runtimeWith(async (request) => {
      seen = request
      return { targets: [target('duckduckgo', ddg), target('bing', bing)] }
    })

    const result = await runtime.search({ query: 'deepseek', maxResults: 10 })
    expect(seen?.targets.map(item => item.engine)).toEqual(['duckduckgo', 'bing'])
    expect(seen?.targets.every(item => item.url.startsWith('https://'))).toBe(true)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.com/one?keep=1',
      'https://example.com/two',
      'https://example.org/two',
    ])
    expect(result.notes).toBeUndefined()
  })

  it('returns partial results with notes and never caches a partial response', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      return { targets: [target('duckduckgo', ddg), target('bing', '', 'LOCAL_DIRECT_TIMEOUT')] }
    })

    const first = await runtime.search({ query: 'partial' })
    expect(first.sources.length).toBeGreaterThan(0)
    expect(first.notes?.join(' ')).toContain('Bing')
    expect(first.notes?.join(' ')).toContain('engine failed')
    expect(runtime.cacheStats().size).toBe(0)

    await runtime.search({ query: 'partial' })
    expect(calls).toBe(2)
  })

  it('caches only a complete success and exposes hit/miss stats', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      return { targets: [target('duckduckgo', ddg), target('bing', bing)] }
    })

    await runtime.search({ query: 'cached' })
    await runtime.search({ query: 'cached' })
    expect(calls).toBe(1)
    expect(runtime.cacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })

    runtime.clearCache()
    expect(runtime.cacheStats()).toEqual({ size: 0, hits: 0, misses: 0 })
  })

  it('raises a stable all-failed error when every engine fails', async () => {
    const runtime = runtimeWith(async () => ({
      targets: [
        target('duckduckgo', '', 'LOCAL_DIRECT_TIMEOUT'),
        target('bing', '', 'LOCAL_DIRECT_HTTP'),
      ],
    }))
    await expect(runtime.search({ query: 'failed' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
    })
  })

  it('probes engines with a fixed query and does not write the cache', async () => {
    let query = ''
    const runtime = runtimeWith(async (request) => {
      query = new URL(request.targets[0]!.url).searchParams.get('q') ?? ''
      return { targets: [target('duckduckgo', ddg), target('bing', bing)] }
    })

    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.engines).toEqual(['DuckDuckGo', 'Bing'])
    expect(probe.html).toBe(true)
    expect(query).toBe('dsh-search-tools probe')
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('reports unavailable without an enabled engine', () => {
    const runtime = runtimeWith(async () => ({ targets: [] }), { enabled: false })
    expect(runtime.available()).toBe(false)
  })

  it('rejects an empty or oversized query before launching a worker', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      return { targets: [target('duckduckgo', ddg), target('bing', bing)] }
    })
    await expect(runtime.search({ query: '   ' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_QUERY_INVALID' })
    await expect(runtime.search({ query: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_QUERY_INVALID' })
    expect(calls).toBe(0)
  })

  it('honors the request cap and aborts a pending worker on caller cancellation', async () => {
    let calls = 0
    const runtime = runtimeWith(async (request) => {
      calls++
      expect(request.targets.every(target => target.url.includes('probe') === false)).toBe(true)
      return { targets: [target('duckduckgo', ddg), target('bing', bing)] }
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
    expect(calls).toBe(1)
  })

  it('maps the overall deadline even when the worker never replies', async () => {
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
    let round = 0
    const runtime = runtimeWith(async () => {
      round++
      await new Promise(resolve => setTimeout(resolve, 700))
      return {
        targets: [target('duckduckgo', ddg), target('bing', '', 'LOCAL_DIRECT_TIMEOUT')],
      }
    }, { deadlineMs: 1_000, retries: 1 })
    const result = await runtime.search({ query: 'partial deadline' })
    expect(round).toBe(1)
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.notes?.join(' ')).toContain('Bing')
  }, 4_000)

  it('does not retry a fatal native-runtime failure', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      throw new SearchToolsError('native runtime missing', 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE')
    }, { retries: 2 })
    await expect(runtime.search({ query: 'fatal' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE',
    })
    expect(calls).toBe(1)
  })

  it('honors an already-aborted caller even when the result is cached', async () => {
    const runtime = runtimeWith(async () => ({ targets: [target('duckduckgo', ddg), target('bing', bing)] }))
    await runtime.search({ query: 'cached abort' })
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(runtime.search({ query: 'cached abort' }, controller.signal)).rejects.toMatchObject({
      code: 'WEB_ABORTED',
    })
  })

  it('aborts while waiting for the engine gate instead of sleeping the full interval', async () => {
    const runtime = runtimeWith(async () => ({
      targets: [target('duckduckgo', ddg), target('bing', bing)],
    }), { minIntervalMs: 500, cacheTtlMs: 0 })
    await runtime.search({ query: 'gate-one' })
    const controller = new AbortController()
    const started = Date.now()
    const pending = runtime.search({ query: 'gate-two' }, controller.signal)
    setTimeout(() => { controller.abort(new Error('stop')) }, 20)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(Date.now() - started).toBeLessThan(300)
  })

  it('treats a filtered-empty engine response as success, not as engine failure', async () => {
    const runtime = runtimeWith(async () => ({
      targets: [target('duckduckgo', ddg), target('bing', bing)],
    }), { includeDomains: ['only-this.example'], retries: 1 })
    const result = await runtime.search({ query: 'filtered' })
    expect(result.sources).toEqual([])
    expect(result.notes?.join(' ')).toContain('domain filters')
    const probe = await runtime.probe()
    expect(probe.ok).toBe(true)
    expect(probe.engines).toEqual(['DuckDuckGo', 'Bing'])
    expect(runtime.cacheStats().size).toBe(0)
  })

  it('drops stale failure notes when a retry completes successfully', async () => {
    let round = 0
    const runtime = runtimeWith(async () => {
      round++
      return round === 1
        ? { targets: [target('duckduckgo', ddg), target('bing', '', 'LOCAL_DIRECT_TIMEOUT')] }
        : { targets: [target('bing', bing)] }
    }, { retries: 1 })
    const first = await runtime.search({ query: 'retry notes' })
    expect(first.notes).toBeUndefined()
    const second = await runtime.search({ query: 'retry notes' })
    expect(second.notes).toBeUndefined()
  })

  it('retries only the engines that failed in the previous round', async () => {
    const rounds: string[][] = []
    const runtime = runtimeWith(async (request) => {
      rounds.push(request.targets.map(item => item.engine))
      if (rounds.length === 1) {
        return { targets: [target('duckduckgo', ddg), target('bing', '', 'LOCAL_DIRECT_TIMEOUT')] }
      }
      return { targets: [target('bing', bing)] }
    }, { retries: 1 })
    const result = await runtime.search({ query: 'retry' })
    expect(rounds).toEqual([['duckduckgo', 'bing'], ['bing']])
    expect(result.sources.length).toBeGreaterThan(0)
  })

  it('does not treat a non-2xx, empty, or unparseable target as success', async () => {
    const runtime = runtimeWith(async () => ({
      targets: [
        {
          engine: 'duckduckgo',
          ok: true,
          status: 403,
          headers: { 'content-type': 'text/html' },
          body: new TextEncoder().encode('<html>blocked</html>'),
        },
        target('bing', ''),
      ],
    }))
    await expect(runtime.search({ query: 'blocked' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
    })
  })

  it('treats 202 and unparseable 200 pages as failures, not empty success', async () => {
    const captcha = new TextEncoder().encode('<html><body><h1>CAPTCHA</h1></body></html>')
    const runtime = runtimeWith(async () => ({
      targets: [
        {
          engine: 'duckduckgo',
          ok: true,
          status: 202,
          headers: { 'content-type': 'text/html' },
          body: captcha,
        },
        {
          engine: 'bing',
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: captcha,
        },
      ],
    }))
    await expect(runtime.search({ query: 'blocked' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
    })
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
      runWorker: async () => {
        calls++
        return { targets: [target('duckduckgo', ddg), target('bing', bing)] }
      },
    })
    await runtime.search({ query: 'expiry-a' })
    await runtime.search({ query: 'expiry-b' })
    await runtime.search({ query: 'expiry-a' })
    expect(calls).toBe(3)
    await new Promise(resolve => setTimeout(resolve, 30))
    await runtime.search({ query: 'expiry-a' })
    expect(calls).toBe(4)
    expect(runtime.cacheStats().size).toBe(1)
  }, 4_000)
})
