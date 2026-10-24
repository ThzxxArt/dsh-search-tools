import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import { runResearch } from '../src/research/pipeline.ts'
import { DEFAULT_RESEARCH_CONFIG, DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

vi.mock('../src/fetch/adapters/readable-http/readability.ts', () => ({
  extractReadable: async () => ({
    text: 'Extracted text only',
    truncated: true,
    textChars: 19,
    htmlChars: 0,
  }),
}))

function configOf(stored: StoredConfig): Config {
  return {
    search: { get: () => stored.search },
    fetch: { get: () => stored.fetch },
    research: { get: () => stored.research },
    activation: { get: () => stored.activation },
  } as unknown as Config
}

describe('web_research readable text fallback', () => {
  it('uses extracted text instead of raw HTML when Readability returned no HTML', async () => {
    const ctx = {
      web: {
        search: async () => ({ sources: [{ url: 'https://example.com/a' }], truncated: false }),
        fetch: async ({ url }: { url: string }) => ({
          url,
          statusCode: 200,
          body: { kind: 'html', content: '<html><body><article>raw html must not leak</article></body></html>' },
          truncated: false,
        }),
      },
      logger: { warn: () => {} },
    } as unknown as Context
    const value = await runResearch(ctx, configOf({
      ...DEFAULT_STORED_CONFIG,
      research: { ...DEFAULT_RESEARCH_CONFIG, maxCharsPerPage: 500, maxTotalChars: 700 },
    }), { query: 'fallback', fetch_top: 1 }, new AbortController().signal)

    expect(value.fetched[0]?.content).toContain('Extracted text only')
    expect(value.fetched[0]?.content).not.toContain('raw html must not leak')
    expect(value.fetched[0]?.truncated).toBe(true)
  })
})
