import { describe, expect, it } from 'vitest'
import {
  isLocalDirectNoResults, parseBing, parseBrave, parseDuckDuckGo, parseSo360,
  unwrapBing, unwrapDuckDuckGo,
} from '../src/search/adapters/local-direct/parse.ts'

describe('DuckDuckGo URL unwrapping', () => {
  it('keeps direct URLs and unwraps both redirector forms', () => {
    expect(unwrapDuckDuckGo('https://example.com/a', 'https://html.duckduckgo.com')).toBe('https://example.com/a')
    expect(unwrapDuckDuckGo('/l/?uddg=https%3A%2F%2Fexample.com%2Fa', 'https://html.duckduckgo.com'))
      .toBe('https://example.com/a')
    expect(unwrapDuckDuckGo('/?uddg=https%3A%2F%2Fexample.com%2Fb', 'https://duckduckgo.com'))
      .toBe('https://example.com/b')
  })

  it('rejects missing targets and malformed URLs', () => {
    expect(unwrapDuckDuckGo('/l/?uddg=', 'https://html.duckduckgo.com')).toBeUndefined()
    expect(unwrapDuckDuckGo('/l/', 'https://html.duckduckgo.com')).toBeUndefined()
    expect(unwrapDuckDuckGo('http://[', 'https://html.duckduckgo.com')).toBeUndefined()
  })
})

describe('Bing URL unwrapping', () => {
  it('accepts direct URLs, explicit url parameters, and url-safe base64', () => {
    expect(unwrapBing('https://example.com/direct', 'https://www.bing.com')).toBe('https://example.com/direct')
    expect(unwrapBing('https://www.bing.com/ck/a?url=https%3A%2F%2Fexample.com%2Fdirect', 'https://www.bing.com'))
      .toBe('https://example.com/direct')
    expect(unwrapBing('https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9i', 'https://www.bing.com'))
      .toBe('https://example.com/b')
  })

  it('rejects empty, malformed, non-http, and invalid base64 payloads', () => {
    expect(unwrapBing('https://www.bing.com/ck/a', 'https://www.bing.com')).toBeUndefined()
    expect(unwrapBing('https://www.bing.com/ck/a?u=', 'https://www.bing.com')).toBeUndefined()
    expect(unwrapBing('https://www.bing.com/ck/a?u=not-base64%', 'https://www.bing.com')).toBeUndefined()
    expect(unwrapBing('https://www.bing.com/ck/a?u=javascript%3Aalert(1)', 'https://www.bing.com')).toBeUndefined()
    expect(unwrapBing('https://www.bing.com/ck/a?u=aHR0cDovLw', 'https://www.bing.com')).toBe('http://')
    expect(unwrapBing('http://[', 'https://www.bing.com')).toBeUndefined()
  })
})

describe('local result parsing edge cases', () => {
  it('skips ads, missing links, and merges duplicate URLs using the longer text', () => {
    const html = `
      <div class="result result--ad"><h2><a class="result__a" href="https://ads.example/a">Ad</a></h2></div>
      <div class="result"><h2><a class="result__a">Missing href</a></h2></div>
      <div class="result"><h2><a class="result__a" href="https://example.com/a">Short</a></h2><div class="result__snippet">one</div></div>
      <div class="result"><h2><a class="result__a" href="https://example.com/a">A much longer title</a></h2><div class="result__snippet">a longer snippet</div></div>
      <div class="result"><h2><a class="result__a" href="https://example.com/empty"></a></h2></div>
    `
    const result = parseDuckDuckGo(html)
    expect(result.sources).toEqual([
      { url: 'https://example.com/a', title: 'A much longer title', snippet: 'a longer snippet' },
      { url: 'https://example.com/empty' },
    ])
    expect(result.rawSources).toHaveLength(2)
    expect(result.sources.some(source => source.url.includes('ads.example'))).toBe(false)
  })

  it('applies include and exclude domains and keeps raw sources', () => {
    const html = `
      <div class="result"><h2><a class="result__a" href="https://keep.example/a">Keep</a></h2></div>
      <div class="result"><h2><a class="result__a" href="https://drop.example/b">Drop</a></h2></div>
    `
    expect(parseDuckDuckGo(html, { includeDomains: ['keep.example'] }).sources).toHaveLength(1)
    expect(parseDuckDuckGo(html, { excludeDomains: ['keep.example'] }).sources).toHaveLength(1)
    expect(parseDuckDuckGo(html, { includeDomains: [] }).sources).toHaveLength(2)
    expect(parseDuckDuckGo(html, { excludeDomains: ['drop.example'] }).sources).toEqual([
      { url: 'https://keep.example/a', title: 'Keep' },
    ])
  })

  it('uses the Bing snippet fallback and skips missing or unsafe links', () => {
    const html = `
      <li class="b_algo b_ad"><h2><a href="https://ads.example/a">Ad</a></h2></li>
      <li class="b_algo"><h2><a>No href</a></h2></li>
      <li class="b_algo"><h2><a href="https://example.com/a">One</a></h2><div class="b_lineclamp2">Fallback snippet</div></li>
      <li class="b_algo"><h2><a href="https://example.com/b">Two</a></h2><div class="b_caption"><p>Caption snippet</p></div></li>
    `
    const result = parseBing(html)
    expect(result.sources).toEqual([
      { url: 'https://example.com/a', title: 'One', snippet: 'Fallback snippet' },
      { url: 'https://example.com/b', title: 'Two', snippet: 'Caption snippet' },
    ])
  })

  it('parses 360 data targets and rejects same-origin redirects', () => {
    const html = `
      <li class="res-list" data-result-type="normal"><div class="res-title"><a href="https://so.com/link?x" data-mdurl="https://example.com/one">One</a></div><div class="res-desc">Snippet</div></li>
      <li class="res-list" data-result-type="normal"><div class="res-title"><a href="https://www.so.com/link?x">Same origin</a></div></li>
      <li class="res-list" data-result-type="normal"><div class="res-title"><a href="https://example.com/external">External href</a></div></li>
      <li class="res-list" data-result-type="ad"><div class="res-title"><a data-mdurl="https://ads.example/a">Ad</a></div></li>
    `
    const result = parseSo360(html)
    expect(result.sources).toEqual([
      { url: 'https://example.com/one', title: 'One', snippet: 'Snippet' },
      { url: 'https://example.com/external', title: 'External href' },
    ])
  })

  it('parses Brave snippets and rejects malformed or unsafe links', () => {
    const html = `
      <div class="snippet" data-type="web"><a href="https://example.com/one"><div class="title">One</div></a><div class="generic-snippet"><div class="description">Snippet</div></div></div>
      <div class="snippet" data-type="web"><a><div class="title">No href</div></a></div>
      <div class="snippet" data-type="web"><a href="javascript:alert(1)"><div class="title">Bad</div></a></div>
      <div class="snippet" data-type="web"><a href="https://user:pass@example.com/secret"><div class="title">Secret</div></a></div>
      <div class="snippet" data-type="ad"><a href="https://ads.example/a"><div class="title">Ad</div></a></div>
    `
    const result = parseBrave(html)
    expect(result.sources).toEqual([{ url: 'https://example.com/one', title: 'One', snippet: 'Snippet' }])
  })

  it('recognises body-text no-result pages and rejects challenge pages', () => {
    expect(isLocalDirectNoResults('duckduckgo', '<html><body>No results found for that query</body></html>')).toBe(true)
    expect(isLocalDirectNoResults('bing', '<html><body>There are no results for that query</body></html>')).toBe(true)
    expect(isLocalDirectNoResults('so360', '<html><body>没有找到相关结果</body></html>')).toBe(true)
    expect(isLocalDirectNoResults('duckduckgo', '<html><body>CAPTCHA</body></html>')).toBe(false)
    expect(isLocalDirectNoResults('bing', '<html><body>Verify you are human</body></html>')).toBe(false)
  })

  it('truncates very long title and snippet text', () => {
    const html = `<div class="result"><h2><a class="result__a" href="https://example.com/long">${'t'.repeat(600)}</a></h2><div class="result__snippet">${'s'.repeat(2_100)}</div></div>`
    const source = parseDuckDuckGo(html).sources[0]!
    expect(source.title).toHaveLength(500)
    expect(source.snippet).toHaveLength(2_000)
  })
})
