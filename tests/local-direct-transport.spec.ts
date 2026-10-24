import { describe, expect, it } from 'vitest'
import type { LocalDirectWorkerRequest } from '../src/search/adapters/local-direct/protocol.ts'
import { runLocalDirectWorker } from '../src/search/adapters/local-direct/transport.ts'

const request: LocalDirectWorkerRequest = {
  targets: [
    { engine: 'duckduckgo', url: 'https://html.duckduckgo.com/html/?q=x' },
    { engine: 'bing', url: 'https://www.bing.com/search?q=x' },
  ],
  profile: 'chrome',
  timeoutMs: 1_000,
  maxResponseBytes: 10_000,
  proxyUrl: '',
  locale: 'en-US',
}

const fixtureWorker = new URL('./fixtures/local-direct-worker-fixture.mjs', import.meta.url)
const hangWorker = new URL('./fixtures/local-direct-hang-worker.mjs', import.meta.url)

describe('local-direct one-shot worker transport', () => {
  it('runs a worker and returns structured target results', async () => {
    const result = await runLocalDirectWorker(request, { timeoutMs: 2_000, workerFile: fixtureWorker })
    expect(result.targets).toHaveLength(2)
    expect(result.targets[0]?.engine).toBe('duckduckgo')
    expect(result.targets[1]?.engine).toBe('bing')
    expect(result.targets.every(target => target.ok)).toBe(true)
  })

  it('times out and terminates a hanging worker', async () => {
    await expect(runLocalDirectWorker(request, { timeoutMs: 80, workerFile: hangWorker }))
      .rejects.toMatchObject({ code: 'LOCAL_DIRECT_TIMEOUT' })
  })

  it('aborts a hanging worker without leaving it running', async () => {
    const controller = new AbortController()
    const pending = runLocalDirectWorker(request, {
      timeoutMs: 2_000,
      signal: controller.signal,
      workerFile: hangWorker,
    })
    setTimeout(() => { controller.abort(new Error('stop')) }, 20)
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('rejects a missing worker file as an unavailable runtime', async () => {
    await expect(runLocalDirectWorker(request, {
      timeoutMs: 2_000,
      workerFile: new URL('./fixtures/local-direct-missing.mjs', import.meta.url),
    })).rejects.toMatchObject({ code: 'LOCAL_DIRECT_RUNTIME_UNAVAILABLE' })
  })
})
