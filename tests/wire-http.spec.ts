import { describe, expect, it } from 'vitest'
import type { AdapterManifest } from '../src/core/types.ts'
import { validateAdapterConfig } from '../src/client/settings-utils.ts'
import { DEFAULT_FETCH_SECTION, DEFAULT_STORED_CONFIG } from '../src/shared/defaults.ts'
import {
  DEFAULT_WIRE_HTTP_CONFIG,
  normalizeWireHttpConfig,
  validateWireHttpConfig,
} from '../src/fetch/adapters/wire-http/schema.ts'
import { wireHttpManifest } from '../src/fetch/adapters/wire-http/manifest.ts'
import { wireHttpAdapter } from '../src/fetch/adapters/wire-http/adapter.ts'
import {
  isPublicIpAddress,
  parseHttpTarget,
  resolvePublicTarget,
} from '../src/shared/public-target.ts'

describe('wire-http config', () => {
  it('ships local-only defaults below the DSH 30s fetch timeout', () => {
    expect(DEFAULT_WIRE_HTTP_CONFIG).toMatchObject({
      enabled: true,
      profile: 'chrome',
      timeoutMs: 25_000,
      maxResponseBytes: 5_000_000,
      maxBodyChars: 2_000_000,
      maxRedirects: 5,
      readability: true,
      failOpen: true,
      pdf: true,
      maxPdfPages: 10,
    })
    expect(DEFAULT_WIRE_HTTP_CONFIG.timeoutMs).toBeLessThan(30_000)
  })

  it('normalizes valid values and bounds unknown values', () => {
    const config = normalizeWireHttpConfig({
      profile: 'firefox',
      timeoutMs: 4_000,
      maxRedirects: 2,
      locale: ' zh-CN ',
      readability: false,
      pdf: false,
      maxPdfPages: 4,
    })
    expect(config).toMatchObject({
      profile: 'firefox',
      timeoutMs: 4_000,
      maxRedirects: 2,
      locale: 'zh-CN',
      readability: false,
      pdf: false,
      maxPdfPages: 4,
    })
    expect(normalizeWireHttpConfig({ profile: 'nope', timeoutMs: 1, maxPdfPages: 99 })).toMatchObject({
      profile: 'chrome',
      timeoutMs: 1_000,
      maxPdfPages: 20,
    })
  })

  it('validates numeric bounds, enums, booleans, locale, and cross-field limits', () => {
    expect(validateWireHttpConfig({}).ok).toBe(true)
    expect(validateWireHttpConfig({ profile: 'nope' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'profile', code: 'field.option' })]))
    expect(validateWireHttpConfig({ timeoutMs: 999 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'timeoutMs', code: 'field.min' })]))
    expect(validateWireHttpConfig({ maxRedirects: 11 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'maxRedirects', code: 'field.max' })]))
    expect(validateWireHttpConfig({ maxPdfPages: 0 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'maxPdfPages', code: 'field.min' })]))
    expect(validateWireHttpConfig({ enabled: 'yes' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'enabled', code: 'field.boolean' })]))
    expect(validateWireHttpConfig({ locale: 'not a locale!' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'locale', code: 'wire.locale' })]))
    expect(validateWireHttpConfig({ minArticleChars: 500, maxArticleChars: 100 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'maxArticleChars', code: 'wire.maxArticleBelowMin' })]))
    expect(validateWireHttpConfig({ maxArticleChars: 100_000, maxBodyChars: 10_000 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'maxArticleChars', code: 'wire.maxArticleAboveBody' })]))
  })

  it('is a fetch adapter with local capabilities, no secret, and a no-JS notice', () => {
    expect(wireHttpManifest).toMatchObject({ kind: 'fetch', id: 'wire-http' })
    expect(wireHttpManifest.capabilities).toEqual(expect.arrayContaining(['html', 'pdf', 'probe', 'readability']))
    expect(wireHttpManifest.capabilities).not.toContain('browser')
    expect(wireHttpManifest.secretRefs).toBeUndefined()
    expect(wireHttpManifest.notice).toBeDefined()
    expect(JSON.stringify(wireHttpManifest.notice)).toContain('third-party')
    expect(wireHttpManifest.fields.map(field => field.key)).toEqual(expect.arrayContaining([
      'enabled', 'profile', 'timeoutMs', 'maxRedirects', 'locale',
      'readability', 'minArticleChars', 'maxArticleChars', 'failOpen',
      'pdf', 'maxPdfPages', 'maxBodyChars',
    ]))
    expect(validateWireHttpConfig(wireHttpManifest.defaults).ok).toBe(true)
    expect(validateAdapterConfig(wireHttpManifest as AdapterManifest, wireHttpManifest.defaults)).toEqual([])
  })

  it('registers in the built-in defaults without changing the default adapter', () => {
    expect(wireHttpAdapter.manifest).toBe(wireHttpManifest)
    expect(wireHttpAdapter.validate({}).ok).toBe(true)
    expect(DEFAULT_FETCH_SECTION.adapter).toBe('readable-http')
    expect(DEFAULT_FETCH_SECTION.adapters['wire-http']).toMatchObject({ profile: 'chrome' })
    expect(DEFAULT_STORED_CONFIG.fetch.adapters['wire-http']).toMatchObject({ pdf: true })
  })
})

describe('shared public-target guard', () => {
  const signal = new AbortController().signal
  const publicResolver = async (): Promise<Array<{ address: string; family: 4 }>> => [
    { address: '93.184.216.34', family: 4 },
  ]

  it('parses only credential-free http(s) targets', () => {
    expect(parseHttpTarget('https://example.com/a?q=1', undefined).toString()).toBe('https://example.com/a?q=1')
    expect(() => parseHttpTarget('ftp://example.com/a')).toThrow(expect.objectContaining({ code: 'TARGET_INVALID' }))
    expect(() => parseHttpTarget('https://user:pass@example.com/')).toThrow(expect.objectContaining({ code: 'TARGET_INVALID' }))
    expect(() => parseHttpTarget(`https://example.com/${'a'.repeat(2_048)}`)).toThrow(expect.objectContaining({ code: 'TARGET_INVALID' }))
  })

  it('returns validated addresses and rejects mixed/private answers', async () => {
    const result = await resolvePublicTarget('https://public.example/a', signal, publicResolver)
    expect(result.url.toString()).toBe('https://public.example/a')
    expect(result.addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
    await expect(resolvePublicTarget('https://mixed.example/', signal, async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ])).rejects.toMatchObject({ code: 'TARGET_BLOCKED' })
    await expect(resolvePublicTarget('http://127.0.0.1/', signal)).rejects.toMatchObject({ code: 'TARGET_BLOCKED' })
  })

  it('rejects IPv4-mapped private, every known NAT64 form, 6to4, Teredo, CGNAT, and link-local addresses', () => {
    for (const address of [
      '::ffff:10.0.0.1', '64:ff9b::a00:1', '64:ff9b::5db8:d822',
      '64:ff9b:1::1', '2002:0a00:0001::', '2001:0000::1',
      '100.64.0.1', '169.254.1.1', 'fe80::1', 'fc00::1', '::7f00:1', '::a00:1',
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false)
    }
    expect(isPublicIpAddress('93.184.216.34')).toBe(true)
    expect(isPublicIpAddress('::ffff:93.184.216.34')).toBe(true)
  })
})
