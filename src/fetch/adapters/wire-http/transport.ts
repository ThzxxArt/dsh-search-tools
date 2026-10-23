/**
 * One-request worker transport.
 *
 * `impit`'s native client has no close/dispose API. A worker per request gives
 * deterministic cleanup even when the caller aborts or the request fails: the
 * main thread terminates the worker in `finally`, so no native client or
 * socket can survive into the next fetch.
 */

import { Worker } from 'node:worker_threads'
import { SearchToolsError, errorMessage } from '../../../shared/errors.ts'
import type { WireWorkerReply, WireWorkerRequest, WireWorkerResult } from './protocol.ts'

export interface WireTransportOptions {
  timeoutMs: number
  signal?: AbortSignal
  /** Test seam; production resolves the built `lib/wire-worker.js`. */
  workerFile?: URL | string
}

export async function runWireWorker(
  request: WireWorkerRequest,
  options: WireTransportOptions,
): Promise<WireWorkerResult> {
  if (options.signal?.aborted === true) throw abortError(options.signal)
  const workerFile = options.workerFile ?? new URL('./wire-worker.js', import.meta.url)
  const worker = new Worker(workerFile)
  let settled = false

  return await new Promise<WireWorkerResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new SearchToolsError(`wire-http worker timed out after ${options.timeoutMs} ms`, 'WIRE_TIMEOUT'))
    }, options.timeoutMs)
    timer.unref?.()

    const onAbort = (): void => { finish(abortError(options.signal)) }
    const cleanup = (): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      void worker.terminate().catch(() => {})
    }
    const finish = (error?: unknown, result?: WireWorkerResult): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) reject(error)
      else resolve(result as WireWorkerResult)
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (reply: WireWorkerReply) => {
      if (reply.ok) finish(undefined, reply.result)
      else finish(new SearchToolsError(reply.error.message, reply.error.code))
    })
    worker.once('error', (error) => {
      finish(new SearchToolsError(`wire-http worker failed: ${errorMessage(error)}`, 'WIRE_RUNTIME_UNAVAILABLE', { cause: error }))
    })
    worker.once('exit', (code) => {
      if (settled) return
      finish(new SearchToolsError(
        `wire-http worker exited before replying (code ${code})`,
        'WIRE_RUNTIME_UNAVAILABLE',
      ))
    })
    worker.postMessage(request)
  })
}

function abortError(signal: AbortSignal | undefined): SearchToolsError {
  return new SearchToolsError('wire-http request aborted', 'WEB_ABORTED', { cause: signal?.reason })
}
