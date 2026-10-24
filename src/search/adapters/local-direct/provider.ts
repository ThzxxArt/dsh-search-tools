/** Local-direct search runtime: fixed engines, fusion, cache, gates, retries, probe. */

import { LRUCache } from 'lru-cache'
import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  CacheStats, ProbeResult, SearchAdapterRuntime, SearchRequest, SearchResult, SearchSource,
} from '../../../core/types.ts'
import { SearchToolsError, errorCode, errorMessage } from '../../../shared/errors.ts'
import { stableKey } from '../../../shared/validation.ts'
import { fuseSources } from './fusion.ts'
import {
  LOCAL_DIRECT_ENGINE_LABELS, acceptLanguageFor, assertFixedOrigin, buildEngineUrl,
} from './engines.ts'
import { parseLocalDirectHtml } from './parse.ts'
import {
  enabledEngines, normalizeLocalDirectConfig, type LocalDirectConfig, type LocalDirectEngine,
} from './schema.ts'
import type { LocalDirectTargetResult, LocalDirectWorkerResult } from './protocol.ts'
import { runLocalDirectWorker } from './transport.ts'

const PROBE_QUERY = 'dsh-search-tools probe'
const MAX_QUERY_CHARS = 500
const RETRY_BASE_MS = 500

/**
 * Engine gates are process-wide, not runtime-instance-wide. A draft probe
 * creates a fresh runtime; sharing the gate prevents probe → live-search bursts
 * from bypassing `minIntervalMs`.
 */
const ENGINE_GATES: { chain: Promise<void>; lastRequestAt: Map<LocalDirectEngine, number> } = {
  chain: Promise.resolve(),
  lastRequestAt: new Map(),
}

export interface LocalDirectRuntimeOptions {
  /** Test seam for the built worker file. */
  workerFile?: URL | string
  /** Test seam; production runs the real worker. */
  runWorker?: typeof runLocalDirectWorker
}

interface SearchExecution {
  result: SearchResult
  succeeded: LocalDirectEngine[]
}

export class LocalDirectRuntime implements SearchAdapterRuntime {
  private cache: LRUCache<string, SearchResult> | undefined
  private cacheMax = -1
  private cacheTtl = -1
  private hits = 0
  private misses = 0

  constructor(
    private readonly ctx: AdapterContext,
    private readonly getRawConfig: () => unknown,
    private readonly options: LocalDirectRuntimeOptions = {},
  ) {}

  private config(): LocalDirectConfig {
    return normalizeLocalDirectConfig(this.getRawConfig())
  }

  private cacheFor(config: LocalDirectConfig): LRUCache<string, SearchResult> | undefined {
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
    return config.enabled && enabledEngines(config).length > 0
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    const execution = await this.execute(request, signal, true)
    return execution.result
  }

  async probe(signal?: AbortSignal): Promise<ProbeResult> {
    const started = this.ctx.now()
    try {
      const execution = await this.execute({ query: PROBE_QUERY, maxResults: 1 }, signal, false)
      return {
        ok: execution.succeeded.length > 0,
        latencyMs: this.ctx.now() - started,
        html: true,
        json: false,
        ...(execution.succeeded.length > 0
          ? { engines: execution.succeeded.map(engine => LOCAL_DIRECT_ENGINE_LABELS[engine]) }
          : {}),
        ...(execution.result.notes === undefined ? {} : { message: execution.result.notes.join('; ') }),
      }
    } catch (error) {
      return {
        ok: false,
        code: errorCode(error, 'LOCAL_DIRECT_PROBE_FAILED'),
        message: errorMessage(error),
        latencyMs: this.ctx.now() - started,
      }
    }
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

  private async execute(
    request: SearchRequest,
    callerSignal: AbortSignal | undefined,
    useCache: boolean,
  ): Promise<SearchExecution> {
    if (callerSignal?.aborted === true) throw abortError(callerSignal)
    const config = this.config()
    if (!config.enabled) throw new SearchToolsError('local-direct adapter is disabled', 'LOCAL_DIRECT_DISABLED')
    const engines = enabledEngines(config)
    if (engines.length === 0) throw new SearchToolsError('no local-direct engine is enabled', 'LOCAL_DIRECT_NOT_CONFIGURED')

    const query = request.query.trim()
    if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
      throw new SearchToolsError(`query must be 1-${MAX_QUERY_CHARS} characters`, 'LOCAL_DIRECT_QUERY_INVALID')
    }
    const requestedLimit = request.maxResults
    const limit = Math.max(1, Math.min(
      config.maxResults,
      typeof requestedLimit === 'number' && Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : config.maxResults,
    ))
    const key = stableKey({
      query,
      limit,
      engines,
      market: config.market,
      safeSearch: config.safeSearch,
      maxPerHost: config.maxPerHost,
      profile: config.profile,
      requestTimeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      proxy: config.proxy,
      includeDomains: config.includeDomains,
      excludeDomains: config.excludeDomains,
    })
    const cache = useCache ? this.cacheFor(config) : undefined
    const cached = cache?.get(key)
    if (cached !== undefined) {
      if ((callerSignal as AbortSignal | undefined)?.aborted === true) throw abortError(callerSignal)
      this.hits++
      return { result: cloneResult(cached), succeeded: [] }
    }
    if (useCache) this.misses++

    const deadlineAt = this.ctx.now() + config.deadlineMs
    const deadline = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      deadline.abort(new Error('local-direct deadline'))
    }, config.deadlineMs)
    timer.unref?.()
    const signal = callerSignal === undefined
      ? deadline.signal
      : AbortSignal.any([callerSignal, deadline.signal])

    const pending = new Set<LocalDirectEngine>(engines)
    const succeeded = new Map<LocalDirectEngine, SearchSource[]>()
    const roundNotes: string[] = []
    const engineNotes = new Map<LocalDirectEngine, string>()
    let lastError: unknown

    const finalize = (): SearchExecution => {
      const fused = fuseSources(
        [...succeeded.entries()].map(([engine, sources]) => ({ engine, sources })),
        limit,
        config.maxPerHost,
      )
      const complete = pending.size === 0 && succeeded.size === engines.length
      // A complete success must not retain a transient failure note from an
      // earlier round. Informational notes from an accepted empty/filtered
      // result may remain, but only note-free complete results are cached.
      const finalNotes = complete
        ? [...engineNotes.values()]
        : [...roundNotes, ...engineNotes.values()]
      const uniqueNotes = [...new Set(finalNotes)].slice(0, 8)
      const result: SearchResult = {
        sources: fused.sources,
        truncated: fused.truncated,
        ...(uniqueNotes.length === 0 ? {} : { notes: uniqueNotes }),
      }
      if (complete && uniqueNotes.length === 0 && fused.sources.length > 0) cache?.set(key, cloneResult(result))
      return { result, succeeded: [...succeeded.keys()] }
    }

    try {
      for (let attempt = 0; attempt <= config.retries && pending.size > 0; attempt++) {
        if (callerSignal !== undefined && callerSignal.aborted) throw abortError(callerSignal)
        if (timedOut || Date.now() >= deadlineAt) {
          if (succeeded.size > 0) break
          throw deadlineError(config.deadlineMs)
        }
        const targets = [...pending].map(engine => {
          const url = buildEngineUrl(engine, query, config).toString()
          assertFixedOrigin(engine, url)
          return { engine, url }
        })
        await this.waitForGates([...pending], config.minIntervalMs, signal)
        let workerResult: LocalDirectWorkerResult
        try {
          workerResult = await (this.options.runWorker ?? runLocalDirectWorker)({
            targets,
            profile: config.profile,
            timeoutMs: config.requestTimeoutMs,
            maxResponseBytes: config.maxResponseBytes,
            proxyUrl: config.proxy,
            locale: acceptLanguageFor(config) ?? '',
          }, {
            timeoutMs: Math.max(1, deadlineAt - this.ctx.now()),
            signal,
            ...(this.options.workerFile === undefined ? {} : { workerFile: this.options.workerFile }),
          })
        } catch (error) {
          if (callerSignal !== undefined && callerSignal.aborted) throw abortError(callerSignal)
          if (isFatalWorkerError(error)) throw error
          if (timedOut || Date.now() >= deadlineAt) {
            if (succeeded.size > 0) break
            throw deadlineError(config.deadlineMs)
          }
          lastError = error
          roundNotes.push(`round ${attempt + 1}: ${errorMessage(error)}`)
          if (attempt < config.retries) await this.sleep(retryDelay(attempt), signal)
          continue
        }

        for (const target of workerResult.targets) {
          if (!pending.has(target.engine)) continue
          const evaluation = this.evaluateTarget(target, config)
          if ('sources' in evaluation) {
            succeeded.set(target.engine, evaluation.sources)
            pending.delete(target.engine)
            if (evaluation.note === undefined) engineNotes.delete(target.engine)
            else engineNotes.set(target.engine, `${LOCAL_DIRECT_ENGINE_LABELS[target.engine]}: ${evaluation.note}`)
          } else {
            lastError = evaluation
            engineNotes.set(target.engine, `${LOCAL_DIRECT_ENGINE_LABELS[target.engine]}: ${evaluation.message}`)
          }
        }
        if (pending.size > 0 && attempt < config.retries) {
          if (callerSignal !== undefined && callerSignal.aborted) throw abortError(callerSignal)
          if (Date.now() + retryDelay(attempt) >= deadlineAt) {
            if (succeeded.size > 0) break
            throw deadlineError(config.deadlineMs)
          }
          await this.sleep(retryDelay(attempt), signal)
        }
      }

      if (callerSignal !== undefined && callerSignal.aborted) throw abortError(callerSignal)
      if ((timedOut || Date.now() >= deadlineAt) && succeeded.size === 0) {
        throw deadlineError(config.deadlineMs)
      }
      if (succeeded.size === 0) {
        const detail = lastError === undefined ? 'no engine returned a result' : errorMessage(lastError)
        throw new SearchToolsError(
          `all local-direct engines failed: ${detail}`,
          'LOCAL_DIRECT_ALL_FAILED',
          lastError === undefined ? undefined : { cause: lastError },
        )
      }
      return finalize()
    } catch (error) {
      if (callerSignal !== undefined && callerSignal.aborted) throw abortError(callerSignal)
      if (isFatalWorkerError(error)) throw error
      if (timedOut || Date.now() >= deadlineAt) {
        if (succeeded.size > 0) return finalize()
        throw deadlineError(config.deadlineMs)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private evaluateTarget(
    target: LocalDirectTargetResult,
    config: LocalDirectConfig,
  ): { sources: SearchSource[]; note?: string } | SearchToolsError {
    if (!target.ok) {
      return new SearchToolsError(
        target.message ?? target.code ?? 'engine request failed',
        target.code ?? 'LOCAL_DIRECT_NETWORK',
      )
    }
    if (target.status === undefined || !Number.isInteger(target.status) || target.status < 200 || target.status >= 300) {
      return new SearchToolsError(`engine returned HTTP ${target.status ?? 'unknown'}`, 'LOCAL_DIRECT_HTTP')
    }
    // DDG commonly answers challenges/rate limits with 202 (and some engines
    // use 204); these are not a successful result page.
    if (target.status === 202 || target.status === 204) {
      return new SearchToolsError(
        `engine returned HTTP ${target.status} (challenge or rate limit)`,
        'LOCAL_DIRECT_HTTP',
      )
    }
    if (target.body === undefined || target.body.byteLength === 0) {
      return new SearchToolsError('engine returned an empty body', 'LOCAL_DIRECT_EMPTY')
    }
    let html: string
    try {
      html = decodeBody(target.body, target.headers?.['content-type'])
    } catch (error) {
      return new SearchToolsError(`engine body could not be decoded: ${errorMessage(error)}`, 'LOCAL_DIRECT_DECODE')
    }
    let parsed: ReturnType<typeof parseLocalDirectHtml>
    try {
      parsed = parseLocalDirectHtml(target.engine, html, {
        includeDomains: config.includeDomains,
        excludeDomains: config.excludeDomains,
      })
    } catch (error) {
      return new SearchToolsError(
        `engine HTML could not be parsed: ${errorMessage(error)}`,
        'LOCAL_DIRECT_PARSE',
        { cause: error },
      )
    }
    // A page with parsed hits that are all removed by domain filters is a
    // successful empty engine result. A 200 page with no parsed hits at all is
    // more likely a challenge/consent/markup change; keep that explicit.
    if (parsed.rawSources.length === 0) {
      return new SearchToolsError('engine returned no parseable results', 'LOCAL_DIRECT_EMPTY')
    }
    const note = parsed.sources.length === 0
      ? 'all results were removed by the domain filters'
      : undefined
    return {
      sources: parsed.sources.map(source => ({
        url: source.url,
        ...(source.title === undefined ? {} : { title: source.title }),
        ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
        ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
      })),
      ...(note === undefined ? {} : { note }),
    }
  }

  private async waitForGates(
    engines: readonly LocalDirectEngine[],
    intervalMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (intervalMs <= 0 || engines.length === 0) return
    const previous = ENGINE_GATES.chain
    let release!: () => void
    ENGINE_GATES.chain = new Promise<void>((resolve) => { release = resolve })
    try {
      await waitForGate(previous, signal)
      const now = this.ctx.now()
      const waitUntil = Math.max(...engines.map(engine => (ENGINE_GATES.lastRequestAt.get(engine) ?? 0) + intervalMs))
      const wait = waitUntil - now
      if (wait > 0) await this.sleep(wait, signal)
      const startedAt = this.ctx.now()
      for (const engine of engines) ENGINE_GATES.lastRequestAt.set(engine, startedAt)
    } finally {
      release()
    }
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return
    if (signal.aborted) throw abortError(signal)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
    })
  }
}

function decodeBody(bytes: Uint8Array, contentType: string | undefined): string {
  const match = /charset\s*=\s*"?([^";\s]+)/iu.exec(contentType ?? '')
  try {
    return new TextDecoder(match?.[1] ?? 'utf-8', { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

function cloneResult(result: SearchResult, notes = result.notes): SearchResult {
  return {
    ...(result.content === undefined ? {} : { content: result.content }),
    sources: result.sources.map(source => ({ ...source })),
    truncated: result.truncated,
    ...(notes === undefined ? {} : { notes: [...notes] }),
  }
}

function retryDelay(attempt: number): number {
  return Math.min(2_000, RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250))
}

/** Wait for the previous gate holder, but let caller cancellation win immediately. */
async function waitForGate(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    void previous.then(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }, (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
  })
}

/** Native-runtime and invalid-target failures cannot be fixed by retrying. */
function isFatalWorkerError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  return code === 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE' || code === 'LOCAL_DIRECT_INVALID_TARGET'
}

function abortError(signal: AbortSignal | undefined): SearchToolsError {
  return new SearchToolsError('search aborted', 'WEB_ABORTED', { cause: signal?.reason })
}

function deadlineError(deadlineMs: number): SearchToolsError {
  return new SearchToolsError(`local-direct search deadline exceeded after ${deadlineMs} ms`, 'LOCAL_DIRECT_DEADLINE')
}
