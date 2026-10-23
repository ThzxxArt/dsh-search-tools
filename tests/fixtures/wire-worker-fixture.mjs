import { parentPort } from 'node:worker_threads'

parentPort.on('message', (request) => {
  if (request.url.includes('/never')) return
  if (request.url.includes('/error')) {
    parentPort.postMessage({ ok: false, error: { code: 'WIRE_NETWORK', message: 'fixture failure' } })
    return
  }
  parentPort.postMessage({
    ok: true,
    result: {
      url: request.url,
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: new TextEncoder().encode(`worker:${request.proxyUrl}`),
    },
  })
})
