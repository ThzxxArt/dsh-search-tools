/**
 * One-request worker lifecycle shared by native adapters.
 *
 * A worker is created for one bounded operation and is terminated in every
 * settlement path: reply, error, caller abort, or timeout. The callback keeps
 * the native handle out of the host thread.
 */

import { Worker } from 'node:worker_threads'
import { SearchToolsError, errorMessage } from './errors.ts'

export interface OneShotWorkerOptions {
  /** Hard deadline for the worker round-trip. */
  timeoutMs: number
  signal?: AbortSignal
  /** Built worker entry; production owns the path. */
  workerFile: URL | string
  /** Human label used in error messages, for example `wire-http`. */
  label: string
  timeoutCode: string
  runtimeCode: string
}

interface WorkerReply<TResult> {
  ok: boolean
  result?: TResult
  error?: { code: string; message: string }
}

export async function runOneShotWorker<TRequest, TResult>(
  request: TRequest,
  options: OneShotWorkerOptions,
): Promise<TResult> {
  if (options.signal?.aborted === true) throw abortError(options)
  const worker = new Worker(options.workerFile)
  let settled = false

  return await new Promise<TResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new SearchToolsError(
        `${options.label} worker timed out after ${options.timeoutMs} ms`,
        options.timeoutCode,
      ))
    }, options.timeoutMs)
    timer.unref?.()

    const onAbort = (): void => { finish(abortError(options)) }
    const cleanup = (): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      void worker.terminate().catch(() => {})
    }
    const finish = (error?: unknown, result?: TResult): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) reject(error)
      else resolve(result as TResult)
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (reply: WorkerReply<TResult>) => {
      if (reply.ok) finish(undefined, reply.result)
      else finish(new SearchToolsError(
        reply.error?.message ?? `${options.label} worker failed`,
        reply.error?.code ?? options.runtimeCode,
      ))
    })
    worker.once('error', (error) => {
      finish(new SearchToolsError(
        `${options.label} worker failed: ${errorMessage(error)}`,
        options.runtimeCode,
        { cause: error },
      ))
    })
    worker.once('exit', (code) => {
      if (settled) return
      finish(new SearchToolsError(
        `${options.label} worker exited before replying (code ${code})`,
        options.runtimeCode,
      ))
    })
    worker.postMessage(request)
  })
}

function abortError(options: OneShotWorkerOptions): SearchToolsError {
  return new SearchToolsError(
    `${options.label} request aborted`,
    'WEB_ABORTED',
    { cause: options.signal?.reason },
  )
}
