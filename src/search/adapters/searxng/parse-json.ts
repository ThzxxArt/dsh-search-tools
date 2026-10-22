/** Map a SearXNG JSON payload to the portable search result shape. */

import type { SearchResult, SearchSource } from '../../../core/types.ts'
import { domainMatches, hostOf, normalizeResultUrl } from '../../../shared/url.ts'
import { isRecord } from '../../../shared/validation.ts'

export interface SearxngJsonResult {
  url?: unknown
  title?: unknown
  content?: unknown
  publishedDate?: unknown
  published_date?: unknown
}

export interface SearxngJsonPayload {
  results?: unknown
  answers?: unknown
  infoboxes?: unknown
  unresponsive_engines?: unknown
}

export interface ParseOptions {
  includeDomains?: readonly string[]
  excludeDomains?: readonly string[]
}

export function parseSearxngJson(
  payload: unknown,
  instance: string,
  options: ParseOptions = {},
): SearchResult {
  if (!isRecord(payload)) throw new Error('SearXNG JSON response is not an object')
  const sources = new Map<string, SearchSource>()
  const rawResults = Array.isArray(payload.results) ? payload.results : []

  for (const entry of rawResults) {
    if (!isRecord(entry)) continue
    const mapped = mapResult(entry, instance)
    if (mapped === undefined) continue
    const host = hostOf(mapped.url)
    if (host === undefined) continue
    if (options.includeDomains?.length && !options.includeDomains.some(pattern => domainMatches(host, pattern))) continue
    if (options.excludeDomains?.some(pattern => domainMatches(host, pattern))) continue
    const existing = sources.get(mapped.url)
    if (existing === undefined) {
      sources.set(mapped.url, mapped)
    } else {
      sources.set(mapped.url, {
        ...existing,
        ...(existing.snippet === undefined && mapped.snippet !== undefined ? { snippet: mapped.snippet } : {}),
        ...(existing.publishedAt === undefined && mapped.publishedAt !== undefined ? { publishedAt: mapped.publishedAt } : {}),
        ...(existing.title === undefined && mapped.title !== undefined ? { title: mapped.title } : {}),
      })
    }
  }

  const answerText = joinAnswers(payload)
  return {
    ...(answerText.length > 0 ? { content: answerText } : {}),
    sources: [...sources.values()],
    truncated: false,
  }
}

function mapResult(entry: Record<string, unknown>, instance: string): SearchSource | undefined {
  const rawUrl = typeof entry.url === 'string' ? entry.url.trim() : ''
  if (rawUrl.length === 0) return undefined
  let absolute: URL
  try {
    absolute = new URL(rawUrl, instance)
  } catch {
    return undefined
  }
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return undefined
  let url: string
  try {
    url = normalizeResultUrl(absolute.toString())
  } catch {
    return undefined
  }
  const title = typeof entry.title === 'string' ? entry.title.trim() : ''
  const snippet = typeof entry.content === 'string' ? entry.content.trim() : ''
  const published = typeof entry.publishedDate === 'string'
    ? entry.publishedDate
    : typeof entry.published_date === 'string' ? entry.published_date : undefined
  return {
    url,
    ...(title.length > 0 ? { title } : {}),
    ...(snippet.length > 0 ? { snippet } : {}),
    ...(published === undefined ? {} : { publishedAt: published }),
  }
}

function joinAnswers(payload: Record<string, unknown>): string {
  const parts: string[] = []
  if (Array.isArray(payload.answers)) {
    for (const answer of payload.answers) {
      if (typeof answer === 'string' && answer.trim().length > 0) parts.push(answer.trim())
    }
  }
  if (Array.isArray(payload.infoboxes)) {
    for (const box of payload.infoboxes) {
      if (!isRecord(box)) continue
      if (typeof box.content === 'string' && box.content.trim().length > 0) parts.push(box.content.trim())
    }
  }
  return [...new Set(parts)].join('\n\n')
}
