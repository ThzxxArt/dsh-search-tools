/** Fixed public HTML endpoints, descriptors, and safe URL construction for local-direct. */

import type { LocalDirectConfig, LocalDirectEngine, LocalDirectProfile } from './schema.ts'
import {
  isLocalDirectNoResults,
  parseBing,
  parseBrave,
  parseDuckDuckGo,
  parseSo360,
  type LocalDirectParseOptions,
  type LocalDirectParseResult,
} from './parse.ts'

interface MarketProfile {
  ddg: string
  bingLang: string
  bingCountry: string
  locale: string
}

const MARKET_PROFILES: Readonly<Record<LocalDirectConfig['market'], MarketProfile>> = {
  auto: { ddg: 'wt-wt', bingLang: '', bingCountry: '', locale: '' },
  'us-en': { ddg: 'us-en', bingLang: 'en', bingCountry: 'US', locale: 'en-US,en;q=0.9' },
  'cn-zh': { ddg: 'cn-zh', bingLang: 'zh-hans', bingCountry: 'CN', locale: 'zh-CN,zh;q=0.9,en;q=0.5' },
  'gb-en': { ddg: 'uk-en', bingLang: 'en', bingCountry: 'GB', locale: 'en-GB,en;q=0.9' },
  'jp-ja': { ddg: 'jp-jp', bingLang: 'ja', bingCountry: 'JP', locale: 'ja-JP,ja;q=0.9' },
  'de-de': { ddg: 'de-de', bingLang: 'de', bingCountry: 'DE', locale: 'de-DE,de;q=0.9' },
  'fr-fr': { ddg: 'fr-fr', bingLang: 'fr', bingCountry: 'FR', locale: 'fr-FR,fr;q=0.9' },
}

const DDG_SAFE: Readonly<Record<LocalDirectConfig['safeSearch'], string>> = {
  off: '-2',
  moderate: '-1',
  strict: '1',
}

export interface LocalDirectEngineDescriptor {
  readonly id: LocalDirectEngine
  readonly origin: string
  readonly path: string
  readonly label: string
  /**
   * Brave Search answers the Chrome Impit profile with a stable 429 while the
   * same request succeeds with the Firefox profile. Pin only that engine's
   * transport profile; the user-facing `profile` remains authoritative for
   * engines that do not declare an override.
   */
  readonly transportProfile?: LocalDirectProfile
  buildUrl(query: string, config: LocalDirectConfig): URL
  parse(html: string, options?: LocalDirectParseOptions): LocalDirectParseResult
  noResults(html: string): boolean
}

/**
 * The single engine registry. Adding an engine requires one schema union
 * member and one descriptor entry; TypeScript rejects an incomplete record.
 */
export const LOCAL_DIRECT_ENGINE_DESCRIPTORS: Readonly<
  Record<LocalDirectEngine, LocalDirectEngineDescriptor>
> = {
  duckduckgo: {
    id: 'duckduckgo',
    origin: 'https://html.duckduckgo.com',
    path: '/html/',
    label: 'DuckDuckGo',
    buildUrl: buildDuckDuckGoUrl,
    parse: parseDuckDuckGo,
    noResults: html => isLocalDirectNoResults('duckduckgo', html),
  },
  bing: {
    id: 'bing',
    origin: 'https://www.bing.com',
    path: '/search',
    label: 'Bing',
    buildUrl: buildBingUrl,
    parse: parseBing,
    noResults: html => isLocalDirectNoResults('bing', html),
  },
  brave: {
    id: 'brave',
    origin: 'https://search.brave.com',
    path: '/search',
    label: 'Brave Search',
    transportProfile: 'firefox',
    buildUrl: buildBraveUrl,
    parse: parseBrave,
    noResults: html => isLocalDirectNoResults('brave', html),
  },
  so360: {
    id: 'so360',
    origin: 'https://www.so.com',
    path: '/s',
    label: '360 Search',
    buildUrl: buildSo360Url,
    parse: parseSo360,
    noResults: html => isLocalDirectNoResults('so360', html),
  },
}

export const LOCAL_DIRECT_ORIGINS: Readonly<Record<LocalDirectEngine, string>> = {
  duckduckgo: LOCAL_DIRECT_ENGINE_DESCRIPTORS.duckduckgo.origin,
  bing: LOCAL_DIRECT_ENGINE_DESCRIPTORS.bing.origin,
  brave: LOCAL_DIRECT_ENGINE_DESCRIPTORS.brave.origin,
  so360: LOCAL_DIRECT_ENGINE_DESCRIPTORS.so360.origin,
}

export const LOCAL_DIRECT_ENGINE_LABELS: Readonly<Record<LocalDirectEngine, string>> = {
  duckduckgo: LOCAL_DIRECT_ENGINE_DESCRIPTORS.duckduckgo.label,
  bing: LOCAL_DIRECT_ENGINE_DESCRIPTORS.bing.label,
  brave: LOCAL_DIRECT_ENGINE_DESCRIPTORS.brave.label,
  so360: LOCAL_DIRECT_ENGINE_DESCRIPTORS.so360.label,
}

/** Query parameter names are part of the fixed contract; only values vary. */
export function buildEngineUrl(engine: LocalDirectEngine, query: string, config: LocalDirectConfig): URL {
  return LOCAL_DIRECT_ENGINE_DESCRIPTORS[engine].buildUrl(query, config)
}

export function acceptLanguageFor(config: LocalDirectConfig): string | undefined {
  const value = MARKET_PROFILES[config.market].locale
  return value.length === 0 ? undefined : value
}

export function assertFixedOrigin(engine: LocalDirectEngine, url: string): void {
  const descriptor = LOCAL_DIRECT_ENGINE_DESCRIPTORS[engine]
  const parsed = new URL(url)
  if (parsed.origin !== descriptor.origin) {
    throw new Error(`local-direct engine "${engine}" must use ${descriptor.origin}`)
  }
  if (parsed.pathname !== descriptor.path) {
    throw new Error(`local-direct engine "${engine}" must use path ${descriptor.path}`)
  }
  if (parsed.hash.length > 0) throw new Error('local-direct engine URLs must not contain a fragment')
}

function buildDuckDuckGoUrl(query: string, config: LocalDirectConfig): URL {
  const market = MARKET_PROFILES[config.market]
  const url = new URL(LOCAL_DIRECT_ENGINE_DESCRIPTORS.duckduckgo.path, LOCAL_DIRECT_ENGINE_DESCRIPTORS.duckduckgo.origin)
  url.searchParams.set('q', query)
  url.searchParams.set('kl', market.ddg)
  url.searchParams.set('kp', DDG_SAFE[config.safeSearch])
  url.hash = ''
  return url
}

function buildBingUrl(query: string, config: LocalDirectConfig): URL {
  const market = MARKET_PROFILES[config.market]
  const descriptor = LOCAL_DIRECT_ENGINE_DESCRIPTORS.bing
  const url = new URL(descriptor.path, descriptor.origin)
  url.searchParams.set('q', query)
  if (market.bingLang.length > 0) url.searchParams.set('setlang', market.bingLang)
  if (market.bingCountry.length > 0) url.searchParams.set('cc', market.bingCountry)
  url.searchParams.set('adlt', config.safeSearch)
  url.hash = ''
  return url
}

function buildBraveUrl(query: string, config: LocalDirectConfig): URL {
  const descriptor = LOCAL_DIRECT_ENGINE_DESCRIPTORS.brave
  const url = new URL(descriptor.path, descriptor.origin)
  url.searchParams.set('q', query)
  url.searchParams.set('safeSearch', config.safeSearch)
  url.hash = ''
  return url
}

function buildSo360Url(query: string, _config: LocalDirectConfig): URL {
  const url = new URL(LOCAL_DIRECT_ENGINE_DESCRIPTORS.so360.path, LOCAL_DIRECT_ENGINE_DESCRIPTORS.so360.origin)
  url.searchParams.set('q', query)
  url.searchParams.set('ie', 'utf-8')
  url.hash = ''
  return url
}
