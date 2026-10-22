import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSearxngJson } from '../src/search/adapters/searxng/parse-json.ts'
import { parseSearxngHtml } from '../src/search/adapters/searxng/parse-html.ts'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

describe('SearXNG JSON parser', () => {
  it('maps results, answers, and published dates', () => {
    const result = parseSearxngJson(JSON.parse(fixture('searxng.json')), 'https://searx.example.com')
    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toMatchObject({ title: 'First', snippet: 'One', publishedAt: '2026-01-01' })
    expect(result.content).toContain('answer')
  })

  it('deduplicates normalized URLs and applies domain filters', () => {
    const result = parseSearxngJson({
      results: [
        { url: 'https://example.com/a?utm_source=x', title: 'A' },
        { url: 'https://example.com/a', title: 'A2' },
        { url: 'https://spam.example/b', title: 'B' },
      ],
    }, 'https://searx.example.com', { excludeDomains: ['spam.example'] })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.title).toBe('A')
  })

  it('surfaces unresponsive engines without failing an empty result', () => {
    const result = parseSearxngJson({
      results: [],
      unresponsive_engines: [['google', 'Suspended: access denied'], ['duckduckgo', 'CAPTCHA']],
    }, 'https://searx.example.com')
    expect(result.sources).toHaveLength(0)
    expect(result.notes).toEqual(['google: Suspended: access denied', 'duckduckgo: CAPTCHA'])
  })
})

describe('SearXNG HTML parser', () => {
  it('parses the article.result theme', () => {
    const result = parseSearxngHtml(fixture('searxng.html'), 'https://searx.example.com')
    expect(result.sources[0]).toMatchObject({
      url: 'https://example.com/article',
      title: 'Article title',
      snippet: 'Article snippet',
    })
  })
})
