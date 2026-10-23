/** SearXNG runtime: auth, failover, retries, cache, JSON/HTML parsing. */

import { LRUCache } from 'lru-cache'
import { ProxyAgent } from 'undici'
import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  CacheStats, ProbeResult, SearchAdapterRuntime, SearchRequest, SearchResult, SearchSource,
} from '../../../core/types.ts'
import { SearchToolsError } from '../../../shared/errors.ts'
import { hostOf, normalizeInstanceUrl } from '../../../shared/url.ts'
import { isRecord, stableKey } from '../../../shared/validation.ts'
import { parseSearxngHtml } from './parse-html.ts'
import { parseSearxngJson } from './parse-json.ts'
import {
  normalizeSearxngConfig, type SearxngAuthType, type SearxngConfig, type SearxngInstance,
} from './schema.ts'

const TOKEN_REF = 'SEARXNG_TOKEN'
const BASIC_REF = 'SEARXNG_BASIC_AUTH'
const MAX_ANSWER_CHARS = 8_000
const MAX_SNIPPET_CHARS = 2_000
const MAX_TITLE_CHARS = 500
const FORMAT_FALLBACK_CODE = 'SEARXNG_FORMAT_FALLBACK'

type SearchFormat = 'json' | 'html'

export class SearxngRuntime implements SearchAdapterRuntime {
  private cache: LRUCache<string, SearchResult> | undefined
  private cacheMax = -1
  private cacheTtl = -1
  private hits = 0
  private misses = 0
  private cursor = 0

  constructor(
    private readonly ctx: AdapterContext,
    private readonly getRawConfig: () => unknown,
  ) {}

  private config(): SearxngConfig {
    return normalizeSearxngConfig(this.getRawConfig())
  }

  /** Rebuild the LRU when the live config changes its bounds. TTL 0 disables it. */
  private cacheFor(config: SearxngConfig): LRUCache<string, SearchResult> | undefined {
    if (config.cacheMaxEntries <= 0 || config.cacheTtlMs <= 0) {
      this.cache = undefined
      this.cacheMax = config.cacheMaxEntries
      this.cacheTtl = config.cacheTtlMs
      return undefined
    }
    if (this.cache === undefined || this.cacheMax !== config.cacheMaxEntries || this.cacheTtl !== config.cacheTtlMs) {
      this.cache = new LRUCache({ max: config.cacheMaxEntries, ttl: config.cacheTtlMs })
      this.cacheMax = config.cacheMaxEntries
      this.cacheTtl = config.cacheTtlMs
    }
    return this.cache
  }

  available(): boolean {
    const config = this.config()
    return config.enabled && enabledInstances(config).length > 0
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    const config = this.config()
    if (!config.enabled) throw new SearchToolsError('SearXNG adapter is disabled', 'SEARXNG_DISABLED')
    const instances = enabledInstances(config)
    if (instances.length === 0) throw new SearchToolsError('no SearXNG instance is configured', 'SEARXNG_NOT_CONFIGURED')

    const limit = Math.max(1, Math.min(config.maxResults, request.maxResults ?? config.maxResults))
    const key = stableKey({
      query: request.query,
      limit,
      instances: instances.map(instance => instance.url),
      engines: config.engines,
      categories: config.categories,
      language: config.language,
      safesearch: config.safesearch,
      timeRange: config.timeRange,
      pages: config.pages,
      strategy: config.strategy,
      method: config.method,
      format: config.format,
      authType: config.auth.type,
      proxy: config.proxy,
      userAgent: config.userAgent,
      includeDomains: config.includeDomains,
      excludeDomains: config.excludeDomains,
    })
    const cache = this.cacheFor(config)
    const cached = cache?.get(key)
    if (cached !== undefined) {
      this.hits++
      return cloneResult(cached)
    }
    this.misses++

    const ordered = this.order(instances, config.strategy)
    const startedAt = Date.now()
    const deadlineAt = startedAt + config.deadlineMs
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), config.deadlineMs)
    timer.unref?.()
    const searchSignal = signal === undefined
      ? deadline.signal
      : AbortSignal.any([signal, deadline.signal])
    let lastError: unknown
    try {
      for (const instance of ordered) {
        if (isAbort(signal)) throw new SearchToolsError('search aborted', 'WEB_ABORTED')
        if (deadline.signal.aborted || Date.now() >= deadlineAt) throw deadlineError()
        try {
          const result = await this.searchInstance(instance, request.query, limit, config, searchSignal, deadlineAt)
          cache?.set(key, cloneResult(result))
          return result
        } catch (error) {
          if (isAbort(signal)) throw new SearchToolsError('search aborted', 'WEB_ABORTED')
          if (deadline.signal.aborted || Date.now() >= deadlineAt) throw deadlineError()
          lastError = error
          this.ctx.logger.warn('searxng instance %s failed: %s', hostOf(instance.url) ?? instance.url, errorMessage(error))
        }
      }
    } finally {
      clearTimeout(timer)
    }
    if (signal?.aborted === true) throw new SearchToolsError('search aborted', 'WEB_ABORTED')
    if (deadline.signal.aborted || Date.now() >= deadlineAt) throw deadlineError()
    if (lastError instanceof SearchToolsError) throw lastError
    throw new SearchToolsError(
      `all SearXNG instances failed: ${errorMessage(lastError)}`,
      'SEARXNG_ALL_FAILED',
      { cause: lastError },
    )
  }

  async probe(signal?: AbortSignal): Promise<ProbeResult> {
    return probeSearxng(this.ctx, this.getRawConfig(), signal)
  }

  clearCache(): void {
    this.cache = undefined
    this.cacheMax = -1
    this.cacheTtl = -1
    this.hits = 0
    this.misses = 0
  }

  cacheStats(): CacheStats {
    const cache = this.cacheFor(this.config())
    return { size: cache?.size ?? 0, hits: this.hits, misses: this.misses }
  }

  private order(instances: readonly SearxngInstance[], strategy: SearxngConfig['strategy']): SearxngInstance[] {
    if (strategy !== 'round-robin' || instances.length < 2) return [...instances]
    const start = this.cursor++ % instances.length
    return [...instances.slice(start), ...instances.slice(0, start)]
  }

  private async searchInstance(
    instance: SearxngInstance,
    query: string,
    limit: number,
    config: SearxngConfig,
    outer: AbortSignal,
    deadlineAt: number,
  ): Promise<SearchResult> {
    const auth = await authHeaders(this.ctx, config.auth.type)
    let lastError: unknown
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      const remaining = deadlineAt - Date.now()
      if (remaining <= 0 || outer.aborted) throw abortOrDeadline(outer, deadlineAt)
      const timeout = AbortSignal.timeout(Math.min(config.requestTimeoutMs, remaining))
      const signal = AbortSignal.any([outer, timeout])
      try {
        const outcomes = await Promise.allSettled(
          Array.from({ length: config.pages }, (_, index) =>
            this.requestPage(instance, query, config, auth, index + 1, signal)),
        )
        const pages: SearchResult[] = []
        const notes: string[] = []
        outcomes.forEach((outcome, index) => {
          if (outcome.status === 'fulfilled') pages.push(outcome.value)
          else notes.push(`page ${index + 1}: ${errorMessage(outcome.reason)}`)
        })
        if (pages.length === 0) {
          const first = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
          throw first?.reason ?? new SearchToolsError('SearXNG request failed', 'SEARXNG_ALL_FAILED')
        }
        const merged = mergePages(pages, limit)
        return notes.length === 0
          ? merged
          : { ...merged, notes: [...new Set([...(merged.notes ?? []), ...notes])].slice(0, 8) }
      } catch (error) {
        lastError = error
        if (outer.aborted) throw abortOrDeadline(outer, deadlineAt)
        if (!isRetryable(error) || attempt === config.retries) break
        const retryAfterMs = error instanceof SearchToolsError ? error.retryAfterMs : undefined
        const sleepMs = retryAfterMs ?? Math.min(500 * 2 ** attempt + Math.random() * 250, 5_000)
        if (sleepMs > 0) {
          if (Date.now() + sleepMs >= deadlineAt) throw deadlineError()
          await sleep(sleepMs, outer)
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new SearchToolsError('SearXNG request failed', 'SEARXNG_ALL_FAILED')
  }

  private async requestPage(
    instance: SearxngInstance,
    query: string,
    config: SearxngConfig,
    auth: Record<string, string>,
    page: number,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    const primary: SearchFormat = config.format === 'auto' ? 'json' : config.format
    try {
      return await this.requestFormat(instance, query, config, auth, page, primary, signal)
    } catch (error) {
      if (config.format !== 'auto' || !isFormatFallback(error) || signal.aborted) throw error
      return await this.requestFormat(instance, query, config, auth, page, 'html', signal)
    }
  }

  private async requestFormat(
    instance: SearxngInstance,
    query: string,
    config: SearxngConfig,
    auth: Record<string, string>,
    page: number,
    format: SearchFormat,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    const url = new URL(`${normalizeInstanceUrl(instance.url)}/search`)
    const params = new URLSearchParams({ q: query, pageno: String(page) })
    if (config.categories.length > 0) params.set('categories', config.categories.join(','))
    if (config.engines.length > 0) params.set('engines', config.engines.join(','))
    if (config.language.length > 0) params.set('language', config.language)
    params.set('safesearch', String(config.safesearch))
    if (config.timeRange.length > 0) params.set('time_range', config.timeRange)
    params.set('format', format)

    const headers: Record<string, string> = {
      ...auth,
      accept: format === 'json'
        ? 'application/json, text/html;q=0.9'
        : 'text/html, application/xhtml+xml',
      'user-agent': config.userAgent,
    }
    const language = acceptLanguage(config.language)
    if (language !== undefined) headers['accept-language'] = language

    const init: RequestInit = {
      method: config.method,
      headers,
      redirect: 'error',
      signal,
    }
    if (config.method === 'GET') {
      url.search = params.toString()
    } else {
      init.body = params.toString()
      init.headers = { ...headers, 'content-type': 'application/x-www-form-urlencoded' }
    }

    const response = await this.ctx.fetch(url, {
      ...init,
      ...(config.proxy.length > 0 ? { dispatcher: proxyDispatcher(config.proxy) } : {}),
    } as RequestInit)
    if (response.status === 401) {
      throw new SearchToolsError(`SearXNG authentication failed at ${hostOf(url.toString()) ?? 'instance'}`, 'SEARXNG_AUTH')
    }
    if (response.status === 403) {
      if (config.format === 'auto' && format === 'json') throw formatFallbackError()
      throw new SearchToolsError(`SearXNG authentication failed at ${hostOf(url.toString()) ?? 'instance'}`, 'SEARXNG_AUTH')
    }
    if (response.status === 415 || response.status === 406) {
      if (config.format === 'auto' && format === 'json') throw formatFallbackError()
      throw new SearchToolsError(`SearXNG returned HTTP ${response.status}`, 'SEARXNG_BAD_RESPONSE')
    }
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
    if (response.status === 429) {
      throw new SearchToolsError('SearXNG rate limited', 'SEARXNG_RATE_LIMIT', { ...(retryAfterMs === undefined ? {} : { retryAfterMs }) })
    }
    if (!response.ok) {
      throw new SearchToolsError(
        `SearXNG returned HTTP ${response.status}`,
        response.status >= 500 ? 'SEARXNG_ALL_FAILED' : 'SEARXNG_BAD_RESPONSE',
        retryAfterMs === undefined ? undefined : { retryAfterMs },
      )
    }
    const text = await response.text()
    if (format === 'html') return parseSearxngHtml(text, instance.url, config)
    try {
      return parseSearxngJson(JSON.parse(text), instance.url, config)
    } catch (error) {
      if (config.format === 'auto') throw formatFallbackError(error)
      throw new SearchToolsError('SearXNG JSON response could not be parsed', 'SEARXNG_BAD_RESPONSE', { cause: error })
    }
  }
}

/** Probe `/config`, then fall back to a one-result JSON search. Never echoes credentials. */
export async function probeSearxng(
  ctx: AdapterContext,
  rawConfig: unknown,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const config = normalizeSearxngConfig(rawConfig)
  const instance = enabledInstances(config)[0]
  if (instance === undefined) {
    return { ok: false, code: 'SEARXNG_NOT_CONFIGURED', message: '没有启用的实例', latencyMs: 0 }
  }
  const started = ctx.now()
  const base = normalizeInstanceUrl(instance.url)
  const timeout = AbortSignal.timeout(Math.min(config.requestTimeoutMs, 8_000))
  const timeoutSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let auth: Record<string, string>
  try {
    auth = await authHeaders(ctx, config.auth.type)
  } catch (error) {
    return { ok: false, code: 'SEARXNG_AUTH', message: errorMessage(error), latencyMs: ctx.now() - started }
  }
  const headers: Record<string, string> = {
    ...auth,
    accept: 'application/json',
    'user-agent': config.userAgent,
  }
  const language = acceptLanguage(config.language)
  if (language !== undefined) headers['accept-language'] = language
  try {
    const response = await ctx.fetch(`${base}/config`, {
      headers,
      redirect: 'error',
      signal: timeoutSignal,
      ...(config.proxy.length > 0 ? { dispatcher: proxyDispatcher(config.proxy) } : {}),
    } as RequestInit)
    const text = await response.text()
    const latencyMs = ctx.now() - started
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'SEARXNG_AUTH', message: '认证失败', latencyMs }
    }
    if (response.ok && looksLikeJson(response, text)) {
      try {
        const payload = JSON.parse(text) as Record<string, unknown>
        return {
          ok: true,
          latencyMs,
          json: true,
          html: true,
          ...(typeof payload.version === 'string' ? { version: payload.version } : {}),
          engines: namesOf(payload.engines),
          categories: namesOf(payload.categories),
        }
      } catch {
        return await probeBySearch(
          ctx,
          config,
          auth,
          base,
          started,
          timeoutSignal,
        )
      }
    }
    if (response.ok) return { ok: true, latencyMs, json: false, html: true }
    return await probeBySearch(
      ctx,
      config,
      auth,
      base,
      started,
      timeoutSignal,
    )
  } catch (error) {
    return {
      ok: false,
      code: isAbort(timeoutSignal) ? 'WEB_ABORTED' : 'SEARXNG_ALL_FAILED',
      message: errorMessage(error),
      latencyMs: ctx.now() - started,
    }
  }
}

async function probeBySearch(
  ctx: AdapterContext,
  config: SearxngConfig,
  auth: Record<string, string>,
  base: string,
  started: number,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const url = new URL(`${base}/search`)
  const params = new URLSearchParams({ q: 'dsh-search-tools probe', pageno: '1', format: 'json' })
  if (config.categories.length > 0) params.set('categories', config.categories.join(','))
  if (config.engines.length > 0) params.set('engines', config.engines.join(','))
  if (config.language.length > 0) params.set('language', config.language)
  params.set('safesearch', String(config.safesearch))
  if (config.timeRange.length > 0) params.set('time_range', config.timeRange)
  const headers: Record<string, string> = {
    ...auth,
    accept: 'application/json',
    'user-agent': config.userAgent,
  }
  const language = acceptLanguage(config.language)
  if (language !== undefined) headers['accept-language'] = language
  const init: RequestInit = {
    method: config.method,
    headers,
    redirect: 'error',
    signal,
  }
  if (config.method === 'GET') {
    url.search = params.toString()
  } else {
    init.body = params.toString()
    init.headers = { ...headers, 'content-type': 'application/x-www-form-urlencoded' }
  }
  try {
    const response = await ctx.fetch(url, {
      ...init,
      ...(config.proxy.length > 0 ? { dispatcher: proxyDispatcher(config.proxy) } : {}),
    } as RequestInit)
    const latencyMs = ctx.now() - started
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'SEARXNG_AUTH', message: '认证失败', latencyMs }
    }
    if (response.status === 429) return { ok: false, code: 'SEARXNG_RATE_LIMIT', message: '限流', latencyMs }
    const text = await response.text()
    if (response.ok && looksLikeJson(response, text)) {
      try {
        JSON.parse(text)
        return { ok: true, latencyMs, json: true, html: true }
      } catch {
        return { ok: true, latencyMs, json: false, html: true }
      }
    }
    if (response.ok) return { ok: true, latencyMs, json: false, html: true }
    return { ok: false, code: 'SEARXNG_ALL_FAILED', message: `HTTP ${response.status}`, latencyMs }
  } catch (error) {
    return {
      ok: false,
      code: isAbort(signal) ? 'WEB_ABORTED' : 'SEARXNG_ALL_FAILED',
      message: errorMessage(error),
      latencyMs: ctx.now() - started,
    }
  }
}

function enabledInstances(config: SearxngConfig): SearxngInstance[] {
  return config.instances.filter((instance) => {
    if (!instance.enabled || instance.url.trim().length === 0) return false
    try {
      normalizeInstanceUrl(instance.url)
      return true
    } catch {
      return false
    }
  })
}

async function authHeaders(ctx: AdapterContext, type: SearxngAuthType): Promise<Record<string, string>> {
  if (type === 'none') return {}
  if (type === 'bearer') {
    const token = await resolveCredential(ctx, TOKEN_REF)
    if (token === undefined) throw new SearchToolsError('SEARXNG_TOKEN is not configured', 'SEARXNG_AUTH')
    return { authorization: `Bearer ${token}` }
  }
  const basic = await resolveCredential(ctx, BASIC_REF)
  if (basic === undefined || !basic.includes(':')) {
    throw new SearchToolsError('SEARXNG_BASIC_AUTH must be username:password', 'SEARXNG_AUTH')
  }
  return { authorization: `Basic ${Buffer.from(basic).toString('base64')}` }
}

async function resolveCredential(ctx: AdapterContext, ref: string): Promise<string | undefined> {
  const stored = await ctx.getCredentials()?.resolve(ref)
  if (stored !== undefined && stored.value.length > 0) return stored.value
  const env = ctx.env[ref]
  return env !== undefined && env.length > 0 ? env : undefined
}

function mergePages(
  pages: readonly SearchResult[],
  limit: number,
): SearchResult {
  const seen = new Map<string, SearchSource>()
  const answers: string[] = []
  const notes: string[] = []
  let truncated = false
  for (const page of pages) {
    if (page.truncated) truncated = true
    if (page.content !== undefined) answers.push(page.content)
    if (page.notes !== undefined) notes.push(...page.notes)
    for (const source of page.sources) {
      const normalized = normalizeSource(source)
      if (normalized.clipped) truncated = true
      const existing = seen.get(normalized.source.url)
      if (existing === undefined) {
        seen.set(normalized.source.url, normalized.source)
      } else {
        seen.set(normalized.source.url, mergeSource(existing, normalized.source))
      }
    }
  }
  const sources = [...seen.values()]
  if (sources.length > limit) truncated = true
  const answer = clipText([...new Set(answers)].join('\n\n'), MAX_ANSWER_CHARS)
  if (answer.clipped) truncated = true
  return {
    ...(answer.text.length > 0 ? { content: answer.text } : {}),
    sources: sources.slice(0, limit),
    truncated,
    ...(notes.length > 0 ? { notes: [...new Set(notes)].slice(0, 8) } : {}),
  }
}

function normalizeSource(source: SearchSource): { source: SearchSource; clipped: boolean } {
  const title = source.title === undefined ? undefined : clipText(source.title, MAX_TITLE_CHARS)
  const snippet = source.snippet === undefined ? undefined : clipText(source.snippet, MAX_SNIPPET_CHARS)
  return {
    source: {
      url: source.url,
      ...(title === undefined || title.text.length === 0 ? {} : { title: title.text }),
      ...(snippet === undefined || snippet.text.length === 0 ? {} : { snippet: snippet.text }),
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
    },
    clipped: title?.clipped === true || snippet?.clipped === true,
  }
}

function mergeSource(left: SearchSource, right: SearchSource): SearchSource {
  const title = longerText(left.title, right.title)
  const snippet = longerText(left.snippet, right.snippet)
  const publishedAt = left.publishedAt ?? right.publishedAt
  return {
    url: left.url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

function longerText(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return right.length > left.length ? right : left
}

function clipText(value: string, max: number): { text: string; clipped: boolean } {
  return value.length <= max ? { text: value, clipped: false } : { text: value.slice(0, max), clipped: true }
}

function cloneResult(result: SearchResult): SearchResult {
  return {
    ...(result.content === undefined ? {} : { content: result.content }),
    sources: result.sources.map(source => ({ ...source })),
    truncated: result.truncated,
    ...(result.notes === undefined ? {} : { notes: [...result.notes] }),
  }
}

function looksLikeJson(response: Response, text: string): boolean {
  const type = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (type.includes('json')) return true
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (isRecord(entry) && typeof entry.name === 'string') return [entry.name]
    return []
  })
}

/** Parse `Retry-After` as delta-seconds or an HTTP date; ignore negative/invalid values. */
export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  const text = value?.trim()
  if (text === undefined || text.length === 0 || text.startsWith('-')) return undefined
  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    const seconds = Number(text)
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1_000)) : undefined
  }
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.max(0, timestamp - now)
}

function acceptLanguage(language: string): string | undefined {
  const value = language.trim()
  if (value.length === 0 || value.toLowerCase() === 'all') return undefined
  const [base] = value.split('-', 1)
  if (base === undefined || base === value) return value
  return `${value},${base};q=0.9`
}

function isRetryable(error: unknown): boolean {
  if (error instanceof SearchToolsError) {
    return error.code === 'SEARXNG_RATE_LIMIT'
      || error.code === 'SEARXNG_ALL_FAILED'
      || error.code === FORMAT_FALLBACK_CODE
  }
  return true
}

function isFormatFallback(error: unknown): boolean {
  return error instanceof SearchToolsError && error.code === FORMAT_FALLBACK_CODE
}

function formatFallbackError(cause?: unknown): SearchToolsError {
  const message = 'SearXNG JSON response is unavailable; retrying as HTML'
  return cause === undefined
    ? new SearchToolsError(message, FORMAT_FALLBACK_CODE)
    : new SearchToolsError(message, FORMAT_FALLBACK_CODE, { cause })
}

function deadlineError(): SearchToolsError {
  return new SearchToolsError('SearXNG search deadline exceeded', 'SEARXNG_DEADLINE')
}

function abortOrDeadline(signal: AbortSignal, deadlineAt: number): SearchToolsError {
  if (signal.aborted && Date.now() >= deadlineAt) return deadlineError()
  return new SearchToolsError('search aborted', 'WEB_ABORTED')
}

function isAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new SearchToolsError('search aborted', 'WEB_ABORTED')
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new SearchToolsError('search aborted', 'WEB_ABORTED'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const proxyAgents = new Map<string, ProxyAgent>()

/** Lazy, per-URL proxy dispatcher; no agent is created when proxy is empty. */
function proxyDispatcher(proxy: string): ProxyAgent {
  let agent = proxyAgents.get(proxy)
  if (agent === undefined) {
    agent = new ProxyAgent(proxy)
    proxyAgents.set(proxy, agent)
  }
  return agent
}
