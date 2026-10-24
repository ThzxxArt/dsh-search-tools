/**
 * One-request wire transport.
 *
 * `impit`'s native client has no close/dispose API. A worker per request gives
 * deterministic cleanup even when the caller aborts or the request fails: the
 * main thread terminates the worker in `finally`, so no native client or
 * socket can survive into the next fetch.
 */

import { runOneShotWorker } from '../../../shared/one-shot-worker.ts'
import type { WireWorkerRequest, WireWorkerResult } from './protocol.ts'

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
  return await runOneShotWorker<WireWorkerRequest, WireWorkerResult>(request, {
    timeoutMs: options.timeoutMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    workerFile: options.workerFile ?? new URL('./wire-worker.js', import.meta.url),
    label: 'wire-http',
    timeoutCode: 'WIRE_TIMEOUT',
    runtimeCode: 'WIRE_RUNTIME_UNAVAILABLE',
  })
}
