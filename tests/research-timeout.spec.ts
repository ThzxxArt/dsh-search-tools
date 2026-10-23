import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { runResearch } from '../src/research/pipeline.ts'
import { renderResearch } from '../src/research/render.ts'
import { applyResearchTool } from '../src/research/tool.ts'
import { DEFAULT_RESEARCH_CONFIG, DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

function configOf(research: Partial<typeof DEFAULT_RESEARCH_CONFIG> = {}): Config {
  const stored: StoredConfig = {
    ...DEFAULT_STORED_CONFIG,
    research: { ...DEFAULT_RESEARCH_CONFIG, ...research },
  }
  return {
    search: { get: () => stored.search },
    fetch: { get: () => stored.fetch },
    research: { get: () => stored.research },
    activation: { get: () => stored.activation },
  } as unknown as Config
}

const sources = [
  { url: 'https://example.com/a', title: 'A' },
  { url: 'https://example.com/b', title: 'B' },
]

describe('web_research timeout and budget', () => {
  it('aborts within the configured timeout instead of waiting for fetch', async () => {
    let fetchCalls = 0
    const ctx = {
      web: {
        search: async () => ({ sources, truncated: false }),
        fetch: async (_request: { url: string }, signal?: AbortSignal) => {
          fetchCalls++
          return await new Promise((_resolve, reject) => {
            if (signal?.aborted === true) {
              reject(new Error('aborted'))
              return
            }
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        },
      },
      logger: { warn() {} },
    } as unknown as Context

    const started = Date.now()
    await expect(runResearch(ctx, configOf({ timeoutMs: 30 }), { query: 'timeout' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'WEB_RESEARCH_TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(500)
    expect(fetchCalls).toBeGreaterThan(0)
  })

  it('reserves the total budget before fetching later pages', async () => {
    let fetchCalls = 0
    const ctx = {
      web: {
        search: async () => ({ sources, truncated: false }),
        fetch: async ({ url }: { url: string }) => {
          fetchCalls++
          return { url, statusCode: 200, body: { kind: 'text', content: 'x'.repeat(400) }, truncated: false }
        },
      },
      logger: { warn() {} },
    } as unknown as Context

    const value = await runResearch(
      ctx,
      configOf({ maxCharsPerPage: 1_000, maxTotalChars: 1_000, defaultFetchTop: 2, maxFetch: 2 }),
      { query: 'budget', fetch_top: 2, max_chars: 1_000 },
      new AbortController().signal,
    )

    expect(fetchCalls).toBe(1)
    expect(value.fetched).toHaveLength(2)
    expect(value.fetched[1]?.content).toBe('')
    expect(value.fetched[1]?.truncated).toBe(true)
  })

  it('does not fetch when fetch_top is zero', async () => {
    let fetchCalls = 0
    const ctx = {
      web: {
        search: async () => ({ sources, truncated: false }),
        fetch: async () => {
          fetchCalls++
          throw new Error('fetch must not run')
        },
      },
      logger: { warn() {} },
    } as unknown as Context

    const value = await runResearch(ctx, configOf(), { query: 'sources', fetch_top: 0 }, new AbortController().signal)
    expect(fetchCalls).toBe(0)
    expect(value.fetched).toHaveLength(0)
    expect(value.sources).toHaveLength(2)
  })

  it('uses defaultFetchTop, clamps fetch_top to maxFetch, and respects concurrency', async () => {
    let fetchCalls = 0
    let active = 0
    let maxActive = 0
    const many = Array.from({ length: 6 }, (_, index) => ({ url: `https://example.com/${index}`, title: String(index) }))
    const ctx = {
      web: {
        search: async () => ({ sources: many, truncated: false }),
        fetch: async ({ url }: { url: string }) => {
          fetchCalls++
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setTimeout(resolve, 5))
          active--
          return { url, statusCode: 200, body: { kind: 'text', content: 'ok' }, truncated: false }
        },
      },
      logger: { warn() {} },
    } as unknown as Context

    const defaulted = await runResearch(
      ctx,
      configOf({ defaultFetchTop: 2, maxFetch: 4, concurrency: 3 }),
      { query: 'defaults', max_chars: 1_000 },
      new AbortController().signal,
    )
    expect(defaulted.fetched).toHaveLength(2)

    const bounded = await runResearch(
      ctx,
      configOf({ defaultFetchTop: 2, maxFetch: 2, concurrency: 2 }),
      { query: 'bounded', fetch_top: 99, max_chars: 1_000 },
      new AbortController().signal,
    )
    expect(bounded.fetched).toHaveLength(2)
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(fetchCalls).toBe(4)
  })

  it('registers the tool with the live configured timeout', () => {
    const definitions: Array<{ timeoutMs?: number }> = []
    const ctx = {
      tools: {
        register: (definition: { timeoutMs?: number }) => {
          definitions.push(definition)
          return () => {}
        },
      },
    } as unknown as Context

    applyResearchTool(ctx, configOf({ timeoutMs: 45_000 }), 45_000)
    expect(definitions[0]?.timeoutMs).toBe(45_000)
  })
})

describe('research Markdown rendering', () => {
  it('escapes an untrusted title and snippet before they reach the model', () => {
    const markdown = renderResearch({
      query: 'q',
      sources: [{
        url: 'https://example.com/a_(b)',
        title: 'A] title\nwith newline',
        snippet: '*bold* and [link]',
      }],
      fetched: [],
      truncated: false,
    })
    expect(markdown).not.toContain('A] title')
    expect(markdown).toContain('A\\] title with newline')
    expect(markdown).toContain('\\*bold\\* and \\[link\\]')
    expect(markdown).toContain('https://example.com/a_%28b%29')
  })
})
