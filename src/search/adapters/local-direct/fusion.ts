/** Reciprocal-rank fusion and domain diversity for local-direct results. */

import type { SearchSource } from '../../../core/types.ts'
import type { LocalDirectEngine } from './schema.ts'

export interface EngineSources {
  engine: LocalDirectEngine
  sources: readonly SearchSource[]
}

export interface FusedSources {
  sources: SearchSource[]
  truncated: boolean
}

const RRF_K = 60
const MAX_TITLE_CHARS = 500
const MAX_SNIPPET_CHARS = 2_000

/** Fuse first-page rankings locally; higher-ranked results from either engine win. */
export function fuseSources(
  results: readonly EngineSources[],
  limit: number,
  maxPerHost: number,
): FusedSources {
  const merged = new Map<string, { source: SearchSource; score: number }>()
  for (const result of results) {
    result.sources.forEach((source, rank) => {
      const existing = merged.get(source.url)
      const score = 1 / (RRF_K + rank + 1)
      if (existing === undefined) {
        merged.set(source.url, { source: normalizeSource(source), score })
        return
      }
      existing.score += score
      existing.source = mergeSource(existing.source, source)
    })
  }

  const ranked = [...merged.values()].sort((left, right) =>
    right.score - left.score
    || left.source.url.localeCompare(right.source.url))
  const perHost = new Map<string, number>()
  const selected: SearchSource[] = []
  let truncated = false
  for (const entry of ranked) {
    if (selected.length >= limit) {
      truncated = true
      break
    }
    const host = hostOf(entry.source.url)
    const count = perHost.get(host) ?? 0
    if (count >= maxPerHost) {
      truncated = true
      continue
    }
    perHost.set(host, count + 1)
    selected.push(entry.source)
  }
  return { sources: selected, truncated }
}

function normalizeSource(source: SearchSource): SearchSource {
  return {
    url: source.url,
    ...(source.title === undefined || source.title.length === 0 ? {} : { title: clip(source.title, MAX_TITLE_CHARS) }),
    ...(source.snippet === undefined || source.snippet.length === 0 ? {} : { snippet: clip(source.snippet, MAX_SNIPPET_CHARS) }),
    ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
  }
}

function mergeSource(left: SearchSource, right: SearchSource): SearchSource {
  const title = longer(left.title, right.title)
  const snippet = longer(left.snippet, right.snippet)
  const publishedAt = left.publishedAt ?? right.publishedAt
  return {
    url: left.url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

function longer(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return right.length > left.length ? right : left
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}
