import { describe, expect, it, vi } from 'vitest'
import type { AdapterContext } from '../src/core/host-types.ts'

const state = vi.hoisted(() => ({
  limits: undefined as undefined | {
    maxResponseBytes: number
    maxBodyChars: number
    timeoutMs: number
    maxRedirects: number
    userAgent: string
  },
  body: { kind: 'text' as 'text' | 'html', content: 'ok' },
  statusCode: 200,
}))

vi.mock('@deepseek-ai/dsh-web-fetch-http', () => ({
  HttpFetchProvider: class {
    constructor(limits: typeof state.limits) {
      state.limits = limits
    }

    async fetch() {
      return {
        url: 'https://example.com/',
        statusCode: state.statusCode,
        body: state.body,
        truncated: false,
      }
    }
  },
}))

import { ReadableHttpRuntime } from '../src/fetch/adapters/readable-http/provider.ts'
import { normalizeReadableHttpConfig } from '../src/fetch/adapters/readable-http/schema.ts'

const logger = { debug() {}, warn() {}, error() {} }

function context(): AdapterContext {
  return {
    logger,
    getCredentials: () => undefined,
    env: {},
    fetch: globalThis.fetch,
    now: () => Date.now(),
  }
}

describe('Readable HTTP runtime', () => {
  it('passes every transport limit to the DSH safe HTTP provider', async () => {
    const runtime = new ReadableHttpRuntime(context(), () => normalizeReadableHttpConfig({
      maxResponseBytes: 12_345,
      maxBodyChars: 23_456,
      timeoutMs: 3_456,
      maxRedirects: 2,
      userAgent: 'limit-agent',
    }))
    await runtime.fetch({ url: 'https://example.com/' })
    expect(state.limits).toEqual({
      maxResponseBytes: 12_345,
      maxBodyChars: 23_456,
      timeoutMs: 3_456,
      maxRedirects: 2,
      userAgent: 'limit-agent',
    })
  })

  it('honors enabled and readability=false', async () => {
    const disabled = new ReadableHttpRuntime(context(), () => ({ enabled: false }))
    await expect(disabled.fetch({ url: 'https://example.com/' })).rejects.toMatchObject({ code: 'FETCH_DISABLED' })

    state.body = { kind: 'html', content: '<html><body><article><p>Short article body.</p></article></body></html>' }
    const raw = new ReadableHttpRuntime(context(), () => ({ readability: false }))
    const result = await raw.fetch({ url: 'https://example.com/' })
    expect(result.body.kind).toBe('html')
    expect(result.body.content).toContain('Short article body')
  })

  it('uses extraction truncation instead of comparing raw HTML length', async () => {
    state.body = {
      kind: 'html',
      content: `<html><body><article><h1>Short</h1><p>Short readable text. ${'<span class="noise">x</span>'.repeat(100)}</p></article></body></html>`,
    }
    const runtime = new ReadableHttpRuntime(context(), () => ({
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    }))
    const result = await runtime.fetch({ url: 'https://example.com/' })
    expect(result.truncated).toBe(false)
  })

  it('fails open or closed when readability cannot extract an article', async () => {
    state.body = { kind: 'html', content: '<html><body><p>too short</p></body></html>' }
    const open = new ReadableHttpRuntime(context(), () => ({ failOpen: true, minArticleChars: 500 }))
    const openResult = await open.fetch({ url: 'https://example.com/' })
    expect(openResult.body.content).toContain('too short')

    const closed = new ReadableHttpRuntime(context(), () => ({ failOpen: false, minArticleChars: 500 }))
    await expect(closed.fetch({ url: 'https://example.com/' })).rejects.toMatchObject({ code: 'WEB_FETCH_UNREADABLE' })
  })
})
