import { describe, expect, it } from 'vitest'
import { validateManifestConfig } from '../src/shared/validation.ts'
import { buildEngineUrl, assertFixedOrigin, acceptLanguageFor } from '../src/search/adapters/local-direct/engines.ts'
import { localDirectManifest } from '../src/search/adapters/local-direct/manifest.ts'
import {
  DEFAULT_LOCAL_DIRECT_CONFIG, normalizeLocalDirectConfig, validateLocalDirectConfig,
} from '../src/search/adapters/local-direct/schema.ts'
import { fuseSources } from '../src/search/adapters/local-direct/fusion.ts'

describe('local-direct schema', () => {
  it('fills the zero-deployment defaults', () => {
    const config = normalizeLocalDirectConfig({})
    expect(config).toMatchObject({
      enabled: true,
      engines: ['duckduckgo', 'bing'],
      market: 'auto',
      safeSearch: 'moderate',
      maxResults: 10,
      maxPerHost: 2,
      profile: 'chrome',
      requestTimeoutMs: 8_000,
      deadlineMs: 15_000,
      maxResponseBytes: 2_000_000,
    })
    expect(config.proxy).toBe('')
    expect(config.includeDomains).toEqual([])
  })

  it('normalises engine duplicates and unknown values out of the runtime config', () => {
    const config = normalizeLocalDirectConfig({ engines: ['bing', 'BING', 'bogus', 'duckduckgo'] })
    expect(config.engines).toEqual(['bing', 'duckduckgo'])
    expect(normalizeLocalDirectConfig({ engines: ['SO360', 'bogus'] }).engines)
      .toEqual(['so360'])
    expect(normalizeLocalDirectConfig({ engines: ['BRAVE', 'so360'] }).engines)
      .toEqual(['brave', 'so360'])
    expect(validateLocalDirectConfig({ engines: ['brave', 'so360'] }).ok).toBe(true)
  })

  it('rejects empty, duplicate, and unknown engines instead of silently accepting them', () => {
    expect(validateLocalDirectConfig({ engines: [] }).issues[0]?.code).toBe('local.enginesEmpty')
    expect(validateLocalDirectConfig({ engines: ['bing', 'bing'] }).issues[0]?.code).toBe('local.engineDuplicate')
    expect(validateLocalDirectConfig({ engines: ['google'] }).issues[0]?.code).toBe('local.engineOption')
    expect(validateLocalDirectConfig({ engines: 'bing' }).issues[0]?.code).toBe('field.stringArray')
  })

  it('validates every numeric bound and the deadline relationship', () => {
    for (const [key, value, code] of [
      ['maxResults', 0, 'field.min'],
      ['maxResults', 21, 'field.max'],
      ['maxPerHost', 0, 'field.min'],
      ['maxPerHost', 6, 'field.max'],
      ['requestTimeoutMs', 999, 'field.min'],
      ['requestTimeoutMs', 30_001, 'field.max'],
      ['deadlineMs', 999, 'field.min'],
      ['deadlineMs', 60_001, 'field.max'],
      ['retries', 3, 'field.max'],
      ['minIntervalMs', -1, 'field.min'],
      ['cacheTtlMs', -1, 'field.min'],
      ['cacheMaxEntries', 1_001, 'field.max'],
      ['maxResponseBytes', 1_023, 'field.min'],
    ] as const) {
      const result = validateLocalDirectConfig({ [key]: value })
      expect(result.ok, `${key}=${String(value)}`).toBe(false)
      expect(result.issues.some(issue => issue.path === key && issue.code === code), key).toBe(true)
    }
    expect(validateLocalDirectConfig({ requestTimeoutMs: 5_000, deadlineMs: 4_000 }).issues[0]?.code)
      .toBe('local.deadlineBeforeRequest')
  })

  it('rejects an invalid or credential-bearing proxy', () => {
    expect(validateLocalDirectConfig({ proxy: 'socks5://proxy.example:1080' }).issues[0]?.code)
      .toBe('local.proxyCredentials')
    expect(validateLocalDirectConfig({ proxy: 'not a url' }).issues[0]?.code).toBe('local.proxyInvalid')
  })

  it('exposes fields the page can render without adapter code', () => {
    const engines = localDirectManifest.fields.find(field => field.key === 'engines')
    expect(engines?.kind).toBe('checkboxes')
    expect(localDirectManifest.capabilities).toEqual(['html', 'probe', 'cache'])
    expect(typeof localDirectManifest.notice === 'string'
      ? localDirectManifest.notice
      : localDirectManifest.notice?.en).toContain('JavaScript is not executed')
    expect(localDirectManifest.fields.some(field => field.kind === 'instances')).toBe(false)
    expect(localDirectManifest.defaults).toMatchObject(DEFAULT_LOCAL_DIRECT_CONFIG)
  })

  it('validates checkbox options through the generic manifest validator', () => {
    expect(validateManifestConfig(localDirectManifest, { engines: [] }).issues[0]?.code).toBe('field.required')
    expect(validateManifestConfig(localDirectManifest, { engines: ['bing', 'google'] }).issues[0]?.code)
      .toBe('field.option')
  })
})

describe('local-direct fixed engine URLs', () => {
  it('builds DDG and Bing URLs only on their fixed origins', () => {
    const config = normalizeLocalDirectConfig({ market: 'cn-zh', safeSearch: 'strict' })
    const ddg = buildEngineUrl('duckduckgo', '深度求索 harness', config)
    const bing = buildEngineUrl('bing', '深度求索 harness', config)
    expect(ddg.origin).toBe('https://html.duckduckgo.com')
    expect(ddg.pathname).toBe('/html/')
    expect(ddg.searchParams.get('q')).toBe('深度求索 harness')
    expect(ddg.searchParams.get('kl')).toBe('cn-zh')
    expect(ddg.searchParams.get('kp')).toBe('1')
    expect(bing.origin).toBe('https://www.bing.com')
    expect(bing.searchParams.get('q')).toBe('深度求索 harness')
    expect(bing.searchParams.get('setlang')).toBe('zh-hans')
    expect(bing.searchParams.get('cc')).toBe('CN')
    expect(bing.searchParams.get('adlt')).toBe('strict')

    const so360 = buildEngineUrl('so360', '深度求索 harness', config)
    expect(so360.origin).toBe('https://www.so.com')
    expect(so360.pathname).toBe('/s')
    expect(so360.searchParams.get('q')).toBe('深度求索 harness')
    expect(so360.searchParams.get('ie')).toBe('utf-8')

    const brave = buildEngineUrl('brave', '深度求索 harness', config)
    expect(brave.origin).toBe('https://search.brave.com')
    expect(brave.pathname).toBe('/search')
    expect(brave.searchParams.get('q')).toBe('深度求索 harness')
    expect(brave.searchParams.get('safeSearch')).toBe('strict')

    expect(acceptLanguageFor(config)).toContain('zh-CN')
    expect(() => assertFixedOrigin('bing', ddg.toString())).toThrow(/fixed|must use/)
  })

  it('allows every engine to be queried through a stable URL and rejects path swaps', () => {
    const config = normalizeLocalDirectConfig({})
    for (const engine of ['duckduckgo', 'bing', 'brave', 'so360'] as const) {
      const url = buildEngineUrl(engine, 'q', config)
      expect(() => assertFixedOrigin(engine, url.toString())).not.toThrow()
    }
    expect(() => assertFixedOrigin('bing', 'https://evil.example/search')).toThrow()
    expect(() => assertFixedOrigin('bing', 'https://www.bing.com/evil')).toThrow(/path/)
  })
})

describe('local-direct RRF fusion', () => {
  it('fuses rank positions, merges metadata, and respects maxPerHost', () => {
    const fused = fuseSources([
      {
        engine: 'duckduckgo',
        sources: [
          { url: 'https://a.example/one', title: 'A one', snippet: 'short' },
          { url: 'https://a.example/two', title: 'A two' },
        ],
      },
      {
        engine: 'bing',
        sources: [
          { url: 'https://a.example/two', title: 'A two longer', snippet: 'longer snippet' },
          { url: 'https://b.example/one', title: 'B one' },
        ],
      },
    ], 10, 2)

    expect(fused.sources[0]?.url).toBe('https://a.example/two')
    expect(fused.sources[0]?.title).toBe('A two longer')
    expect(fused.sources[0]?.snippet).toBe('longer snippet')
    expect(fused.sources.map(source => source.url)).toEqual([
      'https://a.example/two',
      'https://a.example/one',
      'https://b.example/one',
    ])
    expect(fused.truncated).toBe(false)
  })

  it('marks the result truncated when the limit or per-host diversity trims it', () => {
    const limited = fuseSources([{
      engine: 'duckduckgo',
      sources: [
        { url: 'https://a.example/1' },
        { url: 'https://a.example/2' },
        { url: 'https://a.example/3' },
      ],
    }], 2, 2)
    expect(limited.sources).toHaveLength(2)
    expect(limited.truncated).toBe(true)

    const diverse = fuseSources([{
      engine: 'bing',
      sources: [
        { url: 'https://a.example/1' },
        { url: 'https://a.example/2' },
        { url: 'https://a.example/3' },
      ],
    }], 10, 2)
    expect(diverse.sources).toHaveLength(2)
    expect(diverse.truncated).toBe(true)
  })
})
