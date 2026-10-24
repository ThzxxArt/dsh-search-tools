import { parentPort } from 'node:worker_threads'

if (parentPort !== null) {
  parentPort.on('message', () => {
    // Intentionally never reply; the transport owns timeout and termination.
  })
}
