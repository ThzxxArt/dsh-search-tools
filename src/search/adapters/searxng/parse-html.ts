/** HTML fallback parser for SearXNG themes. Fixtures own selector coverage. */

import { load } from 'cheerio'
import type { SearchResult, SearchSource } from '../../../core/types.ts'
import { domainMatches, normalizeResultUrl } from '../../../shared/url.ts'
import type { ParseOptions } from './parse-json.ts'

const RESULT_SELECTORS = ['article.result', '#urls .result', '.result']
const TITLE_SELECTORS = ['h3 a', 'a.url_header', 'h3']
const SNIPPET_SELECTORS = ['.content', 'p.content', '.result-content']
const URL_SELECTORS = ['a.url_header[href]', 'h3 a[href]', 'a[href]']

export function parseSearxngHtml(
  html: string,
  instance: string,
  options: ParseOptions = {},
): SearchResult {
  const $ = load(html)
  const sources = new Map<string, SearchSource>()
  const nodes = firstMatches($, RESULT_SELECTORS)

  nodes.each((_index, element) => {
    const node = $(element)
    const rawHref = firstAttribute(node, URL_SELECTORS)
    if (rawHref === undefined) return
    let absolute: URL
    try {
      absolute = new URL(rawHref, instance)
    } catch {
      return
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return
    const host = absolute.hostname.toLowerCase()
    if (options.includeDomains?.length && !options.includeDomains.some(pattern => domainMatches(host, pattern))) return
    if (options.excludeDomains?.some(pattern => domainMatches(host, pattern))) return
    let url: string
    try {
      url = normalizeResultUrl(absolute.toString())
    } catch {
      return
    }
    const title = firstText(node, TITLE_SELECTORS).trim()
    const snippet = firstText(node, SNIPPET_SELECTORS).trim()
    const timeText = node.find('time').first().text().trim()
    const publishedAt = node.find('time[datetime]').first().attr('datetime') ?? (timeText.length > 0 ? timeText : undefined)
    if (!sources.has(url)) {
      sources.set(url, {
        url,
        ...(title.length > 0 ? { title } : {}),
        ...(snippet.length > 0 ? { snippet } : {}),
        ...(publishedAt === undefined || publishedAt.length === 0 ? {} : { publishedAt }),
      })
    }
  })

  const answer = $('.answer').first().text().trim()
  return {
    ...(answer.length > 0 ? { content: answer } : {}),
    sources: [...sources.values()],
    truncated: false,
  }
}

function firstMatches($: ReturnType<typeof load>, selectors: readonly string[]) {
  for (const selector of selectors) {
    const found = $(selector)
    if (found.length > 0) return found
  }
  return $([])
}

function firstText(node: ReturnType<ReturnType<typeof load>>, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const found = node.find(selector).first()
    if (found.length > 0) return found.text()
  }
  return ''
}

function firstAttribute(
  node: ReturnType<ReturnType<typeof load>>,
  selectors: readonly string[],
): string | undefined {
  for (const selector of selectors) {
    const found = node.find(selector).first()
    const href = found.attr('href')
    if (href !== undefined && href.length > 0) return href
  }
  return undefined
}
