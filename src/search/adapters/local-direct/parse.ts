/** Local HTML parsers. Fixtures own selector coverage. */

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
  return resultOf(sources, options)
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
  return resultOf(sources, options)
}

/** 360's visible link is a `so.com/link` redirector; `data-mdurl` is the target. */
export function parseSo360(html: string, options: LocalDirectParseOptions = {}): LocalDirectParseResult {
  const $ = load(html)
  const sources = new Map<string, SearchSource>()
  $('li.res-list[data-result-type="normal"]').each((_index, element) => {
    const node = $(element)
    const link = node.find('.res-title a[href]').first()
    const rawTarget = link.attr('data-mdurl')
      ?? absoluteRedirectTarget(link.attr('href'), 'https://www.so.com')
    const url = safeSourceUrl(rawTarget)
    if (url === undefined) return
    const title = cleanText(link.text())
    const snippet = cleanText(node.find('.res-desc').first().text())
    addSource(sources, url, title, snippet)
  })
  return resultOf(sources, options)
}

/**
 * Brave's result links are direct hrefs, not redirectors. Only server-rendered
 * `data-type="web"` snippets are results; sponsored cards do not carry that
 * marker and are deliberately ignored.
 */
export function parseBrave(html: string, options: LocalDirectParseOptions = {}): LocalDirectParseResult {
  const $ = load(html)
  const sources = new Map<string, SearchSource>()
  $('div.snippet[data-type="web"]').each((_index, element) => {
    const node = $(element)
    const link = node.find('a[href]').first()
    const rawHref = link.attr('href')
    if (rawHref === undefined || rawHref.length === 0) return
    const url = safeSourceUrl(resolveDirectTarget(rawHref, 'https://search.brave.com'))
    if (url === undefined) return
    const title = cleanText(node.find('.title, .search-snippet-title').first().text()) || cleanText(link.text())
    const snippet = cleanText(
      node.find('.description, .snippet-description, .generic-snippet').first().text(),
    )
    addSource(sources, url, title, snippet)
  })
  return resultOf(sources, options)
}

export function isLocalDirectNoResults(engine: LocalDirectEngine, html: string): boolean {
  const $ = load(html)
  switch (engine) {
    case 'duckduckgo':
      return $('.no-results, #links .no-results').length > 0
        || /\bno results(?: found)?\b/iu.test(visibleText($))
    case 'bing':
      return $('#b_results .b_no, .no-results, .no-result').length > 0
        || /there are no results for/iu.test(visibleText($))
    case 'brave':
      if ($('div.snippet[data-type="web"]').length > 0) return false
      return $('.no-results, .empty-results, .results-empty').length > 0
        || /\bno results(?: found| for)?\b/iu.test(visibleText($))
    case 'so360':
      return $('.no-result, .no-results').length > 0
        || /(?:没有找到|未找到相关结果)/u.test(visibleText($))
  }
}

/** Text visible to a reader, excluding serialized scripts/styles that contain UI strings. */
function visibleText($: ReturnType<typeof load>): string {
  const body = $('body').clone()
  body.find('script, style, noscript, template').remove()
  return body.text()
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

function resultOf(
  sources: Map<string, SearchSource>,
  options: LocalDirectParseOptions,
): LocalDirectParseResult {
  const rawSources = [...sources.values()]
  return { sources: rawSources.filter(source => allowed(source.url, options)), rawSources, truncated: false }
}

/** Accept only an absolute result target; never follow a search-engine redirector. */
function absoluteRedirectTarget(raw: string | undefined, base: string): string | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  try {
    const url = new URL(raw, base)
    if (url.origin === new URL(base).origin) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function resolveDirectTarget(raw: string, base: string): string | undefined {
  try {
    return new URL(raw, base).toString()
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
