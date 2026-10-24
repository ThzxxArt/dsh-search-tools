/** Jina Reader runtime: POST one public URL to a Reader-compatible endpoint. */

import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  FetchAdapterRuntime, FetchRequest, FetchResult, ProbeResult,
} from '../../../core/types.ts'
import { SearchToolsError, errorCode, errorMessage } from '../../../shared/errors.ts'
import {
  normalizeJinaEndpoint, normalizeJinaReaderConfig,
  type JinaReaderConfig, type JinaResponseMode,
} from './schema.ts'
import { resolveJinaTarget } from './target.ts'

const API_KEY_REF = 'JINA_API_KEY'
const CLIENT_USER_AGENT = 'dsh-search-tools/0.1.7 (+https://github.com/ThzxxArt/dsh-search-tools)'
const MAX_URL_LENGTH = 2_048
/** Bound a hostile/accidental Retry-After value before exposing it as a hint. */
const MAX_RETRY_AFTER_MS = 3_600_000

export class JinaReaderRuntime implements FetchAdapterRuntime {
  constructor(
    private readonly ctx: AdapterContext,
    private readonly getRawConfig: () => unknown,
  ) {}

  private config(): JinaReaderConfig {
    return normalizeJinaReaderConfig(this.getRawConfig())
  }

  available(): boolean {
    return this.config().enabled
  }

  async fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult> {
    const config = this.config()
    if (!config.enabled) throw new SearchToolsError('Jina Reader adapter is disabled', 'JINA_DISABLED')
    if (request.url.length > MAX_URL_LENGTH) {
      throw new SearchToolsError(`target URL exceeds ${MAX_URL_LENGTH} characters`, 'JINA_INVALID_TARGET')
    }
    if (isAborted(signal)) throw abortError(signal)

    const timeout = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      timeout.abort(new Error('Jina Reader request timed out'))
    }, config.timeoutMs)
    timer.unref?.()
    const requestSignal = signal === undefined
      ? timeout.signal
      : AbortSignal.any([signal, timeout.signal])

    try {
      if (isAborted(signal)) throw abortError(signal)
      const target = await resolveJinaTarget(request.url, requestSignal)
      if (requestSignal.aborted) throw requestSignal.reason ?? new Error('aborted')
      const endpoint = safeEndpoint(config.endpoint)
      const headers = await this.headers(config, requestSignal)
      const body = new URLSearchParams({ url: target.toString() }).toString()
      const response = await this.ctx.fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: requestSignal,
      })
      if (response.status === 401 || response.status === 403) {
        await discard(response)
        throw new SearchToolsError(`Jina Reader rejected the credentials (HTTP ${response.status})`, 'JINA_AUTH')
      }
      if (response.status === 429) {
        const after = retryAfterMs(response)
        await discard(response)
        throw new SearchToolsError(
          'Jina Reader rate limit exceeded',
          'JINA_RATE_LIMIT',
          after === undefined ? undefined : { retryAfterMs: after },
        )
      }
      if (!response.ok) {
        await discard(response)
        throw new SearchToolsError(`Jina Reader returned HTTP ${response.status}`, 'JINA_HTTP')
      }

      const raw = await readResponseText(response, config.maxResponseBytes)
      const payload = parsePayload(raw, retryAfterMs(response))
      const statusCode = targetStatus(payload)
      const data = isRecord(payload.data) ? payload.data : {}
      const modeField = responseField(config.responseMode)
      const returnedUrl = returnedUrlOf(data.url, target)
      const content = data[modeField]
      if (typeof content !== 'string') {
        // Jina derives target warnings from its content branch. If a target
        // failed hard enough that no selected-mode body exists, preserve the
        // target status instead of mislabeling it as a Reader protocol error.
        if (statusCode >= 300) {
          return {
            url: returnedUrl,
            statusCode,
            body: { kind: responseKind(config.responseMode), content: '' },
            truncated: false,
          }
        }
        throw new SearchToolsError(`Jina Reader response has no data.${modeField}`, 'JINA_BAD_RESPONSE')
      }
      const clipped = clipCodePoints(content, config.maxBodyChars, config.responseMode === 'html')
      return {
        url: returnedUrl,
        statusCode,
        body: {
          kind: responseKind(config.responseMode),
          content: clipped.text,
        },
        truncated: clipped.truncated,
      }
    } catch (error) {
      if (timedOut) {
        throw new SearchToolsError(`Jina Reader timed out after ${config.timeoutMs} ms`, 'JINA_TIMEOUT')
      }
      if (isAborted(signal) && !(error instanceof SearchToolsError)) throw abortError(signal)
      if (isAborted(signal) && errorCode(error, '') === 'WEB_ABORTED') throw abortError(signal)
      if (error instanceof SearchToolsError) throw error
      throw new SearchToolsError(`Jina Reader request failed: ${errorMessage(error)}`, 'JINA_NETWORK', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  async probe(url: string, signal?: AbortSignal): Promise<ProbeResult> {
    const started = this.ctx.now()
    try {
      const result = await this.fetch({ url }, signal)
      const ok = result.statusCode >= 200 && result.statusCode < 300
      return {
        ok,
        latencyMs: this.ctx.now() - started,
        statusCode: result.statusCode,
        contentType: result.body.kind,
        readable: result.body.content.length > 0,
        ...(ok ? {} : { message: `HTTP ${result.statusCode}` }),
      }
    } catch (error) {
      return {
        ok: false,
        code: 'JINA_PROBE_FAILED',
        message: `${errorCode(error, 'JINA_PROBE_FAILED')}: ${errorMessage(error)}`,
        latencyMs: this.ctx.now() - started,
      }
    }
  }

  private async headers(config: JinaReaderConfig, signal: AbortSignal): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': CLIENT_USER_AGENT,
      'x-respond-with': config.responseMode,
      // X-Timeout is the Reader's wait budget, not a hard deadline. Leave one
      // second for the local AbortController to enforce the actual deadline.
      'x-timeout': String(Math.max(1, Math.floor(config.timeoutMs / 1_000) - 1)),
      'x-retain-images': config.retainImages,
      'x-retain-links': config.retainLinks,
    }
    const key = await this.resolveApiKey(signal)
    if (key !== undefined) headers.authorization = `Bearer ${key}`
    if (config.engine !== 'auto') headers['x-engine'] = config.engine
    if (config.waitForSelector.length > 0) headers['x-wait-for-selector'] = config.waitForSelector
    if (config.targetSelector.length > 0) headers['x-target-selector'] = config.targetSelector
    if (config.removeSelector.length > 0) headers['x-remove-selector'] = config.removeSelector
    if (config.includeIframes) headers['x-with-iframe'] = 'true'
    if (config.includeShadowDom) headers['x-with-shadow-dom'] = 'true'
    if (config.noCache) headers['x-no-cache'] = 'true'
    if (config.respectRobots) headers['x-robots-txt'] = 'dsh-search-tools'
    if (config.upstreamProxy === 'auto') headers['x-proxy'] = 'auto'
    if (config.locale.length > 0) headers['x-locale'] = config.locale
    if (config.userAgent.length > 0) headers['x-user-agent'] = config.userAgent
    return headers
  }

  private async resolveApiKey(signal: AbortSignal): Promise<string | undefined> {
    // Credential services are local but may mount late or hang. Race them with
    // the same hard deadline as the network request so the timeout is complete.
    const pending = Promise.resolve(this.ctx.getCredentials()?.resolve(API_KEY_REF))
    const stored = await withAbort(pending, signal)
    if (stored !== undefined && stored.value.length > 0) return stored.value
    const env = this.ctx.env[API_KEY_REF]
    return env !== undefined && env.length > 0 ? env : undefined
  }
}

function responseField(mode: JinaResponseMode): 'content' | 'html' | 'text' {
  return mode === 'html' ? 'html' : mode === 'text' ? 'text' : 'content'
}

function responseKind(mode: JinaResponseMode): 'html' | 'text' {
  return mode === 'html' ? 'html' : 'text'
}

function returnedUrlOf(value: unknown, fallback: URL): string {
  if (typeof value !== 'string') return fallback.toString()
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback.toString()
    // Reader output is display data; never echo credentials that were not in
    // the original (credential-bearing targets are rejected earlier).
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return fallback.toString()
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => { finish(() => { reject(abortError(signal)) }) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { finish(() => { resolve(value) }) },
      error => { finish(() => { reject(error) }) },
    )
  })
}

function safeEndpoint(raw: string): string {
  try {
    return normalizeJinaEndpoint(raw)
  } catch (error) {
    throw new SearchToolsError(errorMessage(error), 'JINA_ENDPOINT_INVALID', { cause: error })
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function abortError(signal: AbortSignal | undefined): SearchToolsError {
  return new SearchToolsError('Jina Reader request aborted', 'WEB_ABORTED', { cause: signal?.reason })
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new SearchToolsError(`Jina Reader response exceeds ${maxBytes} bytes`, 'JINA_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new SearchToolsError(`Jina Reader response exceeds ${maxBytes} bytes`, 'JINA_RESPONSE_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Clip without splitting a UTF-16 surrogate pair. For HTML, prefer the last
 * complete tag boundary; the result is still a best-effort partial document.
 */
function clipCodePoints(value: string, max: number, html = false): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  let end = max
  if (html) {
    const tagBoundary = value.lastIndexOf('>', end - 1)
    if (tagBoundary >= 0) end = tagBoundary + 1
  }
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { text: value.slice(0, end), truncated: true }
}

function parsePayload(raw: string, retryAfter: number | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error('not an object')
    const code = parsed.code
    if (typeof code === 'number' && code >= 400) {
      if (code === 401 || code === 403) throw new SearchToolsError('Jina Reader rejected the credentials', 'JINA_AUTH')
      if (code === 429) {
        throw new SearchToolsError(
          'Jina Reader rate limit exceeded',
          'JINA_RATE_LIMIT',
          retryAfter === undefined ? undefined : { retryAfterMs: retryAfter },
        )
      }
      throw new SearchToolsError(`Jina Reader returned code ${code}`, 'JINA_HTTP')
    }
    return parsed
  } catch (error) {
    if (error instanceof SearchToolsError) throw error
    throw new SearchToolsError('Jina Reader returned invalid JSON', 'JINA_BAD_RESPONSE', { cause: error })
  }
}

function targetStatus(payload: Record<string, unknown>): number {
  const data = isRecord(payload.data) ? payload.data : {}
  // Jina's official FormattedPage adds target failures to `warning` and also
  // exposes `httpStatus`. If a self-hosted compatibility field is present too,
  // the warning must win: some compatible servers always set statusCode to 200
  // while warning carries the real target failure.
  if (typeof data.warning === 'string') {
    const match = /Target URL returned error (\d{3})/i.exec(data.warning)
    if (match?.[1] !== undefined) {
      const code = Number(match[1])
      if (code >= 100 && code <= 599) return code
    }
  }
  if (typeof data.httpStatus === 'number' && Number.isInteger(data.httpStatus)
    && data.httpStatus >= 100 && data.httpStatus <= 599) {
    return data.httpStatus
  }
  if (typeof data.statusCode === 'number' && Number.isInteger(data.statusCode)
    && data.statusCode >= 100 && data.statusCode <= 599) {
    return data.statusCode
  }
  return 200
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1_000))
  }
  const date = Date.parse(raw)
  if (Number.isFinite(date)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()))
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
