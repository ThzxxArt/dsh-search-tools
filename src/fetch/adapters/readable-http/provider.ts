/** Readable HTTP runtime: DSH's safe fetch plus lazy Readability extraction. */

import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { AdapterContext } from '../../../core/host-types.ts'
import type {
  FetchAdapterRuntime, FetchRequest, FetchResult, ProbeResult,
} from '../../../core/types.ts'
import { SearchToolsError } from '../../../shared/errors.ts'
import { redactText } from '../../../shared/redact.ts'
import { extractReadable } from './readability.ts'
import { normalizeReadableHttpConfig, type ReadableHttpConfig } from './schema.ts'

export class ReadableHttpRuntime implements FetchAdapterRuntime {
  constructor(
    private readonly ctx: AdapterContext,
    private readonly getRawConfig: () => unknown,
  ) {}

  private config(): ReadableHttpConfig {
    return normalizeReadableHttpConfig(this.getRawConfig())
  }

  available(): boolean {
    return this.config().enabled
  }

  async fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult> {
    const config = this.config()
    if (!config.enabled) throw new SearchToolsError('readable-http adapter is disabled', 'FETCH_DISABLED')
    const inner = new HttpFetchProvider({
      maxResponseBytes: config.maxResponseBytes,
      maxBodyChars: config.maxBodyChars,
      timeoutMs: config.timeoutMs,
      maxRedirects: config.maxRedirects,
      userAgent: config.userAgent,
    })
    const result = await inner.fetch(request, signal)
    if (!config.readability || result.body.kind !== 'html') return result

    try {
      const extraction = await extractReadable(result.body.content, result.url, {
        minArticleChars: config.minArticleChars,
        maxArticleChars: config.maxArticleChars,
        maxBodyChars: config.maxBodyChars,
      })
      if (extraction === undefined) {
        if (config.failOpen) return result
        throw new SearchToolsError('page could not be reduced to readable content', 'WEB_FETCH_UNREADABLE')
      }
      const body = extraction.html !== undefined
        ? { kind: 'html' as const, content: extraction.html }
        : { kind: 'text' as const, content: extraction.text ?? '' }
      return {
        ...result,
        body,
        truncated: result.truncated || extraction.truncated,
      }
    } catch (error) {
      if (config.failOpen) {
        this.ctx.logger.warn('readability failed for %s: %s', result.url, error instanceof Error ? error.message : String(error))
        return result
      }
      throw error
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
        readable: result.body.kind === 'text' || result.body.content.includes('data-dsh-readable="1"'),
        ...(ok ? {} : { message: `HTTP ${result.statusCode}` }),
      }
    } catch (error) {
      return {
        ok: false,
        code: 'FETCH_PREVIEW_FAILED',
        message: redactText(error instanceof Error ? error.message : String(error)),
        latencyMs: this.ctx.now() - started,
      }
    }
  }
}
