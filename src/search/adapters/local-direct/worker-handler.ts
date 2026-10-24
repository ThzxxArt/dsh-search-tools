/**
 * Worker-side local-direct requests.
 *
 * One Impit client performs the fixed engine requests. A per-engine timeout,
 * HTTP error, or oversized body becomes result data so the other engine can
 * still succeed; only a missing native runtime is fatal.
 */

import type {
  LocalDirectTarget, LocalDirectTargetResult, LocalDirectWorkerRequest, LocalDirectWorkerResult,
} from './protocol.ts'

interface ResponseLike {
  status: number
  url: string
  headers: {
    get(name: string): string | null
    [Symbol.iterator](): IterableIterator<[string, string]>
  }
  body: ReadableStream<Uint8Array> | null
}

interface ClientLike {
  fetch(url: string, init?: {
    method?: string
    headers?: Record<string, string>
    redirect?: 'manual'
    timeout?: number
  }): Promise<ResponseLike>
}

export interface LocalDirectImpitModuleLike {
  Impit: new (options: Record<string, unknown>) => ClientLike
}

export interface LocalDirectHandlerDeps {
  loadImpit?: () => Promise<LocalDirectImpitModuleLike>
}

export class LocalDirectWorkerFailureError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LocalDirectWorkerFailureError'
  }
}

export async function runLocalDirectRequest(
  request: LocalDirectWorkerRequest,
  deps: LocalDirectHandlerDeps = {},
): Promise<LocalDirectWorkerResult> {
  let client: ClientLike
  try {
    const module = await (deps.loadImpit ?? loadImpit)()
    client = new module.Impit({
      browser: request.profile,
      ...(request.proxyUrl.length === 0 ? {} : { proxyUrl: request.proxyUrl }),
      timeout: request.timeoutMs,
      followRedirects: false,
      maxRedirects: 0,
      http3: false,
      ignoreTlsErrors: false,
      vanillaFallback: false,
    })
  } catch (error) {
    throw new LocalDirectWorkerFailureError(
      'LOCAL_DIRECT_RUNTIME_UNAVAILABLE',
      `local-direct native runtime is unavailable: ${messageOf(error)}`,
      { cause: error },
    )
  }

  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  }
  if (request.locale.length > 0) headers['accept-language'] = request.locale

  const targets = await Promise.all(request.targets.map(target =>
    fetchOne(client, target, headers, request.timeoutMs, request.maxResponseBytes)))
  return { targets }
}

async function fetchOne(
  client: ClientLike,
  target: LocalDirectTarget,
  headers: Record<string, string>,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<LocalDirectTargetResult> {
  try {
    const response = await client.fetch(target.url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      timeout: timeoutMs,
    })
    const body = await readBounded(response, maxResponseBytes)
    return {
      engine: target.engine,
      ok: true,
      status: response.status,
      url: response.url,
      headers: headersOf(response.headers),
      body,
    }
  } catch (error) {
    const failure = classify(error)
    return {
      engine: target.engine,
      ok: false,
      code: failure.code,
      message: failure.message,
    }
  }
}

async function loadImpit(): Promise<LocalDirectImpitModuleLike> {
  return await import('impit') as unknown as LocalDirectImpitModuleLike
}

async function readBounded(response: ResponseLike, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new LocalDirectWorkerFailureError(
      'LOCAL_DIRECT_RESPONSE_TOO_LARGE',
      `response exceeds ${maxBytes} bytes`,
    )
  }
  if (response.body === null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new LocalDirectWorkerFailureError(
          'LOCAL_DIRECT_RESPONSE_TOO_LARGE',
          `response exceeds ${maxBytes} bytes`,
        )
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
  return bytes
}

function headersOf(headers: ResponseLike['headers']): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of headers) result[key.toLowerCase()] = value
  return result
}

function classify(error: unknown): LocalDirectWorkerFailureError {
  if (error instanceof LocalDirectWorkerFailureError) return error
  const name = error instanceof Error ? error.name : ''
  if (name.includes('Timeout')) {
    return new LocalDirectWorkerFailureError('LOCAL_DIRECT_TIMEOUT', `engine request timed out: ${messageOf(error)}`, { cause: error })
  }
  if (name === 'InvalidURL' || name === 'UnsupportedProtocol') {
    return new LocalDirectWorkerFailureError('LOCAL_DIRECT_INVALID_TARGET', messageOf(error), { cause: error })
  }
  return new LocalDirectWorkerFailureError('LOCAL_DIRECT_NETWORK', `engine request failed: ${messageOf(error)}`, { cause: error })
}

export function failureOf(error: unknown): { code: string; message: string } {
  if (error instanceof LocalDirectWorkerFailureError) {
    return { code: error.code, message: error.message }
  }
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string') {
    const value = error as { code: string; message?: unknown }
    return { code: value.code, message: typeof value.message === 'string' ? value.message : value.code }
  }
  return { code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE', message: messageOf(error) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
