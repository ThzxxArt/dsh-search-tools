import { parentPort } from 'node:worker_threads'

if (parentPort !== null) {
  parentPort.on('message', (request) => {
    const targets = request.targets.map((target) => ({
      engine: target.engine,
      ok: target.url.includes('never') ? false : true,
      ...(target.url.includes('never') ? { code: 'LOCAL_DIRECT_TIMEOUT', message: 'fixture timeout' } : {}),
      ...(target.url.includes('never') ? {} : {
        status: 200,
        url: target.url,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: new TextEncoder().encode(`<html><body>${target.engine}:${target.url}</body></html>`),
      }),
    }))
    parentPort.postMessage({ ok: true, result: { targets } })
  })
}
