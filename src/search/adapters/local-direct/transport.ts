/** One-shot worker transport for local-direct search rounds. */

import { runOneShotWorker } from '../../../shared/one-shot-worker.ts'
import type { LocalDirectWorkerRequest, LocalDirectWorkerResult } from './protocol.ts'

export interface LocalDirectTransportOptions {
  timeoutMs: number
  signal?: AbortSignal
  /** Test seam; production resolves the built `lib/local-direct-worker.js`. */
  workerFile?: URL | string
}

export async function runLocalDirectWorker(
  request: LocalDirectWorkerRequest,
  options: LocalDirectTransportOptions,
): Promise<LocalDirectWorkerResult> {
  return await runOneShotWorker<LocalDirectWorkerRequest, LocalDirectWorkerResult>(request, {
    timeoutMs: options.timeoutMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    workerFile: options.workerFile ?? new URL('./local-direct-worker.js', import.meta.url),
    label: 'local-direct',
    timeoutCode: 'LOCAL_DIRECT_TIMEOUT',
    runtimeCode: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE',
  })
}
