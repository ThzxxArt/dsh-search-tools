/** Local-direct search runtime: fixed engines, per-engine workers, fusion, cache, gates, retries, probe. */

import { LRUCache } from 'lru-cache'
import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  CacheStats, ProbeEngineResult, ProbeResult, SearchAdapterRuntime, SearchRequest, SearchResult, SearchSource,
} from '../../../core/types.ts'
import { SearchToolsError, errorCode, errorMessage } from '../../../shared/errors.ts'
import { redactText } from '../../../shared/redact.ts'
import { stableKey } from '../../../shared/validation.ts'
import { fuseSources } from './fusion.ts'
import {
  LOCAL_DIRECT_ENGINE_DESCRIPTORS, LOCAL_DIRECT_ENGINE_LABELS, acceptLanguageFor, assertFixedOrigin,
  buildEngineUrl,
} from './engines.ts'
import {
  enabledEngines, normalizeLocalDirectConfig, type LocalDirectConfig, type LocalDirectEngine,
} from './schema.ts'
import type { LocalDirectTargetResult } from './protocol.ts'
import { runLocalDirectWorker } from './transport.ts'

const PROBE_QUERY = 'dsh-search-tools probe'
const MAX_QUERY_CHARS = 500
const RETRY_BASE_MS = 500

/**
 * Engine gates are process-wide, not runtime-instance-wide. A draft probe
 * creates a fresh runtime; sharing each engine's gate prevents probe →
 * live-search bursts from bypassing `minIntervalMs`. Engines do not share a
 * gate: a slow engine must not delay a different engine.
 */
const ENGINE_GATES: {
  chains: Map<LocalDirectEngine, Promise<void>>
  lastRequestAt: Map<LocalDirectEngine, number>
} = {
  chains: new Map(),
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
  engineResults: ProbeEngineResult[]
}

interface EngineState {
  engine: LocalDirectEngine
  status: 'pending' | 'succeeded' | 'failed'
  sources: SearchSource[]
  startedAt?: number
  latencyMs?: number
  note?: string
  error?: unknown
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
      const failed = execution.engineResults.filter(engine => !engine.ok)
      return {
        ok: execution.succeeded.length > 0,
        latencyMs: this.ctx.now() - started,
        html: true,
        json: false,
        partial: execution.succeeded.length > 0 && failed.length > 0,
        engineResults: execution.engineResults,
        ...(failed.length === 0 ? {} : { failedEngines: failed.map(engine => engine.engine) }),
        ...(execution.succeeded.length > 0
          ? { engines: execution.succeeded.map(engine => LOCAL_DIRECT_ENGINE_LABELS[engine]) }
          : {}),
        ...(execution.result.notes === undefined ? {} : { message: execution.result.notes.join('; ') }),
      }
    } catch (error) {
      return {
        ok: false,
        code: errorCode(error, 'LOCAL_DIRECT_PROBE_FAILED'),
        message: redactText(errorMessage(error)),
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
      if (signalAborted(callerSignal)) throw abortError(callerSignal)
      this.hits++
      return { result: cloneResult(cached), succeeded: [], engineResults: [] }
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

    const states = new Map<LocalDirectEngine, EngineState>(
      engines.map(engine => [engine, { engine, status: 'pending', sources: [] }]),
    )

    const finalize = (): SearchExecution => {
      const successful = [...states.values()].filter(state => state.status === 'succeeded')
      const fused = fuseSources(
        successful.map(state => ({ engine: state.engine, sources: state.sources })),
        limit,
        config.maxPerHost,
      )
      const notes = [...new Set(
        [...states.values()]
          .map(state => state.note)
          .filter((note): note is string => note !== undefined && note.length > 0),
      )].slice(0, 8)
      const complete = successful.length === engines.length
      const result: SearchResult = {
        sources: fused.sources,
        truncated: fused.truncated,
        ...(notes.length === 0 ? {} : { notes }),
      }
      // Only a complete, note-free, non-empty result is stable enough to cache.
      if (complete && notes.length === 0 && fused.sources.length > 0) {
        cache?.set(key, cloneResult(result))
      }
      const engineResults: ProbeEngineResult[] = [...states.values()].map(state => ({
        engine: LOCAL_DIRECT_ENGINE_LABELS[state.engine],
        ok: state.status === 'succeeded',
        latencyMs: state.latencyMs ?? 0,
        ...(state.error === undefined
          ? {}
          : {
              code: errorCode(state.error, 'LOCAL_DIRECT_FAILED'),
              message: redactText(errorMessage(state.error)),
            }),
        ...(state.note === undefined ? {} : { message: state.note }),
      }))
      return { result, succeeded: successful.map(state => state.engine), engineResults }
    }

    try {
      const tasks = engines.map(engine => this.runEngine(engine, query, config, signal, deadlineAt, states))
      const settled = await Promise.allSettled(tasks)
      const rejected = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
      if (signalAborted(callerSignal)) throw abortError(callerSignal)
      if (rejected !== undefined) {
        if (isFatalWorkerError(rejected.reason)) throw rejected.reason
        if (timedOut || this.ctx.now() >= deadlineAt) {
          if (successCount(states) > 0) {
            markDeadline(states, config.deadlineMs, this.ctx.now())
            return finalize()
          }
          throw deadlineError(config.deadlineMs)
        }
        throw rejected.reason
      }
      if (timedOut || this.ctx.now() >= deadlineAt) {
        if (successCount(states) === 0) throw deadlineError(config.deadlineMs)
        // A successful engine may have finished just before the deadline.
        markDeadline(states, config.deadlineMs, this.ctx.now())
        return finalize()
      }
      if (successCount(states) === 0) {
        const failure = [...states.values()].find(state => state.error !== undefined)?.error
        const detail = failure === undefined ? 'no engine returned a result' : errorMessage(failure)
        throw new SearchToolsError(
          `all local-direct engines failed: ${redactText(detail)}`,
          'LOCAL_DIRECT_ALL_FAILED',
          failure === undefined ? undefined : { cause: failure },
        )
      }
      return finalize()
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * One worker per engine. A hanging/failing engine settles its own state and
   * cannot discard another engine's already-successful result.
   */
  private async runEngine(
    engine: LocalDirectEngine,
    query: string,
    config: LocalDirectConfig,
    signal: AbortSignal,
    deadlineAt: number,
    states: ReadonlyMap<LocalDirectEngine, EngineState>,
  ): Promise<void> {
    const state = states.get(engine)
    if (state === undefined) return
    state.startedAt = this.ctx.now()
    let failure: unknown
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      if (signal.aborted) throw abortError(signal)
      if (this.ctx.now() >= deadlineAt) break
      const url = buildEngineUrl(engine, query, config).toString()
      assertFixedOrigin(engine, url)
      try {
        await this.waitForEngineGate(engine, config.minIntervalMs, signal)
        if (signal.aborted) throw abortError(signal)
        const remaining = Math.max(1, deadlineAt - this.ctx.now())
        const descriptor = LOCAL_DIRECT_ENGINE_DESCRIPTORS[engine]
        const worker = (this.options.runWorker ?? runLocalDirectWorker)({
          targets: [{ engine, url }],
          profile: descriptor.transportProfile ?? config.profile,
          timeoutMs: config.requestTimeoutMs,
          maxResponseBytes: config.maxResponseBytes,
          proxyUrl: config.proxy,
          locale: acceptLanguageFor(config) ?? '',
        }, {
          timeoutMs: remaining,
          signal,
          ...(this.options.workerFile === undefined ? {} : { workerFile: this.options.workerFile }),
        })
        const workerResult = await abortable(worker, signal)
        const target = workerResult.targets.find(item => item.engine === engine)
        if (target === undefined) {
          failure = new SearchToolsError(
            `worker returned no result for ${engine}`,
            'LOCAL_DIRECT_INVALID_TARGET',
          )
        } else {
          const evaluation = this.evaluateTarget(target, config)
          if ('sources' in evaluation) {
            state.status = 'succeeded'
            state.sources = evaluation.sources
            state.latencyMs = this.ctx.now() - state.startedAt
            if (evaluation.note === undefined) delete state.note
            else state.note = `${LOCAL_DIRECT_ENGINE_LABELS[engine]}: ${redactText(evaluation.note)}`
            return
          }
          failure = evaluation
        }
      } catch (error) {
        if (signal.aborted) throw abortError(signal)
        if (isFatalWorkerError(error)) throw error
        failure = error
      }

      if (isFatalWorkerError(failure)) throw failure
      const retryAfter = failure instanceof SearchToolsError ? failure.retryAfterMs : undefined
      const delay = Math.max(retryDelay(attempt), Math.min(5_000, retryAfter ?? 0))
      if (attempt < config.retries && this.ctx.now() + delay < deadlineAt) {
        await this.sleep(delay, signal)
        continue
      }
      break
    }

    state.status = 'failed'
    state.error = failure
    state.latencyMs = this.ctx.now() - state.startedAt
    state.note = `${LOCAL_DIRECT_ENGINE_LABELS[engine]}: ${redactText(
      failure === undefined ? 'engine did not return a result' : errorMessage(failure),
    )}`
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
    if (target.status === 429) {
      const retryAfterMs = retryAfterOf(target.headers?.['retry-after'])
      return new SearchToolsError(
        'engine rate limited the request',
        'LOCAL_DIRECT_HTTP',
        retryAfterMs === undefined ? undefined : { retryAfterMs },
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
    const descriptor = LOCAL_DIRECT_ENGINE_DESCRIPTORS[target.engine]
    if (descriptor === undefined) {
      return new SearchToolsError(`unknown local-direct engine: ${String(target.engine)}`, 'LOCAL_DIRECT_INVALID_TARGET')
    }
    let parsed: ReturnType<typeof descriptor.parse>
    try {
      parsed = descriptor.parse(html, {
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
    // more likely a challenge/consent/markup change, unless the engine returns
    // its explicit no-results page.
    if (parsed.rawSources.length === 0) {
      if (descriptor.noResults(html)) {
        return { sources: [], note: 'engine returned no results' }
      }
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

  private async waitForEngineGate(
    engine: LocalDirectEngine,
    intervalMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (intervalMs <= 0) return
    const previous = ENGINE_GATES.chains.get(engine) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    ENGINE_GATES.chains.set(engine, current)
    try {
      await waitForGate(previous, signal)
      const now = this.ctx.now()
      const waitUntil = (ENGINE_GATES.lastRequestAt.get(engine) ?? 0) + intervalMs
      const wait = waitUntil - now
      if (wait > 0) await this.sleep(wait, signal)
      ENGINE_GATES.lastRequestAt.set(engine, this.ctx.now())
    } finally {
      release()
    }
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return
    if (signal.aborted) throw abortError(signal)
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }, ms)
      const onAbort = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanup()
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Preserve a successful engine's result while naming engines cut off by the deadline. */
function markDeadline(
  states: ReadonlyMap<LocalDirectEngine, EngineState>,
  deadlineMs: number,
  now = Date.now(),
): void {
  for (const state of states.values()) {
    if (state.status !== 'pending') continue
    state.status = 'failed'
    state.error = deadlineError(deadlineMs)
    state.latencyMs = state.startedAt === undefined ? deadlineMs : Math.max(0, now - state.startedAt)
    state.note = `${LOCAL_DIRECT_ENGINE_LABELS[state.engine]}: deadline exceeded after ${deadlineMs} ms`
  }
}

function successCount(states: ReadonlyMap<LocalDirectEngine, EngineState>): number {
  return [...states.values()].filter(state => state.status === 'succeeded').length
}

/** Wait for a worker promise, but let cancellation settle it immediately. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    if (signal.aborted) onAbort()
  })
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

function retryAfterOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, Math.round(seconds * 1_000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(5_000, Math.max(0, date - Date.now()))
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
