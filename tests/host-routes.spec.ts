import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import type { FetchDispatcher, SearchDispatcher } from '../src/core/dispatchers.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import type { SearchToolsService } from '../src/core/service.ts'
import type { JsonObject } from '../src/core/types.ts'
import { registerRoutes, type RouteDeps } from '../src/host/routes.ts'
import { DEFAULT_ACTIVATION_CONFIG, DEFAULT_RESEARCH_CONFIG } from '../src/shared/defaults.ts'

const BASE = '/api/dsh-search-tools'

function configOf(): Config {
  return {
    search: { get: () => ({ adapter: 'searxng', adapters: { searxng: {} } }) },
    fetch: { get: () => ({ adapter: 'readable-http', adapters: { 'readable-http': {} } }) },
    research: { get: () => DEFAULT_RESEARCH_CONFIG },
    activation: { get: () => DEFAULT_ACTIVATION_CONFIG },
  } as unknown as Config
}

function fakeContext(): {
  ctx: Context
  handlers: Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>
} {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>()
  const ctx = {
    get: (name: string) => name === 'connection' ? { requestRejection: () => undefined } : undefined,
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    webServer: {
      register: (route: {
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
      }) => {
        handlers.set(route.path, route.handler)
        return () => {}
      },
    },
  } as unknown as Context
  return { ctx, handlers }
}

function requestOf(body: unknown): IncomingMessage {
  const bytes = Buffer.from(JSON.stringify(body))
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield bytes
    },
  } as unknown as IncomingMessage
}

function responseOf(): ServerResponse & { body: string } {
  const response = {
    statusCode: 0,
    headersSent: false,
    body: '',
    setHeader() {},
    end(chunk?: unknown) {
      this.body = chunk === undefined ? '' : String(chunk)
      this.headersSent = true
    },
  }
  return response as unknown as ServerResponse & { body: string }
}

describe('host route config contract', () => {
  it('passes the draft maxResults to search preview instead of hard-coding 10', async () => {
    const seen: Array<{ adapter: string; config: JsonObject; request: { query: string; maxResults?: number } }> = []
    const search = {
      preview: async (adapter: string, config: JsonObject, request: { query: string; maxResults?: number }) => {
        seen.push({ adapter, config, request })
        return { sources: [], truncated: false }
      },
    } as unknown as SearchDispatcher
    const fetch = {} as unknown as FetchDispatcher
    const adapters = {
      listAdapters: () => ({ search: [], fetch: [] }),
    } as unknown as SearchToolsService
    const deps: RouteDeps = {
      config: configOf(),
      search,
      fetch,
      adapters,
      diagnostics: new Diagnostics(),
    }
    const { ctx, handlers } = fakeContext()
    registerRoutes(ctx, deps)
    const handler = handlers.get(`${BASE}/search-preview`)
    expect(handler).toBeDefined()

    const response = responseOf()
    await handler!(requestOf({
      adapter: 'searxng',
      query: 'draft cap',
      config: { maxResults: 17 },
    }), response)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.request.maxResults).toBe(17)
  })
})
