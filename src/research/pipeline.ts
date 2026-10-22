/** Search → fetch → clip pipeline for the `web_research` tool. */

import type { Context } from '@deepseek-ai/cordis'
import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'
import type { Config } from '../config.ts'
import { snapshot } from '../config.ts'
import type { SearchSource } from '../core/types.ts'
import { extractReadable } from '../fetch/adapters/readable-http/readability.ts'
import { clip, mapLimit } from '../shared/limit.ts'
import { errorMessage } from '../shared/errors.ts'

export interface ResearchArgs {
  query: string
  max_results?: number
  fetch_top?: number
  max_chars?: number
}

export interface FetchedPage {
  url: string
  title?: string
  content: string
  truncated: boolean
  error?: string
}

export interface ResearchValue {
  query: string
  sources: SearchSource[]
  fetched: FetchedPage[]
  truncated: boolean
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
turndown.use(gfm)
turndown.addRule('removeNonVisible', {
  filter: ['script', 'style', 'noscript', 'template', 'iframe'],
  replacement: () => '',
})

export async function runResearch(
  ctx: Context,
  config: Config,
  args: ResearchArgs,
  signal: AbortSignal,
): Promise<ResearchValue> {
  const state = snapshot(config)
  if (!state.research.enabled) throw new Error('web_research is disabled')
  const query = args.query.trim()
  if (query.length === 0) throw new Error('query must not be empty')
  const maxResults = clamp(args.max_results ?? state.research.maxResults, 1, state.research.maxResults)
  const fetchTop = clamp(args.fetch_top ?? state.research.defaultFetchTop, 0, state.research.maxFetch)
  const maxChars = clamp(args.max_chars ?? state.research.maxCharsPerPage, 1_000, state.research.maxCharsPerPage)

  const search = await ctx.web.search({ query, maxResults }, signal)
  const selected = search.sources.slice(0, fetchTop)
  const pages = await mapLimit(selected, state.research.concurrency, async source => {
    try {
      const result = await ctx.web.fetch({ url: source.url }, signal)
      if (result.statusCode < 200 || result.statusCode >= 300) {
        return { url: source.url, ...(source.title === undefined ? {} : { title: source.title }), content: '', truncated: false, error: `HTTP ${result.statusCode}` }
      }
      if (result.body.kind === 'text') {
        const clipped = clip(result.body.content, maxChars)
        return { url: source.url, ...(source.title === undefined ? {} : { title: source.title }), content: clipped.text, truncated: result.truncated || clipped.truncated }
      }
      const readable = await extractReadable(result.body.content, result.url, {
        minArticleChars: 200,
        maxArticleChars: state.research.maxCharsPerPage,
        maxBodyChars: state.fetch.adapters['readable-http']?.maxBodyChars as number | undefined ?? 2_000_000,
      }).catch(() => undefined)
      const html = readable?.html ?? result.body.content
      const markdown = turndown.turndown(html)
      const clipped = clip(markdown, maxChars)
      return {
        url: source.url,
        ...((readable?.title ?? source.title) === undefined ? {} : { title: readable?.title ?? source.title }),
        content: clipped.text,
        truncated: result.truncated || clipped.truncated,
      }
    } catch (error) {
      return { url: source.url, ...(source.title === undefined ? {} : { title: source.title }), content: '', truncated: false, error: errorMessage(error) }
    }
  })

  let remaining = state.research.maxTotalChars
  let truncated = search.truncated
  const fetched = pages.map((page) => {
    if (page.content.length <= remaining) {
      remaining -= page.content.length
      return page
    }
    const clipped = clip(page.content, Math.max(0, remaining))
    remaining = 0
    truncated ||= clipped.truncated
    return { ...page, content: clipped.text, truncated: true }
  })

  return {
    query,
    sources: search.sources.slice(0, maxResults).map(source => ({ ...source })),
    fetched,
    truncated,
  }
}

export function researchMeta(value: ResearchValue): Record<string, unknown> {
  return {
    query: value.query,
    sourceCount: value.sources.length,
    sources: value.sources.slice(0, 8).map(source => ({
      url: source.url,
      ...(source.title === undefined ? {} : { title: source.title }),
      domain: hostOf(source.url),
    })),
    fetched: value.fetched.map(page => ({
      url: page.url,
      ...(page.title === undefined ? {} : { title: page.title }),
      chars: page.content.length,
      ...(page.error === undefined ? {} : { error: page.error }),
    })),
    truncated: value.truncated,
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
