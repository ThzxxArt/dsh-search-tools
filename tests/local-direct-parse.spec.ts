import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isLocalDirectNoResults, parseBing, parseBrave, parseDuckDuckGo, parseSo360,
  unwrapBing, unwrapDuckDuckGo,
} from '../src/search/adapters/local-direct/parse.ts'

const ddg = readFileSync(new URL('./fixtures/local-direct-ddg.html', import.meta.url), 'utf8')
const bing = readFileSync(new URL('./fixtures/local-direct-bing.html', import.meta.url), 'utf8')
const brave = readFileSync(new URL('./fixtures/local-direct-brave.html', import.meta.url), 'utf8')
const so360 = readFileSync(new URL('./fixtures/local-direct-so360.html', import.meta.url), 'utf8')

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

  it('parses Brave web snippets, resolves relative links, and ignores sponsored cards', () => {
    const result = parseBrave(brave)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.com/brave-one',
      'https://example.org/brave-two',
      'https://search.brave.com/relative/brave-three',
    ])
    expect(result.sources[0]).toMatchObject({
      title: 'Brave One',
      snippet: 'First Brave snippet.',
    })
    expect(result.sources[1]?.snippet).toBe('Second Brave snippet.')
    expect(result.sources.some(source => source.url.includes('ads.example'))).toBe(false)
  })

  it('parses 360 through data-mdurl and ignores non-normal result types', () => {
    const result = parseSo360(so360)
    expect(result.sources.map(source => source.url)).toEqual([
      'https://example.com/360-one',
      'https://example.org/360-two',
    ])
    expect(result.sources[0]?.title).toBe('360 One')
    expect(result.sources[0]?.snippet).toBe('First 360 snippet.')
    expect(result.sources.some(source => source.url.includes('ads.example'))).toBe(false)
  })

  it('recognises explicit no-results pages without treating challenges as success', () => {
    expect(isLocalDirectNoResults('duckduckgo', '<div class="no-results">No results.</div>')).toBe(true)
    expect(isLocalDirectNoResults('bing', '<div id="b_results"><div class="b_no">There are no results for x</div></div>')).toBe(true)
    expect(isLocalDirectNoResults('brave', '<main><h2>No results found</h2></main>')).toBe(true)
    expect(isLocalDirectNoResults('brave', '<script>const label = "No results found"</script><main><div class="snippet" data-type="web">ok</div></main>')).toBe(false)
    expect(isLocalDirectNoResults('so360', '<div class="no-result">没有找到相关结果</div>')).toBe(true)
    expect(isLocalDirectNoResults('duckduckgo', '<html><h1>CAPTCHA</h1></html>')).toBe(false)
    expect(isLocalDirectNoResults('so360', '<html><h1>验证码</h1></html>')).toBe(false)
  })
})
