/** One-shot worker entry for local-direct searches. */

import { parentPort } from 'node:worker_threads'
import type { LocalDirectWorkerReply, LocalDirectWorkerRequest } from './protocol.ts'
import { failureOf, runLocalDirectRequest } from './worker-handler.ts'

const port = parentPort
if (port !== null) {
  port.on('message', (request: LocalDirectWorkerRequest) => {
    void runLocalDirectRequest(request).then(
      (result): LocalDirectWorkerReply => ({ ok: true, result }),
      (error: unknown): LocalDirectWorkerReply => ({ ok: false, error: failureOf(error) }),
    ).then((reply) => {
      port.postMessage(reply)
    })
  })
}
