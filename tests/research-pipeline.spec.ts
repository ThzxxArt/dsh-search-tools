import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import type { SearchSource } from '../src/core/types.ts'
import { runResearch, researchMeta } from '../src/research/pipeline.ts'
import { DEFAULT_RESEARCH_CONFIG, DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

const SOURCES: SearchSource[] = [
  { url: 'https://example.com/a', title: 'Architecture' },
  { url: 'https://example.com/b', title: 'Fallback' },
]

function configOf(stored: StoredConfig): Config {
  return {
    search: { get: () => stored.search },
    fetch: { get: () => stored.fetch },
    research: { get: () => stored.research },
    activation: { get: () => stored.activation },
  } as unknown as Config
}

function contextOf(fetch: (url: string) => Promise<unknown>): Context {
  return {
    web: {
      search: async () => ({ sources: SOURCES, truncated: false }),
      fetch: async ({ url }: { url: string }) => await fetch(url),
    },
    logger: { warn: () => {} },
  } as unknown as Context
}

describe('web_research pipeline', () => {
  it('searches, extracts readable HTML, clips text, and projects the card meta', async () => {
    const article = `<!doctype html><html><head><title>Architecture</title></head><body><article><h1>Architecture</h1><p>${'Composable plugins keep the agent loop separate from the Web surface. '.repeat(20)}</p></article></body></html>`
    const ctx = contextOf(async url => url.endsWith('/a')
      ? { url, statusCode: 200, body: { kind: 'html', content: article }, truncated: false }
      : { url, statusCode: 200, body: { kind: 'text', content: 'A short text page. '.repeat(80) }, truncated: false })
    const config = configOf({
      ...DEFAULT_STORED_CONFIG,
      research: { ...DEFAULT_RESEARCH_CONFIG, maxCharsPerPage: 500, maxTotalChars: 700 },
    })

    const value = await runResearch(ctx, config, {
      query: 'deepseek harness',
      max_results: 2,
      fetch_top: 2,
      max_chars: 500,
    }, new AbortController().signal)

    expect(value.query).toBe('deepseek harness')
    expect(value.sources).toHaveLength(2)
    expect(value.fetched[0]?.content).toContain('Composable plugins')
    expect(value.fetched[0]?.content.length).toBeLessThanOrEqual(500)
    expect(value.fetched[0]?.truncated).toBe(false)
    expect(value.fetched[1]?.truncated).toBe(true)
    expect(value.fetched.reduce((sum, page) => sum + page.content.length, 0)).toBeLessThanOrEqual(700)
    expect(value.fetched.every(page => page.error === undefined)).toBe(true)

    const meta = researchMeta(value) as {
      query: string
      sourceCount: number
      sources: Array<{ url: string; domain: string }>
      fetched: Array<{ url: string; chars: number; error?: string }>
      truncated: boolean
    }
    expect(meta.query).toBe('deepseek harness')
    expect(meta.sourceCount).toBe(2)
    expect(meta.sources.map(source => source.domain)).toEqual(['example.com', 'example.com'])
    expect(meta.fetched.map(page => page.chars)).toEqual([
      value.fetched[0]?.content.length,
      value.fetched[1]?.content.length,
    ])
    expect(meta.fetched.every(page => page.error === undefined)).toBe(true)
    expect(meta.truncated).toBe(true)
  })

  it('records a per-page fetch failure without failing the whole call', async () => {
    const ctx = contextOf(async (url) => {
      if (url.endsWith('/a')) throw new Error('HTTP 404')
      return { url, statusCode: 200, body: { kind: 'text', content: 'ok' }, truncated: false }
    })
    const config = configOf(DEFAULT_STORED_CONFIG)

    const value = await runResearch(ctx, config, { query: 'partial', fetch_top: 2 }, new AbortController().signal)
    expect(value.fetched).toHaveLength(2)
    expect(value.fetched[0]?.error).toContain('HTTP 404')
    expect(value.fetched[1]?.content).toBe('ok')

    const meta = researchMeta(value) as { fetched: Array<{ error?: string; chars: number }> }
    expect(meta.fetched[0]?.error).toContain('HTTP 404')
    expect(meta.fetched[0]?.chars).toBe(0)
  })

  it('refuses to run while disabled', async () => {
    const ctx = contextOf(async () => { throw new Error('fetch must not run') })
    const config = configOf({
      ...DEFAULT_STORED_CONFIG,
      research: { ...DEFAULT_RESEARCH_CONFIG, enabled: false },
    })
    await expect(runResearch(ctx, config, { query: 'off' }, new AbortController().signal))
      .rejects.toThrow('web_research is disabled')
  })
})
