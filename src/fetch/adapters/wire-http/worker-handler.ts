/**
 * Worker-side request implementation.
 *
 * The handler is separated from the worker entry so it can be unit-tested with
 * a fake Impit constructor. It never sends cookies, authorization, or a
 * request body, and it never falls back to a different adapter.
 */

import type { WireWorkerFailure, WireWorkerRequest, WireWorkerResult } from './protocol.ts'

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
    redirect?: 'follow'
  }): Promise<ResponseLike>
}

export interface ImpitModuleLike {
  Impit: new (options: Record<string, unknown>) => ClientLike
}

export interface WireHandlerDeps {
  loadImpit?: () => Promise<ImpitModuleLike>
}

export class WireWorkerFailureError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WireWorkerFailureError'
  }
}

export async function runWireRequest(
  request: WireWorkerRequest,
  deps: WireHandlerDeps = {},
): Promise<WireWorkerResult> {
  let client: ClientLike
  try {
    const module = await (deps.loadImpit ?? loadImpit)()
    client = new module.Impit({
      browser: request.profile,
      proxyUrl: request.proxyUrl,
      timeout: request.timeoutMs,
      followRedirects: true,
      maxRedirects: request.maxRedirects,
      http3: false,
      ignoreTlsErrors: false,
      vanillaFallback: false,
    })
  } catch (error) {
    throw new WireWorkerFailureError(
      'WIRE_RUNTIME_UNAVAILABLE',
      `wire-http native runtime is unavailable: ${messageOf(error)}`,
      { cause: error },
    )
  }

  const headers: Record<string, string> = {}
  if (request.locale.length > 0) headers['accept-language'] = request.locale

  try {
    const response = await client.fetch(request.url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    })
    const body = await readBounded(response, request.maxResponseBytes)
    return {
      url: response.url,
      status: response.status,
      headers: headersOf(response.headers),
      body,
    }
  } catch (error) {
    if (error instanceof WireWorkerFailureError) throw error
    throw classify(error)
  }
}

async function loadImpit(): Promise<ImpitModuleLike> {
  return await import('impit') as unknown as ImpitModuleLike
}

async function readBounded(response: ResponseLike, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new WireWorkerFailureError(
      'WIRE_RESPONSE_TOO_LARGE',
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
        await reader.cancel()
        throw new WireWorkerFailureError(
          'WIRE_RESPONSE_TOO_LARGE',
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

function classify(error: unknown): WireWorkerFailureError {
  const name = error instanceof Error ? error.name : ''
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined
  if (name.includes('Timeout')) {
    return new WireWorkerFailureError('WIRE_TIMEOUT', `wire-http timed out: ${messageOf(error)}`, { cause: error })
  }
  if (name === 'TooManyRedirects') {
    return new WireWorkerFailureError('WIRE_REDIRECT_BLOCKED', 'wire-http redirect limit exceeded', { cause: error })
  }
  if (name === 'ProxyTunnelError' && status === 403) {
    return new WireWorkerFailureError('WIRE_REDIRECT_BLOCKED', 'wire-http redirect target was blocked', { cause: error })
  }
  if (name === 'InvalidURL' || name === 'UnsupportedProtocol') {
    return new WireWorkerFailureError('WIRE_INVALID_TARGET', messageOf(error), { cause: error })
  }
  return new WireWorkerFailureError('WIRE_NETWORK', `wire-http request failed: ${messageOf(error)}`, { cause: error })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Convert a thrown value into the structured worker failure shape. */
export function failureOf(error: unknown): WireWorkerFailure {
  if (error instanceof WireWorkerFailureError) {
    return { code: error.code, message: error.message }
  }
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string') {
    const value = error as { code: string; message?: unknown }
    return { code: value.code, message: typeof value.message === 'string' ? value.message : value.code }
  }
  return { code: 'WIRE_NETWORK', message: messageOf(error) }
}
