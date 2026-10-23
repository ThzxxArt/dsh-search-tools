import { describe, expect, it } from 'vitest'
import type { AdapterManifest } from '../src/core/types.ts'
import { normalizeSearxngConfig, validateSearxngConfig } from '../src/search/adapters/searxng/schema.ts'
import { normalizeReadableHttpConfig, validateReadableHttpConfig } from '../src/fetch/adapters/readable-http/schema.ts'
import { validateManifestConfig } from '../src/shared/validation.ts'
import { issueText } from '../src/client/issue-text.ts'

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
    expect(result.issues.find(issue => issue.path.endsWith('.url'))?.code).toBe('instances.urlRequired')
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
    expect(result.issues[0]?.code).toBe('readable.maxArticleBelowMin')
  })

  it('falls back to the issue message when the locale has no matching code', () => {
    expect(issueText({ path: 'x', message: 'fallback text', code: 'missing.code' }, key => key)).toBe('fallback text')
  })

  it('rejects every out-of-range SearXNG number instead of silently clamping', () => {
    const cases: Array<[string, unknown, string]> = [
      ['safesearch', 3, 'field.max'],
      ['safesearch', -1, 'field.min'],
      ['pages', 0, 'field.min'],
      ['pages', 4, 'field.max'],
      ['maxResults', 0, 'field.min'],
      ['maxResults', 21, 'field.max'],
      ['requestTimeoutMs', 999, 'field.min'],
      ['requestTimeoutMs', 120_001, 'field.max'],
      ['deadlineMs', 999, 'field.min'],
      ['deadlineMs', 300_001, 'field.max'],
      ['retries', -1, 'field.min'],
      ['retries', 6, 'field.max'],
      ['cacheTtlMs', 86_400_001, 'field.max'],
      ['cacheMaxEntries', 10_001, 'field.max'],
    ]
    for (const [key, value, code] of cases) {
      const result = validateSearxngConfig({ [key]: value })
      expect(result.ok, `${key}=${String(value)}`).toBe(false)
      expect(result.issues.some(issue => issue.path === key && issue.code === code), `${key}=${String(value)}`).toBe(true)
    }
  })

  it('rejects non-numeric and non-integer built-in values', () => {
    expect(validateSearxngConfig({ pages: '2' }).issues[0]?.code).toBe('field.number')
    expect(validateSearxngConfig({ pages: 1.5 }).issues[0]?.code).toBe('field.number')
    expect(validateSearxngConfig({ engines: ['google', 3] }).issues[0]?.code).toBe('field.stringArray')
    expect(validateSearxngConfig({ method: 'PUT' }).issues[0]?.code).toBe('field.option')
    expect(validateSearxngConfig({ format: 'xml' }).issues[0]?.code).toBe('field.option')
    expect(validateSearxngConfig({ timeRange: 'hour' }).issues[0]?.code).toBe('field.option')
    expect(validateSearxngConfig({ strategy: 'random' }).issues[0]?.code).toBe('field.option')
  })

  it('rejects every out-of-range Readability number', () => {
    const cases: Array<[string, number, string]> = [
      ['minArticleChars', -1, 'field.min'],
      ['minArticleChars', 100_001, 'field.max'],
      ['maxArticleChars', 999, 'field.min'],
      ['maxArticleChars', 5_000_001, 'field.max'],
      ['maxResponseBytes', 1_023, 'field.min'],
      ['maxResponseBytes', 50_000_001, 'field.max'],
      ['maxBodyChars', 1_023, 'field.min'],
      ['maxBodyChars', 20_000_001, 'field.max'],
      ['timeoutMs', 999, 'field.min'],
      ['timeoutMs', 120_001, 'field.max'],
      ['maxRedirects', -1, 'field.min'],
      ['maxRedirects', 11, 'field.max'],
    ]
    for (const [key, value, code] of cases) {
      const result = validateReadableHttpConfig({ [key]: value })
      expect(result.ok, `${key}=${value}`).toBe(false)
      expect(result.issues.some(issue => issue.path === key && issue.code === code), `${key}=${value}`).toBe(true)
    }
  })

  it('rejects article caps larger than the decoded-body cap', () => {
    const result = validateReadableHttpConfig({ maxArticleChars: 100_000, maxBodyChars: 10_000 })
    expect(result.issues.some(issue => issue.code === 'readable.maxArticleAboveBody')).toBe(true)
  })

  it('validates an external adapter from its manifest without importing adapter code', () => {
    const manifest: AdapterManifest = {
      kind: 'search',
      id: 'exa',
      label: 'Exa',
      description: 'Example external adapter',
      defaults: {},
      fields: [
        { kind: 'text', key: 'apiKey', label: 'API key', required: true },
        { kind: 'number', key: 'maxResults', label: 'Results', min: 1, max: 20 },
      ],
    }
    const missing = validateManifestConfig(manifest, {})
    expect(missing.issues[0]?.code).toBe('field.required')
    const range = validateManifestConfig(manifest, { apiKey: 'x', maxResults: 30 })
    expect(range.issues[0]?.code).toBe('field.max')
    expect(range.issues[0]?.params).toEqual({ label: 'Results', max: 20 })
  })
})
