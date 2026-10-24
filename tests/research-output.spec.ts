import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { applyResearchTool } from '../src/research/tool.ts'
import type { ResearchValue } from '../src/research/pipeline.ts'
import { escapeMarkdownText, escapeMarkdownUrl, renderResearch } from '../src/research/render.ts'
import { DEFAULT_RESEARCH_CONFIG, DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

function configOf(stored: StoredConfig = DEFAULT_STORED_CONFIG): Config {
  return {
    search: { get: () => stored.search },
    fetch: { get: () => stored.fetch },
    research: { get: () => stored.research },
    activation: { get: () => stored.activation },
  } as unknown as Config
}

function fullValue(): ResearchValue {
  return {
    query: 'query [one] *two*',
    sources: [
      { url: 'https://example.com/a_(b)', title: 'A [title]' },
      { url: 'https://example.com/empty-title', title: '' },
      { url: 'https://example.com/no-title', snippet: 'line one\nline two' },
    ],
    fetched: [
      { url: 'https://example.com/a_(b)', title: 'Page [one]', content: 'content', truncated: true },
      { url: 'https://example.com/error', content: '', truncated: false, error: 'HTTP 500' },
      { url: 'https://example.com/empty', content: '', truncated: false },
      { url: 'https://example.com/no-title', content: 'body', truncated: false },
    ],
    truncated: true,
  }
}

describe('research markdown renderer', () => {
  it('renders empty results and full fetched branches', () => {
    expect(renderResearch({ query: 'none', sources: [], fetched: [], truncated: false }))
      .toContain('No results found.')

    const rendered = renderResearch(fullValue())
    expect(rendered).toContain('[A \\[title\\]](https://example.com/a_%28b%29)')
    expect(rendered).toContain('— line one line two')
    expect(rendered).toContain('### Page \\[one\\]')
    expect(rendered).toContain('_(truncated)_')
    expect(rendered).toContain('Fetch failed: HTTP 500')
    expect(rendered).toContain('(empty)')
    expect(rendered).toContain('Some results were truncated')
  })

  it('escapes all Markdown-sensitive characters', () => {
    expect(escapeMarkdownText('a\\b[c]d`e*f_g\r\nh')).toBe('a\\\\b\\[c\\]d\\`e\\*f\\_g h')
    expect(escapeMarkdownUrl('https://x.test/(a)<b>'))
      .toBe('https://x.test/%28a%29%3Cb%3E')
  })
})

describe('web_research tool registration', () => {
  function capture() {
    let definition: any
    const ctx = {
      tools: {
        register: (value: unknown) => {
          definition = value
          return () => {}
        },
      },
      web: {
        search: async () => ({
          sources: [{ url: 'https://example.com/a', title: 'A' }],
          truncated: false,
        }),
        fetch: async ({ url }: { url: string }) => ({
          url,
          statusCode: 200,
          body: { kind: 'text', content: 'Fetched body' },
          truncated: false,
        }),
      },
    } as unknown as Context
    return { ctx, definition: () => definition }
  }

  it('registers render, meta, concurrency, and execution hooks', async () => {
    const { ctx, definition } = capture()
    const dispose = applyResearchTool(ctx, configOf(), 12_345)
    const tool = definition()
    expect(tool.name).toBe('web_research')
    expect(tool.timeoutMs).toBe(12_345)
    expect(tool.isConcurrencySafe({ query: 'q' })).toBe(true)

    const value = {
      query: 'q',
      sources: [{ url: 'https://example.com/a' }],
      fetched: [],
      truncated: false,
    }
    expect(tool.output.render({}, value)[0].text).toContain('Search results for "q"')
    expect(tool.output.presentationMeta({}, value)).toMatchObject({ query: 'q', sourceCount: 1 })

    await expect(tool.execute({ query: 'q', fetch_top: 1 }, { signal: new AbortController().signal }))
      .resolves.toMatchObject({ query: 'q', fetched: [{ content: 'Fetched body' }] })
    dispose()
  })

  it('uses the configured timeout when no explicit timeout is provided', () => {
    const { ctx, definition } = capture()
    applyResearchTool(ctx, configOf({
      ...DEFAULT_STORED_CONFIG,
      research: { ...DEFAULT_RESEARCH_CONFIG, timeoutMs: 7_000 },
    }))
    expect(definition().timeoutMs).toBe(7_000)
  })
})
