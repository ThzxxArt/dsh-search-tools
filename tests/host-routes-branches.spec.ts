import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import type { FetchDispatcher, SearchDispatcher } from '../src/core/dispatchers.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import type { SearchToolsService } from '../src/core/service.ts'
import type { AdapterManifest, JsonObject } from '../src/core/types.ts'
import {
  buildStatus, fetchPreviewTimeoutMs, fetchProbeTimeoutMs, registerRoutes,
  searchPreviewTimeoutMs, searchProbeTimeoutMs, type RouteDeps,
} from '../src/host/routes.ts'
import { DEFAULT_ACTIVATION_CONFIG, DEFAULT_RESEARCH_CONFIG } from '../src/shared/defaults.ts'

const BASE = '/api/dsh-search-tools'

function manifest(kind: 'search' | 'fetch', id: string, extra: Partial<AdapterManifest> = {}): AdapterManifest {
  return { kind, id, label: id, description: id, fields: [], defaults: {}, ...extra }
}

function configOf(overrides: Partial<{ search: JsonObject; fetch: JsonObject; searchAdapter: string; fetchAdapter: string }> = {}): Config {
  return {
    search: {
      get: () => ({
        adapter: overrides.searchAdapter ?? 'searxng',
        adapters: { [overrides.searchAdapter ?? 'searxng']: overrides.search ?? {} },
      }),
    },
    fetch: {
      get: () => ({
        adapter: overrides.fetchAdapter ?? 'readable-http',
        adapters: { [overrides.fetchAdapter ?? 'readable-http']: overrides.fetch ?? {} },
      }),
    },
    research: { get: () => DEFAULT_RESEARCH_CONFIG },
    activation: { get: () => DEFAULT_ACTIVATION_CONFIG },
  } as unknown as Config
}

function depsOf(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    config: configOf(),
    search: {
      available: () => true,
      cacheStats: () => ({ size: 0, hits: 0, misses: 0 }),
      clearCache: vi.fn(),
      preview: async () => ({ sources: [], truncated: false }),
      probe: async () => ({ ok: true, latencyMs: 1 }),
    } as unknown as SearchDispatcher,
    fetch: {
      available: () => true,
      preview: async () => ({
        url: 'https://example.com/',
        statusCode: 200,
        body: { kind: 'text', content: 'ok' },
        truncated: false,
      }),
      probe: async () => ({ ok: true, latencyMs: 1 }),
    } as unknown as FetchDispatcher,
    adapters: {
      listAdapters: () => ({ search: [], fetch: [] }),
      getSearchAdapter: () => undefined,
      getFetchAdapter: () => undefined,
    } as unknown as SearchToolsService,
    diagnostics: new Diagnostics(),
    ...overrides,
  }
}

function contextOf(options: {
  connection?: boolean
  rejection?: 401 | 403
  settings?: { prepareDocument?: () => Promise<string> }
  configEditor?: { documentPath?: string }
  profile?: { patchPath?: string }
  credentials?: { describe: (ref: string) => Promise<{ configured: boolean; source?: string; writable: boolean }> }
} = {}): {
  ctx: Context
  handlers: Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>
} {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>()
  const services: Record<string, unknown> = {
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.configEditor === undefined ? {} : { configEditor: options.configEditor }),
    ...(options.profile === undefined ? {} : { profileContext: options.profile }),
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    ...(options.connection === false ? {} : { connection: { requestRejection: () => options.rejection } }),
  }
  const ctx = {
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    webServer: {
      register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void }) => {
        handlers.set(route.path, route.handler)
        return () => {}
      },
    },
  } as unknown as Context
  return { ctx, handlers }
}

interface TestResponse extends ServerResponse {
  body: string
  headers: Record<string, string>
}

function responseOf(headersSent = false): TestResponse {
  const response = {
    statusCode: 0,
    headersSent,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value },
    end(chunk?: unknown) {
      this.body = chunk === undefined ? '' : String(chunk)
      this.headersSent = true
    },
  }
  return response as unknown as TestResponse
}

function requestOf(
  body: unknown,
  method = 'POST',
  contentType = 'application/json',
): IncomingMessage {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const bytes = Buffer.from(raw)
  return {
    method,
    headers: { 'content-type': contentType },
    resume() {},
    async *[Symbol.asyncIterator]() {
      yield bytes
    },
  } as unknown as IncomingMessage
}

async function call(
  handlers: Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>,
  path: string,
  req: IncomingMessage,
  res: TestResponse,
): Promise<TestResponse> {
  await handlers.get(`${BASE}/${path}`)!(req, res)
  return res
}

describe('route registration and rejection', () => {
  it('does nothing when the connection fence is unavailable', () => {
    const { ctx, handlers } = contextOf({ connection: false })
    registerRoutes(ctx, depsOf())
    expect(handlers.size).toBe(0)
  })

  it('rejects a request through the connection fence', async () => {
    const { ctx, handlers } = contextOf({ rejection: 403 })
    registerRoutes(ctx, depsOf())
    const response = await call(handlers, 'status', requestOf({}, 'GET'), responseOf())
    expect(response.statusCode).toBe(403)
    expect(response.body).toBe('')
  })

  it('returns 405 with an allow header for every route', async () => {
    const { ctx, handlers } = contextOf()
    registerRoutes(ctx, depsOf())
    const cases: Array<[string, 'GET' | 'POST']> = [
      ['status', 'GET'],
      ['adapters', 'GET'],
      ['probe', 'POST'],
      ['search-preview', 'POST'],
      ['fetch-preview', 'POST'],
      ['cache/clear', 'POST'],
      ['diagnostics/clear', 'POST'],
    ]
    for (const [path, allowed] of cases) {
      const response = await call(handlers, path, requestOf({}, allowed === 'GET' ? 'POST' : 'GET'), responseOf())
      expect(response.statusCode, path).toBe(405)
      expect(response.headers.allow).toBe(allowed)
    }
  })

  it('serves status and adapter manifests', async () => {
    const { ctx, handlers } = contextOf()
    const adapters = {
      listAdapters: () => ({
        search: [manifest('search', 'search')],
        fetch: [manifest('fetch', 'fetch')],
      }),
      getSearchAdapter: () => ({ manifest: manifest('search', 'search') }),
      getFetchAdapter: () => ({ manifest: manifest('fetch', 'fetch') }),
    } as unknown as SearchToolsService
    registerRoutes(ctx, depsOf({ adapters }))
    const status = await call(handlers, 'status', requestOf({}, 'GET'), responseOf())
    expect(JSON.parse(status.body)).toMatchObject({ version: '0.1.9', search: { adapter: 'searxng' } })
    const list = await call(handlers, 'adapters', requestOf({}, 'GET'), responseOf())
    expect(JSON.parse(list.body).search[0].id).toBe('search')
  })
})

describe('probe route', () => {
  it('requires an adapter, supports fetch probes, and reports errors with latency', async () => {
    const { ctx, handlers } = contextOf()
    const deps = depsOf()
    registerRoutes(ctx, deps)

    const empty = await call(handlers, 'probe', requestOf({}), responseOf())
    expect(JSON.parse(empty.body)).toMatchObject({ ok: false, code: 'ADAPTER_REQUIRED' })

    const fetchProbe = vi.fn(async () => ({ ok: true, latencyMs: 2 }))
    deps.fetch = { probe: fetchProbe } as unknown as FetchDispatcher
    const fetchResponse = await call(handlers, 'probe', requestOf({
      kind: 'fetch',
      adapter: 'fetch',
      url: 42,
      config: 'not-record',
    }), responseOf())
    expect(JSON.parse(fetchResponse.body)).toMatchObject({ ok: true, elapsedMs: expect.any(Number) })
    expect(fetchProbe).toHaveBeenCalledWith('fetch', {}, '', expect.any(AbortSignal))

    deps.search = { probe: async () => { throw new Error('probe exploded') } } as unknown as SearchDispatcher
    const failed = await call(handlers, 'probe', requestOf({ adapter: 'search' }), responseOf())
    expect(JSON.parse(failed.body)).toMatchObject({ ok: false, message: 'probe exploded', latencyMs: expect.any(Number) })
  })
})

describe('search preview route', () => {
  it('validates query, defaults the adapter, forwards maxResults, and returns results', async () => {
    const { ctx, handlers } = contextOf()
    const preview = vi.fn(async () => ({ sources: [{ url: 'https://example.com/' }], truncated: false }))
    const deps = depsOf({ search: { preview } as unknown as SearchDispatcher })
    registerRoutes(ctx, deps)

    const missingQuery = await call(handlers, 'search-preview', requestOf({ query: '   ' }), responseOf())
    expect(JSON.parse(missingQuery.body)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })

    const result = await call(handlers, 'search-preview', requestOf({
      query: '  hello  ',
      config: { maxResults: 3 },
    }), responseOf())
    expect(JSON.parse(result.body)).toMatchObject({ ok: true, sources: [{ url: 'https://example.com/' }] })
    expect(preview).toHaveBeenCalledWith('searxng', { maxResults: 3 }, { query: 'hello', maxResults: 3 }, expect.any(AbortSignal))

    const invalidConfig = await call(handlers, 'search-preview', requestOf({
      query: 'hello',
      config: 'bad',
      adapter: 'other',
    }), responseOf())
    expect(JSON.parse(invalidConfig.body).ok).toBe(true)
    expect(preview).toHaveBeenLastCalledWith('other', {}, { query: 'hello' }, expect.any(AbortSignal))
  })

  it('maps thrown errors to the stable error envelope', async () => {
    const { ctx, handlers } = contextOf()
    const deps = depsOf({
      search: { preview: async () => { throw new Error('preview failed') } } as unknown as SearchDispatcher,
    })
    registerRoutes(ctx, deps)
    const response = await call(handlers, 'search-preview', requestOf({ query: 'q' }), responseOf())
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      message: 'preview failed',
      elapsedMs: expect.any(Number),
    })
  })
})

describe('fetch preview route', () => {
  it('validates url, defaults the adapter, slices content, and reports non-2xx status', async () => {
    const { ctx, handlers } = contextOf()
    const longContent = 'x'.repeat(25_000)
    const preview = vi.fn(async () => ({
      url: 'https://example.com/final',
      statusCode: 404,
      body: { kind: 'html' as const, content: longContent },
      truncated: true,
    }))
    const deps = depsOf({ fetch: { preview } as unknown as FetchDispatcher })
    registerRoutes(ctx, deps)

    const missingUrl = await call(handlers, 'fetch-preview', requestOf({ url: '   ' }), responseOf())
    expect(JSON.parse(missingUrl.body)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })

    const result = await call(handlers, 'fetch-preview', requestOf({ url: ' https://example.com/ ' }), responseOf())
    const body = JSON.parse(result.body)
    expect(body).toMatchObject({
      ok: false,
      message: 'HTTP 404',
      url: 'https://example.com/final',
      statusCode: 404,
      kind: 'html',
      chars: 25_000,
      truncated: true,
    })
    expect(body.content).toHaveLength(20_000)
    expect(preview).toHaveBeenCalledWith('readable-http', {}, { url: 'https://example.com/' }, expect.any(AbortSignal))
  })
})

describe('cache and diagnostics routes', () => {
  it('clears search cache and diagnostics', async () => {
    const { ctx, handlers } = contextOf()
    const deps = depsOf()
    deps.search = {
      clearCache: vi.fn(),
      cacheStats: () => ({ size: 1, hits: 2, misses: 3 }),
    } as unknown as SearchDispatcher
    deps.diagnostics.record(new Error('old'), 'OLD')
    registerRoutes(ctx, deps)

    const cache = await call(handlers, 'cache/clear', requestOf({}), responseOf())
    expect(JSON.parse(cache.body)).toEqual({ ok: true, cache: { size: 1, hits: 2, misses: 3 } })
    expect(deps.search.clearCache).toHaveBeenCalled()

    const diagnostics = await call(handlers, 'diagnostics/clear', requestOf({}), responseOf())
    expect(JSON.parse(diagnostics.body)).toEqual({ ok: true })
    expect(deps.diagnostics.list()).toEqual([])
  })

  it('does not write a response when headers were already sent', async () => {
    const { ctx, handlers } = contextOf()
    registerRoutes(ctx, depsOf())
    const response = await call(handlers, 'cache/clear', requestOf({}), responseOf(true))
    expect(response.body).toBe('')
  })
})

describe('JSON body reader', () => {
  it('rejects unsupported media types, malformed JSON, arrays, oversized bodies, and empty bodies', async () => {
    const { ctx, handlers } = contextOf()
    registerRoutes(ctx, depsOf())

    const unsupported = await call(handlers, 'probe', requestOf({}, 'POST', 'text/plain'), responseOf())
    expect(unsupported.statusCode).toBe(415)
    expect(JSON.parse(unsupported.body).code).toBe('UNSUPPORTED_MEDIA_TYPE')

    const malformed = await call(handlers, 'probe', requestOf('{not-json'), responseOf())
    expect(malformed.statusCode).toBe(400)
    expect(JSON.parse(malformed.body).code).toBe('BAD_REQUEST')

    const array = await call(handlers, 'probe', requestOf('[]'), responseOf())
    expect(array.statusCode).toBe(400)
    expect(JSON.parse(array.body).code).toBe('BAD_REQUEST')

    const oversized = await call(handlers, 'probe', requestOf('x'.repeat(65 * 1024)), responseOf())
    expect(oversized.statusCode).toBe(413)
    expect(JSON.parse(oversized.body).code).toBe('BODY_TOO_LARGE')

    const empty = await call(handlers, 'probe', requestOf(''), responseOf())
    expect(empty.statusCode).toBe(400)
    expect(JSON.parse(empty.body).code).toBe('BAD_REQUEST')
  })
})

describe('timeout helpers', () => {
  it('bounds fetch and search route signals from draft config', () => {
    expect(fetchPreviewTimeoutMs(undefined)).toBe(30_000)
    expect(fetchPreviewTimeoutMs('bad')).toBe(30_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: 'bad' })).toBe(30_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: 0 })).toBe(30_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: 60_000 })).toBe(65_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: 999_999 })).toBe(190_000)
    expect(fetchProbeTimeoutMs({ timeoutMs: 60_000 })).toBe(65_000)
    expect(searchPreviewTimeoutMs(undefined)).toBe(30_000)
    expect(searchPreviewTimeoutMs({ deadlineMs: 60_000 })).toBe(65_000)
    expect(searchPreviewTimeoutMs({ requestTimeoutMs: 30_000 })).toBe(35_000)
    expect(searchPreviewTimeoutMs({ deadlineMs: 0, requestTimeoutMs: 30_000 })).toBe(35_000)
    expect(searchPreviewTimeoutMs({ deadlineMs: 999_999 })).toBe(190_000)
    expect(searchProbeTimeoutMs({ requestTimeoutMs: 1_000 })).toBe(20_000)
  })
})

describe('buildStatus source and path branches', () => {
  const baseCtx = (services: Record<string, unknown>) => ({
    get: (name: string) => services[name],
  }) as unknown as Context

  it('uses settings, config editor, and profile fallbacks for the config path', async () => {
    const deps = depsOf()
    expect((await buildStatus(baseCtx({ settings: { prepareDocument: async () => '/settings.yml' } }), deps)).configPath)
      .toBe('/settings.yml')
    expect((await buildStatus(baseCtx({ settings: { prepareDocument: async () => { throw new Error('nope') } }, configEditor: { documentPath: '/editor.yml' } }), deps)).configPath)
      .toBe('/editor.yml')
    expect((await buildStatus(baseCtx({ profileContext: { patchPath: '/profile.yml' } }), deps)).configPath)
      .toBe('/profile.yml')
    expect((await buildStatus(baseCtx({}), deps)).configPath).toBeNull()
  })

  it('reports credential refs, success, source, and failures', async () => {
    const deps = depsOf()
    deps.adapters = {
      getSearchAdapter: () => undefined,
      getFetchAdapter: () => undefined,
      listAdapters: () => ({
        search: [manifest('search', 'search', { secretRefs: [{ key: 'search', ref: 'SEARCH_KEY', label: 'Search key' }] })],
        fetch: [manifest('fetch', 'fetch', { secretRefs: [{ key: 'fetch', ref: 'FETCH_KEY', label: 'Fetch key' }] })],
      }),
    } as unknown as SearchToolsService
    const status = await buildStatus(baseCtx({
      credentials: {
        describe: async (ref: string) => ref === 'SEARCH_KEY'
          ? { configured: true, source: 'env', writable: true }
          : await Promise.reject(new Error('missing')),
      },
    }), deps)
    expect(status.credentials).toEqual({
      SEARCH_KEY: { configured: true, source: 'env', writable: true },
      FETCH_KEY: { configured: false, writable: false },
    })
    expect(status.search.registered).toBe(false)
    expect(status.fetch.registered).toBe(false)
  })

  it('counts legacy instance arrays and generic source fields', async () => {
    const deps = depsOf()
    deps.adapters = {
      getSearchAdapter: () => undefined,
      getFetchAdapter: () => undefined,
      listAdapters: () => ({ search: [], fetch: [] }),
    } as unknown as SearchToolsService
    deps.config = configOf({
      search: {
        instances: [
          { url: 'https://one.example', enabled: true },
          { url: '', enabled: true },
          { url: 'https://two.example', enabled: false },
          { url: 'https://three.example' },
        ],
      },
    })
    expect((await buildStatus(baseCtx({}), deps)).search.sources).toBe(2)

    deps.config = configOf({ search: { arbitrary: true } })
    deps.adapters = {
      getSearchAdapter: () => ({
        manifest: { ...manifest('search', 'searxng'), fields: [{ key: 'value', kind: 'text', label: 'Value' }] },
      }),
      getFetchAdapter: () => undefined,
      listAdapters: () => ({ search: [], fetch: [] }),
    } as unknown as SearchToolsService
    expect((await buildStatus(baseCtx({}), deps)).search.sources).toBe(1)

    deps.config = configOf({ search: {} })
    expect((await buildStatus(baseCtx({}), deps)).search.sources).toBe(0)
  })

  it('handles disabled adapters, malformed configs, and missing instances', async () => {
    const deps = depsOf()
    deps.config = configOf({ search: null as never, fetch: null as never })
    const status = await buildStatus(baseCtx({}), deps)
    expect(status.search.enabled).toBe(true)
    expect(status.fetch.enabled).toBe(true)
    expect(status.search.instances).toBe(0)

    deps.config = configOf({ search: { enabled: false }, fetch: { enabled: false } })
    const disabled = await buildStatus(baseCtx({}), deps)
    expect(disabled.search.enabled).toBe(false)
    expect(disabled.search.sources).toBe(0)
    expect(disabled.fetch.enabled).toBe(false)
  })

  it('counts checkbox sources from stored values, defaults, and invalid values', async () => {
    const deps = depsOf()
    const checkboxManifest = {
      ...manifest('search', 'custom'),
      fields: [{ key: 'engines', kind: 'checkboxes', label: 'Engines', options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] }],
      defaults: { engines: ['one', 'two'] },
    } as unknown as AdapterManifest
    deps.adapters = {
      getSearchAdapter: () => ({ manifest: checkboxManifest }),
      getFetchAdapter: () => undefined,
      listAdapters: () => ({ search: [], fetch: [] }),
    } as unknown as SearchToolsService

    const cases: Array<[JsonObject, number]> = [
      [{}, 2],
      [{ engines: [' ONE ', 'two', 'unknown'] }, 2],
      [{ engines: [] }, 0],
      [{ engines: null as never }, 0],
      [{ engines: 'one' as never }, 0],
      [{ engines: [1, 'two'] as never }, 1],
    ]
    for (const [search, expected] of cases) {
      deps.config = configOf({ search })
      expect((await buildStatus(baseCtx({}), deps)).search.sources, JSON.stringify(search)).toBe(expected)
    }
  })
})
