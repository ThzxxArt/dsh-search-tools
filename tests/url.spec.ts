import { describe, expect, it } from 'vitest'
import { domainMatches, normalizeInstanceUrl, normalizeResultUrl } from '../src/shared/url.ts'

describe('url helpers', () => {
  it('normalizes a SearXNG base URL and drops /search', () => {
    expect(normalizeInstanceUrl('https://searx.example.com/base/search/')).toBe('https://searx.example.com/base')
  })

  it('rejects embedded credentials', () => {
    expect(() => normalizeInstanceUrl('https://user:pass@searx.example.com')).toThrow()
  })

  it('drops tracking params and hashes', () => {
    expect(normalizeResultUrl('https://Example.com/a?utm_source=x&id=1#frag')).toBe('https://example.com/a?id=1')
  })

  it('matches subdomains but not suffix tricks', () => {
    expect(domainMatches('www.example.com', 'example.com')).toBe(true)
    expect(domainMatches('notexample.com', 'example.com')).toBe(false)
  })
})
