/**
 * Authenticated settings routes. Every handler crosses the same
 * Host/Origin + browser-auth fence as the rest of `/api`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from '../config.ts'
import { snapshot } from '../config.ts'
import type { FetchDispatcher, SearchDispatcher } from '../core/dispatchers.ts'
import type { SearchToolsService } from '../core/service.ts'
import type { Diagnostics } from '../core/diagnostics.ts'
import type { CacheStats, JsonObject, StatusResponse } from '../core/types.ts'
import { SearchToolsError, errorCode, errorMessage } from '../shared/errors.ts'
import { isRecord, readBoolean } from '../shared/validation.ts'

const BASE = '/api/dsh-search-tools'
const MAX_BODY_BYTES = 64 * 1024
const VERSION = '0.1.5'
const FETCH_PREVIEW_BASE_TIMEOUT_MS = 30_000
const FETCH_PROBE_BASE_TIMEOUT_MS = 30_000
const FETCH_ROUTE_MAX_TIMEOUT_MS = 190_000
const FETCH_ROUTE_TIMEOUT_OVERHEAD_MS = 5_000

interface ConnectionFence {
  requestRejection(request: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

interface SettingsPathService {
  prepareDocument?: () => Promise<string>
}

interface ConfigEditorPathService {
  documentPath?: string
}

interface ProfilePathService {
  patchPath?: string
}

interface CredentialsService {
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
}

export interface RouteDeps {
  config: Config
  search: SearchDispatcher
  fetch: FetchDispatcher
  adapters: SearchToolsService
  diagnostics: Diagnostics
  /** True only while the `web_research` tool is actually registered. */
  researchRegistered?: () => boolean
}

export function registerRoutes(ctx: Context, deps: RouteDeps): void {
  const connection = ctx.get('connection') as ConnectionFence | undefined
  if (connection === undefined) return

  const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/status`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
      await sendStatus(ctx, deps, res)
    },
  }), 'dsh-search-tools: status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/adapters`,
    handler: (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
      sendJson(res, 200, deps.adapters.listAdapters())
    },
  }), 'dsh-search-tools: adapters route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/probe`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJson(req, res)
      if (body === undefined) return
      const adapter = typeof body.adapter === 'string' ? body.adapter : ''
      const config = isRecord(body.config) ? body.config as JsonObject : {}
      const started = Date.now()
      try {
        const timeoutMs = body.kind === 'fetch' ? fetchProbeTimeoutMs(config) : 20_000
        const result = adapter.length === 0
          ? { ok: false, code: 'ADAPTER_REQUIRED', message: 'adapter is required', latencyMs: 0 }
          : body.kind === 'fetch'
            ? await deps.fetch.probe(adapter, config, typeof body.url === 'string' ? body.url : '', AbortSignal.timeout(timeoutMs))
            : await deps.search.probe(adapter, config, AbortSignal.timeout(timeoutMs))
        sendJson(res, 200, { ...result, elapsedMs: Date.now() - started })
      } catch (error) {
        sendError(res, error, started)
      }
    },
  }), 'dsh-search-tools: probe route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/search-preview`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJson(req, res)
      if (body === undefined) return
      const started = Date.now()
      try {
        const query = typeof body.query === 'string' ? body.query.trim() : ''
        if (query.length === 0) throw new SearchToolsError('query is required', 'BAD_REQUEST')
        const adapter = typeof body.adapter === 'string' ? body.adapter : snapshot(deps.config).search.adapter
        const config = isRecord(body.config) ? body.config as JsonObject : {}
        const maxResults = typeof config.maxResults === 'number' ? config.maxResults : undefined
        const result = await deps.search.preview(
          adapter,
          config,
          { query, ...(maxResults === undefined ? {} : { maxResults }) },
          AbortSignal.timeout(30_000),
        )
        sendJson(res, 200, { ok: true, ...result, elapsedMs: Date.now() - started })
      } catch (error) {
        sendError(res, error, started)
      }
    },
  }), 'dsh-search-tools: search preview route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/fetch-preview`,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJson(req, res)
      if (body === undefined) return
      const started = Date.now()
      try {
        const url = typeof body.url === 'string' ? body.url.trim() : ''
        if (url.length === 0) throw new SearchToolsError('url is required', 'BAD_REQUEST')
        const adapter = typeof body.adapter === 'string' ? body.adapter : snapshot(deps.config).fetch.adapter
        const config = isRecord(body.config) ? body.config as JsonObject : {}
        const result = await deps.fetch.preview(adapter, config, { url }, AbortSignal.timeout(fetchPreviewTimeoutMs(config)))
        const ok = result.statusCode >= 200 && result.statusCode < 300
        sendJson(res, 200, {
          ok,
          ...(ok ? {} : { message: `HTTP ${result.statusCode}` }),
          url: result.url,
          statusCode: result.statusCode,
          kind: result.body.kind,
          content: result.body.content.slice(0, 20_000),
          chars: result.body.content.length,
          truncated: result.truncated,
          elapsedMs: Date.now() - started,
        })
      } catch (error) {
        sendError(res, error, started)
      }
    },
  }), 'dsh-search-tools: fetch preview route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/cache/clear`,
    handler: (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      deps.search.clearCache()
      sendJson(res, 200, { ok: true, cache: deps.search.cacheStats() })
    },
  }), 'dsh-search-tools: cache clear route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}/diagnostics/clear`,
    handler: (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      deps.diagnostics.clear()
      sendJson(res, 200, { ok: true })
    },
  }), 'dsh-search-tools: diagnostics clear route')
}

async function sendStatus(ctx: Context, deps: RouteDeps, res: ServerResponse): Promise<void> {
  sendJson(res, 200, await buildStatus(ctx, deps))
}

/**
 * The fetch preview route must outlive the adapter's own timeout. Jina Reader
 * can wait up to 180s; the route signal adds five seconds of host overhead and
 * never exceeds 190s. Missing or malformed drafts keep the historical defaults.
 */
export function fetchPreviewTimeoutMs(config: unknown): number {
  return fetchRouteTimeoutMs(config, FETCH_PREVIEW_BASE_TIMEOUT_MS)
}

/** Fetch probe timeout: same draft-aware rule with a 30s floor for Jina's default. */
export function fetchProbeTimeoutMs(config: unknown): number {
  return fetchRouteTimeoutMs(config, FETCH_PROBE_BASE_TIMEOUT_MS)
}

function fetchRouteTimeoutMs(config: unknown, base: number): number {
  if (!isRecord(config)) return base
  const value = config.timeoutMs
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return base
  return Math.min(FETCH_ROUTE_MAX_TIMEOUT_MS, Math.max(base, Math.ceil(value) + FETCH_ROUTE_TIMEOUT_OVERHEAD_MS))
}

/** Build the same payload the wire route returns; exported for contract tests. */
export async function buildStatus(ctx: Context, deps: RouteDeps): Promise<StatusResponse> {
  const state = snapshot(deps.config)
  const cache: CacheStats = deps.search.cacheStats()
  const credentials = await describeCredentials(ctx, deps.adapters)
  const configPath = await configPathOf(ctx)
  const searchInstances = countInstances(state.search.adapters[state.search.adapter])
  const searchEnabled = adapterEnabled(state.search.adapters[state.search.adapter])
  const fetchEnabled = adapterEnabled(state.fetch.adapters[state.fetch.adapter])
  return {
    version: VERSION,
    configPath,
    search: {
      enabled: searchEnabled,
      registered: deps.adapters.getSearchAdapter(state.search.adapter) !== undefined,
      available: deps.search.available(),
      adapter: state.search.adapter,
      instances: searchInstances,
    },
    fetch: {
      enabled: fetchEnabled,
      registered: deps.adapters.getFetchAdapter(state.fetch.adapter) !== undefined,
      available: deps.fetch.available(),
      adapter: state.fetch.adapter,
    },
    research: {
      enabled: state.research.enabled,
      registered: deps.researchRegistered?.() === true,
    },
    credentials,
    cache,
    lastErrors: deps.diagnostics.list(),
  }
}

async function describeCredentials(
  ctx: Context,
  adapters: SearchToolsService,
): Promise<Record<string, { configured: boolean; source?: string; writable: boolean }>> {
  const manifests = adapters.listAdapters()
  const refs = [...new Set([...manifests.search, ...manifests.fetch]
    .flatMap(manifest => (manifest.secretRefs ?? []).map(secret => secret.ref)))]
  const credentials = ctx.get('credentials') as CredentialsService | undefined
  if (credentials === undefined) {
    return Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: false }]))
  }
  const entries = await Promise.all(refs.map(async ref => {
    try {
      const info = await credentials.describe(ref)
      return [ref, { configured: info.configured, ...(info.source === undefined ? {} : { source: info.source }), writable: info.writable }] as const
    } catch {
      return [ref, { configured: false, writable: false }] as const
    }
  }))
  return Object.fromEntries(entries)
}

async function configPathOf(ctx: Context): Promise<string | null> {
  const settings = ctx.get('settings') as SettingsPathService | undefined
  if (settings?.prepareDocument !== undefined) {
    try {
      return await settings.prepareDocument()
    } catch {
      // Fall through to the stable profile path.
    }
  }
  const editor = ctx.get('configEditor') as ConfigEditorPathService | undefined
  if (typeof editor?.documentPath === 'string') return editor.documentPath
  const profile = ctx.get('profileContext') as ProfilePathService | undefined
  return typeof profile?.patchPath === 'string' ? profile.patchPath : null
}

function adapterEnabled(raw: unknown): boolean {
  return isRecord(raw) ? readBoolean(raw.enabled, true) : true
}

function countInstances(raw: unknown): number {
  if (!isRecord(raw) || !Array.isArray(raw.instances)) return 0
  return raw.instances.filter(entry => isRecord(entry) && entry.enabled !== false && typeof entry.url === 'string' && entry.url.length > 0).length
}

async function readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  const mediaType = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    sendJson(res, 415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'content-type must be application/json' })
    return undefined
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      sendJson(res, 413, { ok: false, code: 'BODY_TOO_LARGE', message: 'body exceeds 64 KiB' })
      return undefined
    }
    chunks.push(chunk)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isRecord(parsed)) {
      sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' })
      return undefined
    }
    return parsed
  } catch {
    sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'body must be valid JSON' })
    return undefined
  }
}

function sendError(res: ServerResponse, error: unknown, started: number): void {
  sendJson(res, 200, {
    ok: false,
    code: errorCode(error, 'INTERNAL'),
    message: errorMessage(error),
    elapsedMs: Date.now() - started,
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function methodNotAllowed(res: ServerResponse, allow: 'GET' | 'POST'): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}
