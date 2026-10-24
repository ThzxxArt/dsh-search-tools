import { describe, expect, it } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'
import type { LocalDirectWorkerRequest, LocalDirectWorkerResult } from '../src/search/adapters/local-direct/protocol.ts'
import { LocalDirectRuntime } from '../src/search/adapters/local-direct/provider.ts'
import type { LocalDirectEngine } from '../src/search/adapters/local-direct/schema.ts'
import { normalizeLocalDirectConfig } from '../src/search/adapters/local-direct/schema.ts'
import { SearchToolsError } from '../src/shared/errors.ts'

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

const HTML: Record<LocalDirectEngine, string> = {
  duckduckgo: '<div class="result"><h2><a class="result__a" href="https://example.com/ddg">DDG</a></h2><div class="result__snippet">snippet</div></div>',
  bing: '<li class="b_algo"><h2><a href="https://example.com/bing">Bing</a></h2><div class="b_caption"><p>snippet</p></div></li>',
  brave: '<div class="snippet" data-type="web"><a href="https://example.com/brave"><div class="title">Brave</div></a><div class="description">snippet</div></div>',
  so360: '<li class="res-list" data-result-type="normal"><div class="res-title"><a data-mdurl="https://example.com/360">360</a></div></li>',
}

function target(engine: LocalDirectEngine, overrides: Record<string, unknown> = {}) {
  return {
    engine,
    ok: true,
    status: 200,
    url: `https://${engine}.example/`,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: new TextEncoder().encode(HTML[engine]),
    ...overrides,
  }
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
    cacheTtlMs: 0,
    engines: ['duckduckgo'],
    ...config,
  }), { runWorker: worker })
}

function resultFor(targetValue: unknown): LocalDirectWorkerResult {
  return { targets: [targetValue as never] }
}

describe('local-direct provider edge branches', () => {
  it('validates availability, disabled state, no engines, and numeric limits', async () => {
    const disabled = runtimeWith(async () => ({ targets: [target('duckduckgo')] }), { enabled: false })
    expect(disabled.available()).toBe(false)
    await expect(disabled.search({ query: 'q' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_DISABLED' })

    const noEngines = runtimeWith(async () => ({ targets: [target('duckduckgo')] }), { engines: [] })
    expect(noEngines.available()).toBe(false)
    await expect(noEngines.search({ query: 'q' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_NOT_CONFIGURED' })

    const runtime = runtimeWith(async request => resultFor(target(request.targets[0]!.engine)))
    expect(runtime.available()).toBe(true)
    await expect(runtime.search({ query: 'q', maxResults: Number.NaN })).resolves.toMatchObject({ sources: expect.any(Array) })
    await expect(runtime.search({ query: 'q', maxResults: 0 })).resolves.toMatchObject({ sources: expect.any(Array) })
    await expect(runtime.search({ query: 'q', maxResults: 9_999 })).resolves.toMatchObject({ sources: expect.any(Array) })
  })

  it('reports a probe failure and probes without writing the cache', async () => {
    const failing = runtimeWith(async () => { throw new SearchToolsError('probe worker failed', 'LOCAL_DIRECT_PROBE_FAILED') })
    const probe = await failing.probe()
    expect(probe).toMatchObject({ ok: false, code: 'LOCAL_DIRECT_ALL_FAILED', message: 'all local-direct engines failed: probe worker failed' })
    expect(failing.cacheStats().size).toBe(0)

    const disabled = runtimeWith(async () => ({ targets: [] }), { enabled: false })
    expect(await disabled.probe()).toMatchObject({ ok: false, code: 'LOCAL_DIRECT_DISABLED' })
  })

  it('maps missing, failed, and malformed worker targets to failures', async () => {
    const missing = runtimeWith(async () => ({ targets: [] }))
    await expect(missing.search({ query: 'missing' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_INVALID_TARGET' })

    for (const workerTarget of [
      { engine: 'duckduckgo', ok: false },
      { engine: 'duckduckgo', ok: false, code: 'CUSTOM_CODE', message: 'custom' },
      target('duckduckgo', { status: undefined }),
      target('duckduckgo', { status: '200' }),
      target('duckduckgo', { status: 199 }),
      target('duckduckgo', { status: 300 }),
      target('duckduckgo', { status: 204 }),
      target('duckduckgo', { status: 429, headers: {} }),
      target('duckduckgo', { body: new Uint8Array(0) }),
      target('duckduckgo', { body: new TextEncoder().encode('not a results page') }),
    ]) {
      const runtime = runtimeWith(async () => resultFor(workerTarget))
      await expect(runtime.search({ query: 'target' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_ALL_FAILED' })
    }
  })

  it('accepts 429 retry-after seconds and HTTP dates before retrying', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      if (calls === 1) {
        return resultFor(target('duckduckgo', {
          status: 429,
          headers: { 'retry-after': new Date(Date.now() + 50).toUTCString() },
        }))
      }
      return resultFor(target('duckduckgo'))
    }, { retries: 1 })
    await expect(runtime.search({ query: 'date-retry' })).resolves.toMatchObject({ sources: expect.any(Array) })
    expect(calls).toBe(2)
  })

  it('falls back to exponential delay for invalid Retry-After values', async () => {
    for (const retryAfter of ['later', '-1']) {
      let calls = 0
      const runtime = runtimeWith(async () => {
        calls++
        if (calls === 1) {
          return resultFor(target('duckduckgo', {
            status: 429,
            headers: { 'retry-after': retryAfter },
          }))
        }
        return resultFor(target('duckduckgo'))
      }, { retries: 1 })
      await expect(runtime.search({ query: `invalid-${retryAfter}` })).resolves.toMatchObject({ sources: expect.any(Array) })
      expect(calls).toBe(2)
    }
  })

  it('decodes unknown charsets and quoted charsets with a UTF-8 fallback', async () => {
    const unknown = runtimeWith(async () => resultFor(target('duckduckgo', {
      headers: { 'content-type': 'text/html; charset=not-a-charset' },
    })))
    await expect(unknown.search({ query: 'charset' })).resolves.toMatchObject({ sources: expect.any(Array) })

    const quoted = runtimeWith(async () => resultFor(target('duckduckgo', {
      headers: { 'content-type': 'text/html; charset="utf-8"' },
    })))
    await expect(quoted.search({ query: 'quoted' })).resolves.toMatchObject({ sources: expect.any(Array) })
  })

  it('treats fatal invalid-target worker failures as non-retryable', async () => {
    let calls = 0
    const runtime = runtimeWith(async () => {
      calls++
      throw new SearchToolsError('bad target', 'LOCAL_DIRECT_INVALID_TARGET')
    }, { retries: 2 })
    await expect(runtime.search({ query: 'fatal' })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_INVALID_TARGET' })
    expect(calls).toBe(1)
  })

  it('keeps a successful engine when another worker rejects after the deadline', async () => {
    const runtime = runtimeWith(async (request) => {
      if (request.targets[0]!.engine === 'bing') {
        await new Promise((resolve) => setTimeout(resolve, 700))
        throw new Error('late failure')
      }
      return resultFor(target('duckduckgo'))
    }, { engines: ['duckduckgo', 'bing'], deadlineMs: 1_000, retries: 1 })
    const result = await runtime.search({ query: 'late' })
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.notes?.join(' ')).toContain('Bing')
    expect(result.notes?.join(' ')).toContain('late failure')
  }, 4_000)

  it('redacts URL queries and secret-looking values in probe/search errors', async () => {
    const runtime = runtimeWith(async () => {
      throw new Error('failed https://example.com/search?q=private-query token=abc123')
    })
    const probe = await runtime.probe()
    expect(probe.message).toContain('https://example.com/search')
    expect(probe.message).not.toContain('private-query')
    expect(probe.message).not.toContain('abc123')
    await expect(runtime.search({ query: 'redacted' })).rejects.toMatchObject({
      code: 'LOCAL_DIRECT_ALL_FAILED',
      message: expect.not.stringContaining('private-query'),
    })
  })

  it('exposes cache stats under disabled and enabled cache configurations', async () => {
    const runtime = runtimeWith(async request => resultFor(target(request.targets[0]!.engine)), {
      cacheMaxEntries: 2,
      cacheTtlMs: 10_000,
    })
    await runtime.search({ query: 'cache' })
    expect(runtime.cacheStats()).toMatchObject({ size: 1, misses: 1 })
    const reconfigured = runtimeWith(async request => resultFor(target(request.targets[0]!.engine)), {
      cacheMaxEntries: 2,
      cacheTtlMs: 0,
    })
    await reconfigured.search({ query: 'cache' })
    expect(reconfigured.cacheStats().size).toBe(0)
  })
})
