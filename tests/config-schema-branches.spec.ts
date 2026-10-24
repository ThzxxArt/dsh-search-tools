import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_DIRECT_CONFIG, normalizeLocalDirectConfig, validateLocalDirectConfig,
} from '../src/search/adapters/local-direct/schema.ts'
import { validateSearxngConfig } from '../src/search/adapters/searxng/schema.ts'
import {
  JinaEndpointError, normalizeJinaEndpoint, normalizeJinaReaderConfig, validateJinaReaderConfig,
} from '../src/fetch/adapters/jina-reader/schema.ts'
import {
  normalizeReadableHttpConfig, validateReadableHttpConfig,
} from '../src/fetch/adapters/readable-http/schema.ts'
import {
  normalizeWireHttpConfig, validateWireHttpConfig,
} from '../src/fetch/adapters/wire-http/schema.ts'

function codesOf(validation: { issues: readonly { code?: string }[] }): string[] {
  return validation.issues.flatMap(entry => entry.code === undefined ? [] : [entry.code])
}

describe('local-direct config branches', () => {
  it('rejects malformed engines, enums, numbers, arrays, text, and proxies', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ enabled: 'yes' }, 'field.boolean'],
      [{ engines: 'ddg' }, 'field.stringArray'],
      [{ engines: [] }, 'local.enginesEmpty'],
      [{ engines: [1] }, 'field.stringArray'],
      [{ engines: ['nope'] }, 'local.engineOption'],
      [{ engines: ['bing', 'BING'] }, 'local.engineDuplicate'],
      [{ market: 1 }, 'field.option'],
      [{ market: 'nope' }, 'field.option'],
      [{ safeSearch: 'nope' }, 'field.option'],
      [{ profile: 'nope' }, 'field.option'],
      [{ maxResults: 1.5 }, 'field.number'],
      [{ maxResults: 0 }, 'field.min'],
      [{ maxResults: 21 }, 'field.max'],
      [{ maxResults: Number.POSITIVE_INFINITY }, 'field.number'],
      [{ includeDomains: ['ok', 1] }, 'field.stringArray'],
      [{ excludeDomains: 'bad' }, 'field.stringArray'],
      [{ proxy: 1 }, 'field.string'],
      [{ proxy: 'http://user:pass@proxy.example' }, 'local.proxyCredentials'],
      [{ proxy: 'ftp://proxy.example' }, 'local.proxyCredentials'],
      [{ proxy: 'not a url' }, 'local.proxyInvalid'],
      [{ deadlineMs: 1_000, requestTimeoutMs: 2_000 }, 'local.deadlineBeforeRequest'],
    ]
    for (const [config, code] of cases) {
      expect(codesOf(validateLocalDirectConfig(config)), JSON.stringify(config)).toContain(code)
    }
  })

  it('normalizes malformed values to safe defaults and typed arrays', () => {
    expect(normalizeLocalDirectConfig(null).engines).toEqual(DEFAULT_LOCAL_DIRECT_CONFIG.engines)
    expect(normalizeLocalDirectConfig({ engines: 'bad' }).engines).toEqual([])
    expect(normalizeLocalDirectConfig({ engines: [] }).engines).toEqual([])
    expect(normalizeLocalDirectConfig({ engines: [1, ' BING ', 'bing'] }).engines).toEqual(['bing'])
    expect(normalizeLocalDirectConfig({
      enabled: 'yes',
      engines: [' BING ', 'bing', 'nope', 1],
      market: 'nope',
      safeSearch: 'nope',
      profile: 'nope',
      maxResults: 999,
      maxPerHost: 0,
      requestTimeoutMs: Number.NaN,
      deadlineMs: Number.NaN,
      retries: -1,
      minIntervalMs: 99_999,
      cacheTtlMs: -1,
      cacheMaxEntries: 99_999,
      maxResponseBytes: 1,
      proxy: '  http://proxy.example  ',
      includeDomains: [' A ', 1],
      excludeDomains: 'bad',
    })).toMatchObject({
      enabled: true,
      engines: ['bing'],
      market: 'auto',
      safeSearch: 'moderate',
      profile: 'chrome',
      maxResults: 20,
      maxPerHost: 1,
      requestTimeoutMs: DEFAULT_LOCAL_DIRECT_CONFIG.requestTimeoutMs,
      deadlineMs: DEFAULT_LOCAL_DIRECT_CONFIG.deadlineMs,
      retries: 0,
      minIntervalMs: 10_000,
      cacheTtlMs: 0,
      cacheMaxEntries: 1_000,
      maxResponseBytes: 65_536,
      proxy: 'http://proxy.example',
      includeDomains: ['A'],
      excludeDomains: [],
    })
  })
})

describe('Jina endpoint and config branches', () => {
  it('normalizes each allowed endpoint shape and rejects each invalid shape', () => {
    expect(normalizeJinaEndpoint('https://reader.example/path///')).toBe('https://reader.example/path/')
    expect(normalizeJinaEndpoint('http://localhost:9999')).toBe('http://localhost:9999/')
    expect(normalizeJinaEndpoint('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999/')
    expect(normalizeJinaEndpoint('http://[::1]:9999')).toBe('http://[::1]:9999/')

    for (const [endpoint, code] of [
      ['', 'jina.endpointEmpty'],
      ['ftp://reader.example', 'jina.endpointInvalid'],
      ['http://reader.example', 'jina.endpointInsecure'],
      ['http://user:pass@reader.example', 'jina.endpointCredentials'],
      ['https://reader.example/?q=1', 'jina.endpointQuery'],
      ['https://reader.example/#x', 'jina.endpointQuery'],
      ['https://reader.example', ''],
      ['http://10.0.0.1', 'jina.endpointInsecure'],
    ] as const) {
      if (code === '') {
        expect(normalizeJinaEndpoint(endpoint)).toBe('https://reader.example/')
      } else {
        expect(() => normalizeJinaEndpoint(endpoint), endpoint).toThrow(JinaEndpointError)
        try {
          normalizeJinaEndpoint(endpoint)
        } catch (error) {
          expect((error as JinaEndpointError).code, endpoint).toBe(code)
        }
      }
    }
  })

  it('rejects malformed numbers, enums, booleans, selectors, locale, and user-agent', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ endpoint: 1 }, 'field.string'],
      [{ endpoint: 'ftp://x' }, 'jina.endpointInvalid'],
      [{ timeoutMs: 1.5 }, 'field.number'],
      [{ timeoutMs: 1_000 }, 'field.min'],
      [{ timeoutMs: 999_999 }, 'field.max'],
      [{ maxResponseBytes: 1 }, 'field.min'],
      [{ maxBodyChars: 1 }, 'field.min'],
      [{ engine: 'nope' }, 'field.option'],
      [{ responseMode: 1 }, 'field.option'],
      [{ retainImages: 'nope' }, 'field.option'],
      [{ retainLinks: 'nope' }, 'field.option'],
      [{ upstreamProxy: 'nope' }, 'field.option'],
      [{ enabled: 'yes' }, 'field.boolean'],
      [{ includeIframes: 'yes' }, 'field.boolean'],
      [{ includeShadowDom: 'yes' }, 'field.boolean'],
      [{ noCache: 'yes' }, 'field.boolean'],
      [{ respectRobots: 'yes' }, 'field.boolean'],
      [{ waitForSelector: 1 }, 'field.string'],
      [{ targetSelector: 'x'.repeat(1_001) }, 'jina.selector'],
      [{ removeSelector: 'x\n' }, 'jina.selector'],
      [{ locale: 1 }, 'field.string'],
      [{ locale: 'not a locale' }, 'jina.locale'],
      [{ userAgent: 1 }, 'field.string'],
      [{ userAgent: 'x'.repeat(513) }, 'jina.userAgent'],
      [{ userAgent: 'x\n' }, 'jina.userAgent'],
    ]
    for (const [config, code] of cases) {
      expect(codesOf(validateJinaReaderConfig(config)), JSON.stringify(config)).toContain(code)
    }
  })

  it('normalizes invalid values and accepts a complete valid config', () => {
    const valid = {
      endpoint: 'https://reader.example/',
      engine: 'browser',
      responseMode: 'html',
      timeoutMs: 30_000,
      maxResponseBytes: 10_000,
      maxBodyChars: 20_000,
      waitForSelector: ' main ',
      targetSelector: ' article ',
      removeSelector: ' nav ',
      includeIframes: true,
      includeShadowDom: true,
      noCache: true,
      respectRobots: false,
      retainImages: 'all',
      retainLinks: 'none',
      upstreamProxy: 'auto',
      locale: 'zh-CN',
      userAgent: 'test-agent',
    }
    expect(validateJinaReaderConfig(valid).ok).toBe(true)
    expect(normalizeJinaReaderConfig({
      ...valid,
      endpoint: 'not-a-url',
      engine: 'nope',
      responseMode: 'nope',
      retainImages: 'nope',
      retainLinks: 'nope',
      upstreamProxy: 'nope',
      waitForSelector: 1,
      locale: 2,
      userAgent: 3,
      timeoutMs: 1,
    })).toMatchObject({
      endpoint: 'not-a-url',
      engine: 'auto',
      responseMode: 'markdown',
      retainImages: 'none',
      retainLinks: 'all',
      upstreamProxy: 'none',
      waitForSelector: '',
      locale: '',
      userAgent: '',
      timeoutMs: 2_000,
    })
  })
})

describe('readable-http config branches', () => {
  it('rejects malformed numbers, booleans, user-agent, and cross-field limits', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ minArticleChars: 1.5 }, 'field.number'],
      [{ minArticleChars: -1 }, 'field.min'],
      [{ maxArticleChars: 1 }, 'field.min'],
      [{ maxResponseBytes: 1 }, 'field.min'],
      [{ maxBodyChars: 1 }, 'field.min'],
      [{ timeoutMs: 1 }, 'field.min'],
      [{ maxRedirects: 11 }, 'field.max'],
      [{ enabled: 'yes' }, 'field.boolean'],
      [{ readability: 'yes' }, 'field.boolean'],
      [{ failOpen: 'yes' }, 'field.boolean'],
      [{ userAgent: 1 }, 'field.string'],
      [{ userAgent: ' ' }, 'userAgent.invalid'],
      [{ userAgent: 'x\n y' }, 'userAgent.invalid'],
      [{ minArticleChars: 500, maxArticleChars: 100 }, 'readable.maxArticleBelowMin'],
      [{ minArticleChars: 500, maxBodyChars: 100 }, 'readable.maxBodyBelowMin'],
      [{ maxArticleChars: 1_000, maxBodyChars: 500 }, 'readable.maxArticleAboveBody'],
    ]
    for (const [config, code] of cases) {
      expect(codesOf(validateReadableHttpConfig(config)), JSON.stringify(config)).toContain(code)
    }
  })

  it('normalizes bounded values and user-agent fallback', () => {
    expect(normalizeReadableHttpConfig({
      enabled: 'yes',
      readability: 'yes',
      failOpen: 'yes',
      minArticleChars: -1,
      maxArticleChars: 999_999_999,
      maxResponseBytes: 1,
      maxBodyChars: 1,
      timeoutMs: 1,
      maxRedirects: 99,
      userAgent: '   ',
    })).toMatchObject({
      enabled: true,
      readability: true,
      failOpen: true,
      minArticleChars: 0,
      maxArticleChars: 5_000_000,
      maxResponseBytes: 1_024,
      maxBodyChars: 1_024,
      timeoutMs: 1_000,
      maxRedirects: 10,
    })
  })
})

describe('SearXNG proxy validation branches', () => {
  it('rejects non-http, credential-bearing, and malformed proxies while accepting a clean proxy', () => {
    expect(codesOf(validateSearxngConfig({ proxy: 'ftp://proxy.example' }))).toContain('proxy.credentials')
    expect(codesOf(validateSearxngConfig({ proxy: 'http://user:pass@proxy.example' }))).toContain('proxy.credentials')
    expect(codesOf(validateSearxngConfig({ proxy: 'not a url' }))).toContain('proxy.invalid')
    expect(validateSearxngConfig({ proxy: 'https://proxy.example' }).ok).toBe(true)
  })
})

describe('wire-http config branches', () => {
  it('rejects malformed numbers, profile, booleans, locale, and cross-field limits', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ timeoutMs: 1.5 }, 'field.number'],
      [{ timeoutMs: 1 }, 'field.min'],
      [{ maxResponseBytes: 1 }, 'field.min'],
      [{ maxBodyChars: 1 }, 'field.min'],
      [{ maxRedirects: 11 }, 'field.max'],
      [{ minArticleChars: 1.5 }, 'field.number'],
      [{ maxArticleChars: 1 }, 'field.min'],
      [{ maxPdfPages: 0 }, 'field.min'],
      [{ maxPdfPages: 21 }, 'field.max'],
      [{ profile: 1 }, 'field.option'],
      [{ profile: 'nope' }, 'field.option'],
      [{ enabled: 'yes' }, 'field.boolean'],
      [{ readability: 'yes' }, 'field.boolean'],
      [{ failOpen: 'yes' }, 'field.boolean'],
      [{ pdf: 'yes' }, 'field.boolean'],
      [{ locale: 1 }, 'field.string'],
      [{ locale: 'x'.repeat(65) }, 'wire.locale'],
      [{ locale: 'x\n' }, 'wire.locale'],
      [{ locale: 'not a locale' }, 'wire.locale'],
      [{ minArticleChars: 500, maxArticleChars: 100 }, 'wire.maxArticleBelowMin'],
      [{ minArticleChars: 500, maxBodyChars: 100 }, 'wire.maxBodyBelowMin'],
      [{ maxArticleChars: 1_000, maxBodyChars: 500 }, 'wire.maxArticleAboveBody'],
    ]
    for (const [config, code] of cases) {
      expect(codesOf(validateWireHttpConfig(config)), JSON.stringify(config)).toContain(code)
    }
  })

  it('normalizes malformed values and accepts empty locale', () => {
    expect(normalizeWireHttpConfig({
      enabled: 'yes',
      profile: 'nope',
      timeoutMs: 1,
      maxResponseBytes: 1,
      maxBodyChars: 1,
      maxRedirects: 99,
      locale: 1,
      readability: 'yes',
      minArticleChars: 999_999,
      maxArticleChars: 1,
      failOpen: 'yes',
      pdf: 'yes',
      maxPdfPages: 99,
    })).toMatchObject({
      enabled: true,
      profile: 'chrome',
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
      maxBodyChars: 1_024,
      maxRedirects: 10,
      locale: '',
      readability: true,
      minArticleChars: 100_000,
      maxArticleChars: 1_000,
      failOpen: true,
      pdf: true,
      maxPdfPages: 20,
    })
    expect(validateWireHttpConfig({ locale: '' }).ok).toBe(true)
  })
})
