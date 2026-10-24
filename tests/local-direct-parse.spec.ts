import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseBing, parseDuckDuckGo, unwrapBing, unwrapDuckDuckGo,
} from '../src/search/adapters/local-direct/parse.ts'

const ddg = readFileSync(new URL('./fixtures/local-direct-ddg.html', import.meta.url), 'utf8')
const bing = readFileSync(new URL('./fixtures/local-direct-bing.html', import.meta.url), 'utf8')

describe('local-direct HTML parsers', () => {
  it('parses DDG results, unwraps redirects, drops ads/tracking, and cleans text', () => {
    const result = parseDuckDuckGo(ddg)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.com/one?keep=1',
      'https://example.org/two',
    ])
    expect(result.sources[0]?.title).toBe('One & Only')
    expect(result.sources[0]?.snippet).toBe('First snippet for the example page.')
    expect(result.sources.some(source => source.url.includes('ads.example'))).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('parses Bing ck/a payloads and drops sponsored list items', () => {
    const result = parseBing(bing)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.com/two',
      'https://example.com/three?x=1',
    ])
    expect(result.sources[0]?.title).toBe('Bing One')
    expect(result.sources[0]?.snippet).toBe('First Bing snippet with markup.')
    expect(result.sources.some(source => source.url.includes('ads.example'))).toBe(false)
  })

  it('applies include/exclude domains after unwrapping', () => {
    expect(parseDuckDuckGo(ddg, { includeDomains: ['example.org'] }).sources.map(source => source.url))
      .toEqual(['https://example.org/two'])
    expect(parseBing(bing, { excludeDomains: ['example.com'] }).sources).toEqual([])
  })

  it('rejects malformed redirect and non-http result URLs', () => {
    expect(unwrapDuckDuckGo('//duckduckgo.com/l/?uddg=', 'https://html.duckduckgo.com')).toBeUndefined()
    expect(unwrapBing('https://www.bing.com/ck/a?u=not-base64', 'https://www.bing.com')).toBeUndefined()
    expect(parseBing('<li class="b_algo"><h2><a href="javascript:alert(1)">x</a></h2></li>').sources)
      .toEqual([])
  })

  it('decodes padded and URL-encoded Bing payloads', () => {
    expect(unwrapBing(
      'https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYWRkZWQ%3D',
      'https://www.bing.com',
    )).toBe('https://example.com/padded')
  })

  it('drops credential-bearing result URLs and Bing ads that also use b_algo', () => {
    expect(parseBing('<li class="b_algo b_ad"><h2><a href="https://ads.example/one">Ad</a></h2></li>').sources)
      .toEqual([])
    expect(parseBing('<li class="b_algo"><h2><a href="https://user:pass@example.com/secret">Secret</a></h2></li>').sources)
      .toEqual([])
  })
})
