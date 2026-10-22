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
