/** SearXNG runtime: auth, failover, retries, cache, JSON/HTML parsing. */

import { LRUCache } from 'lru-cache'
import { ProxyAgent } from 'undici'
import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  CacheStats, ProbeResult, SearchAdapterRuntime, SearchRequest, SearchResult,
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

export class SearxngRuntime implements SearchAdapterRuntime {
  private cache: LRUCache<string, SearchResult> | undefined
  private cacheMax = -1
  private cacheTtl = -1
  private hits = 0
  private misses = 0
  private readonly startedAt = Date.now()
  private cursor = 0

  constructor(
    private readonly ctx: AdapterContext,
    private readonly getRawConfig: () => unknown,
  ) {}

  private config(): SearxngConfig {
    return normalizeSearxngConfig(this.getRawConfig())
  }

  /** Rebuild the LRU when the live config changes its bounds. */
  private cacheFor(config: SearxngConfig): LRUCache<string, SearchResult> | undefined {
    if (config.cacheMaxEntries <= 0) {
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
      includeDomains: config.includeDomains,
      excludeDomains: config.excludeDomains,
    })
    const cache = this.cacheFor(config)
    const cached = cache?.get(key)
    if (cached !== undefined) {
      this.hits++
      return cached
    }
    this.misses++

    const ordered = this.order(instances, config.strategy)
    const deadline = Date.now() + config.deadlineMs
    let lastError: unknown
    for (const instance of ordered) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      try {
        const result = await this.searchInstance(instance, request.query, limit, config, signal, remaining)
        cache?.set(key, result)
        return result
      } catch (error) {
        lastError = error
        this.ctx.logger.warn('searxng instance %s failed: %s', hostOf(instance.url) ?? instance.url, errorMessage(error))
      }
    }
    if (isAbort(signal)) throw new SearchToolsError('search aborted', 'WEB_ABORTED')
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

  /** Visible for tests. */
  startedAtMs(): number {
    return this.startedAt
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
    outer: AbortSignal | undefined,
    budgetMs: number,
  ): Promise<SearchResult> {
    const auth = await authHeaders(this.ctx, config.auth.type)
    let lastError: unknown
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      const timeout = AbortSignal.timeout(Math.min(config.requestTimeoutMs, budgetMs))
      const signal = outer === undefined ? timeout : AbortSignal.any([outer, timeout])
      try {
        const pages = await Promise.all(
          Array.from({ length: config.pages }, (_, index) =>
            this.requestPage(instance, query, config, auth, index + 1, signal)),
        )
        const merged = mergePages(pages, limit)
        return merged
      } catch (error) {
        lastError = error
        if (!isRetryable(error) || attempt === config.retries) break
        await sleep(Math.min(500 * 2 ** attempt + Math.random() * 250, 5_000), outer)
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
    const url = new URL(`${normalizeInstanceUrl(instance.url)}/search`)
    const params = new URLSearchParams({ q: query, pageno: String(page) })
    if (config.categories.length > 0) params.set('categories', config.categories.join(','))
    if (config.engines.length > 0) params.set('engines', config.engines.join(','))
    if (config.language.length > 0) params.set('language', config.language)
    params.set('safesearch', String(config.safesearch))
    if (config.timeRange.length > 0) params.set('time_range', config.timeRange)
    const format = config.format === 'html' ? 'html' : 'json'
    params.set('format', format)

    const init: RequestInit = {
      method: config.method,
      headers: { ...auth, accept: 'application/json, text/html;q=0.9' },
      redirect: 'error',
      signal,
    }
    if (config.method === 'GET') {
      url.search = params.toString()
    } else {
      init.body = params.toString()
      init.headers = { ...init.headers, 'content-type': 'application/x-www-form-urlencoded' }
    }

    const response = await this.ctx.fetch(url, {
      ...init,
      ...(config.proxy.length > 0 ? { dispatcher: proxyDispatcher(config.proxy) } : {}),
    } as RequestInit)
    if (response.status === 401 || response.status === 403) {
      throw new SearchToolsError(`SearXNG authentication failed at ${hostOf(url.toString()) ?? 'instance'}`, 'SEARXNG_AUTH')
    }
    if (response.status === 429) {
      throw new SearchToolsError('SearXNG rate limited', 'SEARXNG_RATE_LIMIT')
    }
    if (!response.ok) {
      throw new SearchToolsError(`SearXNG returned HTTP ${response.status}`, response.status >= 500 ? 'SEARXNG_ALL_FAILED' : 'SEARXNG_BAD_RESPONSE')
    }
    const text = await response.text()
    if (config.format === 'auto') {
      if (looksLikeJson(response, text)) {
        try {
          return parseSearxngJson(JSON.parse(text), instance.url, config)
        } catch {
          // Fall through to HTML: some instances serve an HTML challenge with 200.
        }
      }
      return parseSearxngHtml(text, instance.url, config)
    }
    if (config.format === 'html') return parseSearxngHtml(text, instance.url, config)
    try {
      return parseSearxngJson(JSON.parse(text), instance.url, config)
    } catch (error) {
      throw new SearchToolsError('SearXNG JSON response could not be parsed', 'SEARXNG_BAD_RESPONSE', { cause: error })
    }
  }
}

/** Probe `/config`, then fall back to a one-result search. Never echoes credentials. */
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
  const auth = await authHeaders(ctx, config.auth.type)
  const base = normalizeInstanceUrl(instance.url)
  try {
    const response = await ctx.fetch(`${base}/config`, {
      headers: { ...auth, accept: 'application/json' },
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(8_000),
    })
    const latencyMs = ctx.now() - started
    const text = await response.text()
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'SEARXNG_AUTH', message: '认证失败', latencyMs }
    }
    if (response.ok && looksLikeJson(response, text)) {
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
    }
    if (response.ok) {
      return { ok: true, latencyMs, json: false, html: true }
    }
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
  const seen = new Map<string, SearchResult['sources'][number]>()
  const answers: string[] = []
  const notes: string[] = []
  for (const page of pages) {
    if (page.content !== undefined) answers.push(page.content)
    if (page.notes !== undefined) notes.push(...page.notes)
    for (const source of page.sources) {
      if (!seen.has(source.url)) seen.set(source.url, source)
    }
  }
  const sources = [...seen.values()]
  return {
    ...(answers.length > 0 ? { content: [...new Set(answers)].join('\n\n') } : {}),
    sources: sources.slice(0, limit),
    truncated: sources.length > limit,
    ...(notes.length > 0 ? { notes: [...new Set(notes)].slice(0, 8) } : {}),
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

function isRetryable(error: unknown): boolean {
  if (error instanceof SearchToolsError) {
    return error.code === 'SEARXNG_RATE_LIMIT' || error.code === 'SEARXNG_ALL_FAILED'
  }
  return true
}

function isAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) throw new SearchToolsError('search aborted', 'WEB_ABORTED')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new SearchToolsError('search aborted', 'WEB_ABORTED'))
    }, { once: true })
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
