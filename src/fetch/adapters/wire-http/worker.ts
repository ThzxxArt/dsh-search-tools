/** One-request worker entry. The transport terminates this thread after each reply. */

import { parentPort } from 'node:worker_threads'
import type { WireWorkerReply, WireWorkerRequest } from './protocol.ts'
import { failureOf, runWireRequest } from './worker-handler.ts'

const port = parentPort
if (port !== null) {
  port.on('message', (request: WireWorkerRequest) => {
    void runWireRequest(request).then(
      (result): WireWorkerReply => ({ ok: true, result }),
      (error: unknown): WireWorkerReply => ({ ok: false, error: failureOf(error) }),
    ).then((reply) => {
      port.postMessage(reply)
    })
  })
}
