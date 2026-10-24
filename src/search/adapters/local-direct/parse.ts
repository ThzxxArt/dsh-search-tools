/** Local DDG/Bing HTML parsers. Fixtures own selector coverage. */

import { load } from 'cheerio'
import type { SearchResult, SearchSource } from '../../../core/types.ts'
import { domainMatches, normalizeResultUrl } from '../../../shared/url.ts'
import type { LocalDirectEngine } from './schema.ts'

const MAX_TITLE_CHARS = 500
const MAX_SNIPPET_CHARS = 2_000

export interface LocalDirectParseOptions {
  includeDomains?: readonly string[]
  excludeDomains?: readonly string[]
}

/** `rawSources` includes results removed by the domain filters. */
export type LocalDirectParseResult = SearchResult & { readonly rawSources: readonly SearchSource[] }

export function parseLocalDirectHtml(
  engine: LocalDirectEngine,
  html: string,
  options: LocalDirectParseOptions = {},
): LocalDirectParseResult {
  return engine === 'duckduckgo'
    ? parseDuckDuckGo(html, options)
    : parseBing(html, options)
}

export function parseDuckDuckGo(html: string, options: LocalDirectParseOptions = {}): LocalDirectParseResult {
  const $ = load(html)
  const sources = new Map<string, SearchSource>()
  $('.result').each((_index, element) => {
    const node = $(element)
    if (node.hasClass('result--ad') || node.closest('.result--ad').length > 0) return
    const link = node.find('h2 .result__a, .result__title .result__a').first()
    const rawHref = link.attr('href')
    if (rawHref === undefined || rawHref.length === 0) return
    const url = safeSourceUrl(unwrapDuckDuckGo(rawHref, 'https://html.duckduckgo.com'))
    if (url === undefined) return
    const title = cleanText(link.text())
    const snippet = cleanText(node.find('.result__snippet').first().text())
    addSource(sources, url, title, snippet)
  })
  const rawSources = [...sources.values()]
  return { sources: rawSources.filter(source => allowed(source.url, options)), rawSources, truncated: false }
}

export function parseBing(html: string, options: LocalDirectParseOptions = {}): LocalDirectParseResult {
  const $ = load(html)
  const sources = new Map<string, SearchSource>()
  $('li.b_algo').each((_index, element) => {
    const node = $(element)
    if (node.hasClass('b_ad')) return
    const link = node.find('h2 a[href]').first()
    const rawHref = link.attr('href')
    if (rawHref === undefined || rawHref.length === 0) return
    const url = safeSourceUrl(unwrapBing(rawHref, 'https://www.bing.com'))
    if (url === undefined) return
    const title = cleanText(link.text())
    const snippet = cleanText(
      node.find('.b_caption p').first().text()
      || node.find('.b_lineclamp1, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, .b_algoSlug').first().text(),
    )
    addSource(sources, url, title, snippet)
  })
  const rawSources = [...sources.values()]
  return { sources: rawSources.filter(source => allowed(source.url, options)), rawSources, truncated: false }
}

/** Resolve a DDG `/l/?uddg=...` link without fetching the redirector. */
export function unwrapDuckDuckGo(raw: string, base: string): string | undefined {
  try {
    const url = new URL(raw, base)
    if (isHost(url.hostname, 'duckduckgo.com') && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg')
      return target === null || target.length === 0 ? undefined : target
    }
    if (isHost(url.hostname, 'duckduckgo.com') && url.searchParams.has('uddg')) {
      const target = url.searchParams.get('uddg')
      return target === null || target.length === 0 ? undefined : target
    }
    return url.toString()
  } catch {
    return undefined
  }
}

/** Resolve a Bing `/ck/a?...u=a1<base64url>` link without fetching the redirector. */
export function unwrapBing(raw: string, base: string): string | undefined {
  try {
    const url = new URL(raw, base)
    if (isHost(url.hostname, 'bing.com') && (url.pathname === '/ck/a' || url.searchParams.has('u'))) {
      const direct = url.searchParams.get('url')
      if (direct !== null && /^https?:\/\//iu.test(direct)) return direct
      const value = url.searchParams.get('u')
      if (value !== null) {
        const decoded = decodeBingPayload(value)
        if (decoded !== undefined) return decoded
      }
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function decodeBingPayload(value: string): string | undefined {
  let candidate = value.trim()
  try {
    candidate = decodeURIComponent(candidate)
  } catch {
    // Keep the raw value; it may already be plain URL-safe base64.
  }
  if (/^https?:\/\//iu.test(candidate)) return candidate
  if (candidate.startsWith('a1')) candidate = candidate.slice(2)
  // Bing emits URL-safe base64, sometimes padded (`=`) after URL decoding.
  // Buffer accepts either alphabet, but validate after normalizing the padding.
  candidate = candidate.replace(/=+$/u, '').replace(/\+/gu, '-').replace(/\//gu, '_')
  if (candidate.length === 0 || candidate.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/u.test(candidate)) return undefined
  try {
    const decoded = Buffer.from(candidate, 'base64url').toString('utf8')
    return /^https?:\/\//iu.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function safeSourceUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    // Search-result URLs must not carry credentials into the preview or a later fetch.
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return normalizeResultUrl(url.toString())
  } catch {
    return undefined
  }
}

function allowed(raw: string, options: LocalDirectParseOptions): boolean {
  const host = new URL(raw).hostname.toLowerCase()
  if (options.includeDomains !== undefined && options.includeDomains.length > 0
    && !options.includeDomains.some(pattern => domainMatches(host, pattern))) return false
  if (options.excludeDomains?.some(pattern => domainMatches(host, pattern)) === true) return false
  return true
}

function addSource(sources: Map<string, SearchSource>, url: string, title: string, snippet: string): void {
  const next: SearchSource = {
    url,
    ...(title.length === 0 ? {} : { title: clip(title, MAX_TITLE_CHARS) }),
    ...(snippet.length === 0 ? {} : { snippet: clip(snippet, MAX_SNIPPET_CHARS) }),
  }
  const existing = sources.get(url)
  if (existing === undefined) {
    sources.set(url, next)
    return
  }
  const mergedTitle = longer(existing.title, next.title)
  const mergedSnippet = longer(existing.snippet, next.snippet)
  sources.set(url, {
    url,
    ...(mergedTitle === undefined ? {} : { title: mergedTitle }),
    ...(mergedSnippet === undefined ? {} : { snippet: mergedSnippet }),
  })
}

function longer(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return right.length > left.length ? right : left
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}
