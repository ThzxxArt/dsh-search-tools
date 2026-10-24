/** Fixed public HTML endpoints and safe URL construction for local-direct. */

import type { LocalDirectConfig, LocalDirectEngine } from './schema.ts'

export const LOCAL_DIRECT_ORIGINS: Readonly<Record<LocalDirectEngine, string>> = {
  duckduckgo: 'https://html.duckduckgo.com',
  bing: 'https://www.bing.com',
}

export const LOCAL_DIRECT_ENGINE_LABELS: Readonly<Record<LocalDirectEngine, string>> = {
  duckduckgo: 'DuckDuckGo',
  bing: 'Bing',
}

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

/** Query parameter names are part of the fixed contract; only values vary. */
export function buildEngineUrl(engine: LocalDirectEngine, query: string, config: LocalDirectConfig): URL {
  const market = MARKET_PROFILES[config.market]
  const url = engine === 'duckduckgo'
    ? new URL('/html/', LOCAL_DIRECT_ORIGINS.duckduckgo)
    : new URL('/search', LOCAL_DIRECT_ORIGINS.bing)
  if (engine === 'duckduckgo') {
    url.searchParams.set('q', query)
    url.searchParams.set('kl', market.ddg)
    url.searchParams.set('kp', DDG_SAFE[config.safeSearch])
  } else {
    url.searchParams.set('q', query)
    if (market.bingLang.length > 0) url.searchParams.set('setlang', market.bingLang)
    if (market.bingCountry.length > 0) url.searchParams.set('cc', market.bingCountry)
    url.searchParams.set('adlt', config.safeSearch)
  }
  url.hash = ''
  return url
}

export function acceptLanguageFor(config: LocalDirectConfig): string | undefined {
  const value = MARKET_PROFILES[config.market].locale
  return value.length === 0 ? undefined : value
}

export function assertFixedOrigin(engine: LocalDirectEngine, url: string): void {
  const parsed = new URL(url)
  if (parsed.origin !== LOCAL_DIRECT_ORIGINS[engine]) {
    throw new Error(`local-direct engine "${engine}" must use ${LOCAL_DIRECT_ORIGINS[engine]}`)
  }
  if (parsed.hash.length > 0) throw new Error('local-direct engine URLs must not contain a fragment')
}
