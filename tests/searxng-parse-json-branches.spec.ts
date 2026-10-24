import { describe, expect, it } from 'vitest'
import { parseSearxngJson } from '../src/search/adapters/searxng/parse-json.ts'

describe('SearXNG JSON parser branches', () => {
  it('rejects non-object payloads and tolerates missing/invalid results', () => {
    expect(() => parseSearxngJson(null, 'https://searx.example')).toThrow('not an object')
    expect(parseSearxngJson({}, 'https://searx.example')).toEqual({ sources: [], truncated: false })
    expect(parseSearxngJson({ results: 'bad' }, 'https://searx.example').sources).toEqual([])
    expect(parseSearxngJson({ results: [null, 'x', 1, {}] }, 'https://searx.example').sources).toEqual([])
  })

  it('maps relative URLs, trims fields, and accepts both date keys', () => {
    const result = parseSearxngJson({
      results: [
        { url: '/relative', title: '  Title  ', content: '  Snippet  ', publishedDate: '2026-01-01' },
        { url: 'https://example.com/b', title: '', content: '', published_date: '2026-02-02' },
        { url: 'javascript:alert(1)' },
        { url: '' },
        { url: 42 },
      ],
    }, 'https://searx.example')
    expect(result.sources).toEqual([
      { url: 'https://searx.example/relative', title: 'Title', snippet: 'Snippet', publishedAt: '2026-01-01' },
      { url: 'https://example.com/b', publishedAt: '2026-02-02' },
    ])
  })

  it('skips malformed URLs and invalid instances', () => {
    expect(parseSearxngJson({ results: [{ url: 'http://[' }] }, 'https://searx.example').sources).toEqual([])
    expect(parseSearxngJson({ results: [{ url: '/a' }] }, 'not a url').sources).toEqual([])
  })

  it('applies include and exclude domain filters', () => {
    const payload = {
      results: [
        { url: 'https://keep.example/a', title: 'Keep' },
        { url: 'https://drop.example/b', title: 'Drop' },
      ],
    }
    expect(parseSearxngJson(payload, 'https://searx.example', { includeDomains: ['keep.example'] }).sources)
      .toEqual([{ url: 'https://keep.example/a', title: 'Keep' }])
    expect(parseSearxngJson(payload, 'https://searx.example', { excludeDomains: ['keep.example'] }).sources)
      .toEqual([{ url: 'https://drop.example/b', title: 'Drop' }])
    expect(parseSearxngJson(payload, 'https://searx.example', { includeDomains: [], excludeDomains: [] }).sources)
      .toHaveLength(2)
  })

  it('merges duplicate URLs only for missing fields', () => {
    const result = parseSearxngJson({
      results: [
        { url: 'https://example.com/a', title: 'First', content: 'one', publishedDate: '2026-01-01' },
        { url: 'https://example.com/a', title: 'Second', content: 'two', publishedDate: '2026-02-02' },
        { url: 'https://example.com/b' },
        { url: 'https://example.com/b', title: 'Only title', content: 'only snippet' },
      ],
    }, 'https://searx.example')
    expect(result.sources).toEqual([
      { url: 'https://example.com/a', title: 'First', snippet: 'one', publishedAt: '2026-01-01' },
      { url: 'https://example.com/b', title: 'Only title', snippet: 'only snippet' },
    ])
  })

  it('joins and deduplicates answers and infobox content', () => {
    const result = parseSearxngJson({
      results: [],
      answers: [' one ', '', 2, 'two', 'one'],
      infoboxes: [
        null,
        { content: ' box ' },
        { content: '' },
        { content: 3 },
        'bad',
      ],
    }, 'https://searx.example')
    expect(result.content).toBe('one\n\ntwo\n\nbox')

    const noContent = parseSearxngJson({
      results: [],
      answers: 'bad',
      infoboxes: 'bad',
    }, 'https://searx.example')
    expect(noContent.content).toBeUndefined()
  })

  it('normalizes unresponsive engine notes and caps them', () => {
    const result = parseSearxngJson({
      results: [],
      unresponsive_engines: [
        ['google', 'timeout'],
        'bing: rate limited',
        ['missing reason'],
        [1, 2],
        ['google', 'timeout'],
        ...Array.from({ length: 12 }, (_, index) => [`engine-${index}`, 'down']),
      ],
    }, 'https://searx.example')
    expect(result.notes).toHaveLength(8)
    expect(result.notes).toContain('google: timeout')
    expect(result.notes).toContain('bing: rate limited')
    expect(result.notes).not.toContain('missing reason: undefined')
    expect(parseSearxngJson({ results: [], unresponsive_engines: 'bad' }, 'https://searx.example').notes)
      .toBeUndefined()
  })
})
