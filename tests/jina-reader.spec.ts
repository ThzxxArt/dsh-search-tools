import { describe, expect, it } from 'vitest'
import { jinaReaderManifest } from '../src/fetch/adapters/jina-reader/manifest.ts'
import {
  DEFAULT_JINA_READER_CONFIG,
  normalizeJinaReaderConfig,
  validateJinaReaderConfig,
} from '../src/fetch/adapters/jina-reader/schema.ts'
import { isPublicIpAddress, resolveJinaTarget } from '../src/fetch/adapters/jina-reader/target.ts'

describe('Jina Reader config', () => {
  it('ships conservative defaults that fit below the DSH web_fetch 30s tool timeout', () => {
    expect(DEFAULT_JINA_READER_CONFIG).toMatchObject({
      enabled: true,
      endpoint: 'https://r.jina.ai/',
      engine: 'auto',
      responseMode: 'markdown',
      timeoutMs: 25_000,
      maxResponseBytes: 5_000_000,
      maxBodyChars: 200_000,
      includeIframes: false,
      includeShadowDom: false,
      noCache: false,
      respectRobots: true,
      retainImages: 'none',
      retainLinks: 'all',
      upstreamProxy: 'none',
      locale: '',
      userAgent: '',
    })
  })

  it('normalizes a valid self-hosted loopback endpoint and keeps unknown values bounded', () => {
    const config = normalizeJinaReaderConfig({
      endpoint: 'http://127.0.0.1:3000/',
      engine: 'browser',
      responseMode: 'text',
      timeoutMs: 60_000,
      maxBodyChars: 12_000,
      targetSelector: 'article',
      retainImages: 'all',
      upstreamProxy: 'auto',
    })
    expect(config.endpoint).toBe('http://127.0.0.1:3000/')
    expect(config.engine).toBe('browser')
    expect(config.responseMode).toBe('text')
    expect(config.timeoutMs).toBe(60_000)
    expect(config.targetSelector).toBe('article')
    expect(config.retainImages).toBe('all')
    expect(config.upstreamProxy).toBe('auto')

    const fallback = normalizeJinaReaderConfig({ engine: 'nope', responseMode: 'nope', timeoutMs: 999_999 })
    expect(fallback.engine).toBe('auto')
    expect(fallback.responseMode).toBe('markdown')
    expect(fallback.timeoutMs).toBe(180_000)
  })

  it('validates endpoints, selectors, enums, and numeric bounds without a secret in config', () => {
    expect(validateJinaReaderConfig({}).ok).toBe(true)
    expect(validateJinaReaderConfig({ engine: 'curl' }).ok).toBe(true)
    expect(normalizeJinaReaderConfig({ engine: 'curl' }).engine).toBe('curl')
    expect(validateJinaReaderConfig({ endpoint: 'http://127.0.0.1:3000' }).ok).toBe(true)
    expect(validateJinaReaderConfig({ endpoint: 'http://reader.example.com' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'endpoint' })]))
    expect(validateJinaReaderConfig({ endpoint: 'http://127.evil.example:3000' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'endpoint' })]))
    expect(validateJinaReaderConfig({ endpoint: 'ftp://reader.example.com' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'endpoint' })]))
    expect(validateJinaReaderConfig({ endpoint: 'https://user:pass@reader.example.com' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'endpoint' })]))
    expect(validateJinaReaderConfig({ endpoint: 'https://reader.example.com/?token=1' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'endpoint' })]))
    expect(validateJinaReaderConfig({ endpoint: 'https://reader.example.com/#fragment' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'endpoint' })]))
    expect(validateJinaReaderConfig({ targetSelector: 'article\nbody' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'targetSelector' })]))
    expect(validateJinaReaderConfig({ locale: 'not a locale!' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'locale' })]))
    expect(validateJinaReaderConfig({ userAgent: 'bad\nagent' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'userAgent' })]))
    expect(validateJinaReaderConfig({ engine: 'nope' }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'engine' })]))
    expect(validateJinaReaderConfig({ timeoutMs: 999 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'timeoutMs' })]))
    expect(validateJinaReaderConfig({ timeoutMs: 1_000 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'timeoutMs' })]))
    expect(normalizeJinaReaderConfig({ timeoutMs: 1_000 }).timeoutMs).toBe(2_000)
    expect(validateJinaReaderConfig({ maxResponseBytes: 1 }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: 'maxResponseBytes' })]))
  })

  it('describes a browser/PDF fetch adapter and a write-only API key', () => {
    expect(jinaReaderManifest).toMatchObject({
      kind: 'fetch',
      id: 'jina-reader',
    })
    expect(jinaReaderManifest.capabilities).toEqual(expect.arrayContaining(['browser', 'pdf', 'probe']))
    expect(jinaReaderManifest.notice).toBeDefined()
    expect(jinaReaderManifest.secretRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'JINA_API_KEY' }),
    ]))
    expect(jinaReaderManifest.fields.map(field => field.key)).toEqual(expect.arrayContaining([
      'endpoint', 'engine', 'responseMode', 'timeoutMs', 'maxBodyChars', 'targetSelector', 'noCache',
    ]))
    expect(JSON.stringify(jinaReaderManifest.defaults)).not.toContain('JINA_API_KEY')
    expect(jinaReaderManifest.fields.some(field => field.key === 'apiKey')).toBe(false)
  })
})

describe('Jina public-target guard', () => {
  const signal = new AbortController().signal
  const publicResolver = async (): Promise<Array<{ address: string; family: 4 }>> => [
    { address: '93.184.216.34', family: 4 },
  ]

  it('accepts a public target and preserves its path/query', async () => {
    const target = await resolveJinaTarget('https://public.example/article?id=1', signal, publicResolver)
    expect(target.toString()).toBe('https://public.example/article?id=1')
    expect(isPublicIpAddress('93.184.216.34')).toBe(true)
    expect(isPublicIpAddress('10.0.0.1')).toBe(false)
    expect(isPublicIpAddress('127.0.0.1')).toBe(false)
    expect(isPublicIpAddress('::1')).toBe(false)
    expect(isPublicIpAddress('::7f00:1')).toBe(false)
    expect(isPublicIpAddress('::a00:1')).toBe(false)
    expect(isPublicIpAddress('::ffff:10.0.0.1')).toBe(false)
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicIpAddress('100.64.0.1')).toBe(false)
    expect(isPublicIpAddress('169.254.1.1')).toBe(false)
    expect(isPublicIpAddress('fe80::1')).toBe(false)
    expect(isPublicIpAddress('fc00::1')).toBe(false)
    expect(isPublicIpAddress('::ffff:93.184.216.34')).toBe(true)
    expect(isPublicIpAddress('64:ff9b::a00:1')).toBe(false)
    expect(isPublicIpAddress('2002:0a00:0001::')).toBe(false)
  })

  it('rejects private literal targets and credentials before any request', async () => {
    await expect(resolveJinaTarget('http://127.0.0.1/admin', signal))
      .rejects.toMatchObject({ code: 'JINA_TARGET_BLOCKED' })
    await expect(resolveJinaTarget('http://[::7f00:1]/admin', signal))
      .rejects.toMatchObject({ code: 'JINA_TARGET_BLOCKED' })
    await expect(resolveJinaTarget('http://[::ffff:127.0.0.1]/admin', signal))
      .rejects.toMatchObject({ code: 'JINA_TARGET_BLOCKED' })
    await expect(resolveJinaTarget('https://user:pass@public.example/', signal, publicResolver))
      .rejects.toMatchObject({ code: 'JINA_INVALID_TARGET' })
    await expect(resolveJinaTarget('ftp://public.example/file', signal, publicResolver))
      .rejects.toMatchObject({ code: 'JINA_INVALID_TARGET' })
  })

  it('rejects a hostname with any private answer and an empty answer set', async () => {
    const privateResolver = async (): Promise<Array<{ address: string; family: 4 | 6 }>> => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]
    await expect(resolveJinaTarget('https://mixed.example/', signal, privateResolver))
      .rejects.toMatchObject({ code: 'JINA_TARGET_BLOCKED' })
    await expect(resolveJinaTarget('https://empty.example/', signal, async () => []))
      .rejects.toMatchObject({ code: 'JINA_TARGET_UNRESOLVED' })
  })

  it('maps resolution failures and caller abort to stable codes', async () => {
    await expect(resolveJinaTarget('https://missing.example/', signal, async () => {
      throw new Error('ENOTFOUND')
    })).rejects.toMatchObject({ code: 'JINA_TARGET_UNRESOLVED' })

    const aborted = new AbortController()
    aborted.abort(new Error('stop'))
    await expect(resolveJinaTarget('https://public.example/', aborted.signal, publicResolver))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
})

describe('Jina Reader registration contract', () => {
  it('is a registered fetch adapter and is present in the built-in defaults without changing the default', async () => {
    const { jinaReaderAdapter } = await import('../src/fetch/adapters/jina-reader/adapter.ts')
    const { DEFAULT_FETCH_SECTION } = await import('../src/shared/defaults.ts')
    expect(jinaReaderAdapter.manifest).toBe(jinaReaderManifest)
    expect(jinaReaderAdapter.validate({}).ok).toBe(true)
    expect(DEFAULT_FETCH_SECTION.adapter).toBe('readable-http')
    expect(DEFAULT_FETCH_SECTION.adapters['jina-reader']).toMatchObject({ endpoint: 'https://r.jina.ai/' })
  })
})
