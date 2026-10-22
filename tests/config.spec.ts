import { describe, expect, it } from 'vitest'
import { normalizeSearxngConfig, validateSearxngConfig } from '../src/search/adapters/searxng/schema.ts'
import { normalizeReadableHttpConfig, validateReadableHttpConfig } from '../src/fetch/adapters/readable-http/schema.ts'

describe('adapter config defaults', () => {
  it('fills SearXNG defaults and normalizes instances', () => {
    const config = normalizeSearxngConfig({ instances: [{ url: 'https://searx.example.com/search', enabled: true, label: 'Home' }] })
    expect(config.instances[0]?.url).toBe('https://searx.example.com/search')
    expect(config.maxResults).toBe(10)
    expect(config.auth.type).toBe('none')
  })

  it('rejects an enabled instance without a URL', () => {
    const result = validateSearxngConfig({ instances: [{ url: '', enabled: true }] })
    expect(result.ok).toBe(false)
    expect(result.issues.some(issue => issue.path.includes('instances'))).toBe(true)
  })

  it('allows an empty list so the plugin can stay installed but unconfigured', () => {
    const result = validateSearxngConfig({ instances: [] })
    expect(result.ok).toBe(true)
  })

  it('rejects duplicate instances', () => {
    const result = validateSearxngConfig({
      instances: [
        { url: 'https://searx.example.com', enabled: true },
        { url: 'https://searx.example.com/', enabled: true },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('fills readable defaults and validates cross-field limits', () => {
    const config = normalizeReadableHttpConfig({})
    expect(config.readability).toBe(true)
    expect(config.maxArticleChars).toBe(200_000)
    const result = validateReadableHttpConfig({ minArticleChars: 500, maxArticleChars: 100 })
    expect(result.ok).toBe(false)
  })
})
