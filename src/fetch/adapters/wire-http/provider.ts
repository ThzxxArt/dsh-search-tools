/** Local browser-grade HTTP runtime with pinned egress, Readability, and PDF text. */

import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  FetchAdapterRuntime, FetchRequest, FetchResult, ProbeResult,
} from '../../../core/types.ts'
import { SearchToolsError, errorCode, errorMessage } from '../../../shared/errors.ts'
import { displayUrl } from '../../../shared/url.ts'
import {
  resolvePublicTarget,
  type PublicAddressResolver,
  type PublicTargetCodes,
} from '../../../shared/public-target.ts'
import { extractReadable } from '../readable-http/readability.ts'
import { EgressGuard } from './egress-proxy.ts'
import { extractPdfText, type PdfExtraction } from './pdf.ts'
import { normalizeWireHttpConfig, type WireHttpConfig } from './schema.ts'
import { runWireWorker } from './transport.ts'
import type { WireWorkerResult } from './protocol.ts'

const WIRE_CODES: PublicTargetCodes = {
  invalid: 'WIRE_INVALID_TARGET',
  blocked: 'WIRE_TARGET_BLOCKED',
  unresolved: 'WIRE_TARGET_UNRESOLVED',
  label: 'target',
}

export interface WireHttpRuntimeOptions {
  /** Test seam; production uses the system resolver. */
  resolver?: PublicAddressResolver
  /** Test seam for the built worker file. */
  workerFile?: URL | string
  /** Test seam; production runs the real one-request worker. */
  runWorker?: typeof runWireWorker
  /** Test seam; production uses PDF.js. */
  extractPdf?: typeof extractPdfText
}

export class WireHttpRuntime implements FetchAdapterRuntime {
  constructor(
    private readonly ctx: AdapterContext,
    private readonly getRawConfig: () => unknown,
    private readonly options: WireHttpRuntimeOptions = {},
  ) {}

  private config(): WireHttpConfig {
    return normalizeWireHttpConfig(this.getRawConfig())
  }

  available(): boolean {
    return this.config().enabled
  }

  async fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult> {
    const config = this.config()
    if (!config.enabled) throw new SearchToolsError('wire-http adapter is disabled', 'WIRE_DISABLED')
    if (signal?.aborted === true) throw abortError(signal)

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('wire-http timed out'))
    }, config.timeoutMs)
    timer.unref?.()
    const onCallerAbort = (): void => { controller.abort(signal?.reason) }
    signal?.addEventListener('abort', onCallerAbort, { once: true })

    const guard = new EgressGuard(this.options.resolver === undefined ? {} : { resolver: this.options.resolver })
    try {
      // Resolve the initial URL before launching native code. The guard repeats
      // the check for every redirect hop, including the first one.
      const target = await resolvePublicTarget(request.url, controller.signal, this.options.resolver, WIRE_CODES)
      const proxyUrl = await guard.start()
      const workerResult = await (this.options.runWorker ?? runWireWorker)({
        url: target.url.toString(),
        profile: config.profile,
        timeoutMs: config.timeoutMs,
        maxRedirects: config.maxRedirects,
        maxResponseBytes: config.maxResponseBytes,
        proxyUrl,
        locale: config.locale,
      }, {
        timeoutMs: config.timeoutMs,
        signal: controller.signal,
        ...(this.options.workerFile === undefined ? {} : { workerFile: this.options.workerFile }),
      })
      return await this.resultOf(workerResult, target.url, config, controller.signal)
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (timedOut) {
        throw new SearchToolsError(`wire-http timed out after ${config.timeoutMs} ms`, 'WIRE_TIMEOUT', { cause: error })
      }
      if (error instanceof SearchToolsError) throw error
      throw new SearchToolsError(`wire-http request failed: ${errorMessage(error)}`, 'WIRE_NETWORK', { cause: error })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
      await guard.close().catch(() => {})
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
        code: 'WIRE_PROBE_FAILED',
        message: `${errorCode(error, 'WIRE_PROBE_FAILED')}: ${errorMessage(error)}`,
        latencyMs: this.ctx.now() - started,
      }
    }
  }

  private async resultOf(
    worker: WireWorkerResult,
    requested: URL,
    config: WireHttpConfig,
    signal: AbortSignal,
  ): Promise<FetchResult> {
    if (signal.aborted) throw abortError(signal)
    const bytes = worker.body instanceof Uint8Array ? worker.body : new Uint8Array(worker.body as ArrayBuffer)
    const contentType = (worker.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    const finalUrl = safeReturnedUrl(worker.url, requested)
    const status = validStatus(worker.status)
    const isPdf = contentType === 'application/pdf' || startsWith(bytes, '%PDF-')
    if (isPdf) {
      if (!config.pdf) {
        throw new SearchToolsError('PDF responses are disabled for wire-http', 'WIRE_UNSUPPORTED_CONTENT')
      }
      const extraction = await this.pdfOf(bytes, config, signal)
      if (signal.aborted) throw abortError(signal)
      if (extraction.text.length === 0) {
        throw new SearchToolsError('PDF has no extractable text layer', 'WIRE_PDF_UNREADABLE')
      }
      return {
        url: finalUrl,
        statusCode: status,
        body: { kind: 'text', content: extraction.text },
        truncated: extraction.truncated,
      }
    }

    if (bytes.length === 0) {
      if (status >= 400) return { url: finalUrl, statusCode: status, body: { kind: 'text', content: '' }, truncated: false }
      throw new SearchToolsError('wire-http received an empty response body', 'WIRE_EMPTY_BODY')
    }

    const decoded = decodeBody(bytes, worker.headers['content-type'])
    const text = clipCodePoints(decoded.text, config.maxBodyChars)
    const html = contentType === 'text/html'
      || contentType === 'application/xhtml+xml'
      || looksLikeHtml(bytes)

    if (html) {
      if (!config.readability) {
        return {
          url: finalUrl,
          statusCode: status,
          body: { kind: 'html', content: text.text },
          truncated: decoded.truncated || text.truncated,
        }
      }
      const extraction = await this.readableOf(text.text, finalUrl, config)
      if (signal.aborted) throw abortError(signal)
      if (extraction === undefined) {
        if (config.failOpen) {
          return {
            url: finalUrl,
            statusCode: status,
            body: { kind: 'html', content: text.text },
            truncated: decoded.truncated || text.truncated,
          }
        }
        throw new SearchToolsError('page could not be reduced to readable content', 'WIRE_UNREADABLE')
      }
      const body = extraction.html !== undefined
        ? { kind: 'html' as const, content: extraction.html }
        : { kind: 'text' as const, content: extraction.text ?? '' }
      return {
        url: finalUrl,
        statusCode: status,
        body,
        truncated: decoded.truncated || text.truncated || extraction.truncated,
      }
    }

    if (!isTextual(contentType, bytes)) {
      throw new SearchToolsError(
        `wire-http does not decode ${contentType || 'this binary content'} responses`,
        'WIRE_UNSUPPORTED_CONTENT',
      )
    }
    if (text.text.trim().length === 0 && status < 400) {
      throw new SearchToolsError('wire-http received an empty decoded body', 'WIRE_EMPTY_BODY')
    }
    return {
      url: finalUrl,
      statusCode: status,
      body: { kind: 'text', content: text.text },
      truncated: decoded.truncated || text.truncated,
    }
  }

  private async readableOf(content: string, url: string, config: WireHttpConfig) {
    try {
      return await extractReadable(content, url, {
        minArticleChars: config.minArticleChars,
        maxArticleChars: config.maxArticleChars,
        maxBodyChars: config.maxBodyChars,
      })
    } catch (error) {
      this.ctx.logger.warn('wire-http readability failed for %s: %s', displayUrl(url), errorMessage(error))
      return undefined
    }
  }

  private async pdfOf(bytes: Uint8Array, config: WireHttpConfig, signal: AbortSignal): Promise<PdfExtraction> {
    try {
      return await (this.options.extractPdf ?? extractPdfText)(
        bytes,
        config.maxPdfPages,
        config.maxBodyChars,
        signal,
      )
    } catch (error) {
      if (signal.aborted || errorCode(error, '') === 'WEB_ABORTED') throw abortError(signal)
      if (error instanceof SearchToolsError) throw error
      throw new SearchToolsError(`PDF text extraction failed: ${errorMessage(error)}`, 'WIRE_PDF_INVALID', { cause: error })
    }
  }
}

function decodeBody(bytes: Uint8Array, contentType: string | undefined): { text: string; truncated: boolean } {
  const bom = bomEncoding(bytes)
  const charset = bom ?? charsetOf(contentType)
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset, { fatal: false })
  } catch {
    decoder = new TextDecoder('utf-8', { fatal: false })
  }
  return { text: decoder.decode(bytes), truncated: false }
}

function bomEncoding(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return undefined
}

function charsetOf(contentType: string | undefined): string {
  const match = /charset\s*=\s*"?([^";\s]+)/iu.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase() || 'utf-8'
}

function isTextual(contentType: string, bytes: Uint8Array): boolean {
  if (contentType.length === 0) return !looksBinary(bytes)
  return contentType.startsWith('text/')
    || contentType === 'application/json'
    || contentType === 'application/ld+json'
    || contentType === 'application/xml'
    || contentType === 'application/javascript'
    || contentType.endsWith('+json')
    || contentType.endsWith('+xml')
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512))
  return sample.includes(0)
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256)).trimStart().toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body')
}

function startsWith(bytes: Uint8Array, prefix: string): boolean {
  const expected = new TextEncoder().encode(prefix)
  if (bytes.length < expected.length) return false
  return expected.every((value, index) => bytes[index] === value)
}

function validStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 502
}

function safeReturnedUrl(raw: string, fallback: URL): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback.toString()
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return fallback.toString()
  }
}

function clipCodePoints(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  let end = max
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { text: value.slice(0, end), truncated: true }
}

function abortError(signal: AbortSignal): SearchToolsError {
  return new SearchToolsError('wire-http request aborted', 'WEB_ABORTED', { cause: signal.reason })
}
