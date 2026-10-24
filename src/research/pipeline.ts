/** Search → fetch → clip pipeline for the `web_research` tool. */

import type { Context } from '@deepseek-ai/cordis'
import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'
import type { Config } from '../config.ts'
import { snapshot } from '../config.ts'
import type { SearchSource } from '../core/types.ts'
import { extractReadable } from '../fetch/adapters/readable-http/readability.ts'
import { errorMessage, SearchToolsError } from '../shared/errors.ts'
import { redactText } from '../shared/redact.ts'
import { clip, mapLimit } from '../shared/limit.ts'
import { readNumber } from '../shared/validation.ts'

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
  if (state.research.defaultFetchTop > state.research.maxFetch) {
    throw new SearchToolsError('research.defaultFetchTop must not exceed research.maxFetch', 'RESEARCH_CONFIG_INVALID')
  }
  if (state.research.maxCharsPerPage > state.research.maxTotalChars) {
    throw new SearchToolsError('research.maxCharsPerPage must not exceed research.maxTotalChars', 'RESEARCH_CONFIG_INVALID')
  }
  const query = args.query.trim()
  if (query.length === 0) throw new Error('query must not be empty')
  const maxResults = clamp(finite(args.max_results, state.research.maxResults), 1, state.research.maxResults)
  const fetchTop = clamp(finite(args.fetch_top, state.research.defaultFetchTop), 0, state.research.maxFetch)
  const maxChars = clamp(finite(args.max_chars, state.research.maxCharsPerPage), 1_000, state.research.maxCharsPerPage)
  const timeoutMs = state.research.timeoutMs

  const timeout = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeout.abort()
  }, timeoutMs)
  timer.unref?.()
  const runSignal = AbortSignal.any([signal, timeout.signal])

  try {
    const search = await ctx.web.search({ query, maxResults }, runSignal)
    const selected = search.sources.slice(0, fetchTop)
    const fetchConfig = state.fetch.adapters[state.fetch.adapter]
    const maxBodyChars = readNumber(fetchConfig?.maxBodyChars, 2_000_000)
    const minArticleChars = readNumber(fetchConfig?.minArticleChars, 200)

    // Each page may use the per-page cap; the final pass below applies the
    // total cap in source order. This keeps a failed or empty page from
    // consuming budget that a later page could use.
    const pages = await mapLimit(selected, state.research.concurrency, async (source) => {
      const budget = maxChars
      try {
        const result = await ctx.web.fetch({ url: source.url }, runSignal)
        if (result.statusCode < 200 || result.statusCode >= 300) {
          return {
            url: source.url,
            ...(source.title === undefined ? {} : { title: source.title }),
            content: '',
            truncated: false,
            error: `HTTP ${result.statusCode}`,
          }
        }
        if (result.body.kind === 'text') {
          const clipped = clip(result.body.content, budget)
          return {
            url: source.url,
            ...(source.title === undefined ? {} : { title: source.title }),
            content: clipped.text,
            truncated: result.truncated || clipped.truncated,
          }
        }
        const readable = await extractReadable(result.body.content, result.url, {
          minArticleChars,
          maxArticleChars: budget,
          maxBodyChars,
        }).catch(() => undefined)
        // extractReadable may return text without HTML when the article cannot
        // be safely truncated. That text is the extracted boundary; falling
        // back to the raw HTML would bypass it and lose `truncated`.
        const content = readable?.html ?? readable?.text ?? result.body.content
        const markdown = turndown.turndown(content)
        const clipped = clip(markdown, budget)
        return {
          url: source.url,
          ...((readable?.title ?? source.title) === undefined ? {} : { title: readable?.title ?? source.title }),
          content: clipped.text,
          truncated: result.truncated || readable?.truncated === true || clipped.truncated,
        }
      } catch (error) {
        if (timedOut || signal.aborted) throw error
        return {
          url: source.url,
          ...(source.title === undefined ? {} : { title: source.title }),
          content: '',
          truncated: false,
          error: redactText(errorMessage(error)),
        }
      }
    })

    if (timedOut) throw timeoutError(timeoutMs)

    let remaining = state.research.maxTotalChars
    let truncated = search.truncated
    const fetched = pages.map((page) => {
      truncated ||= page.truncated
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
  } catch (error) {
    if (timedOut && !signal.aborted) throw timeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
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

function timeoutError(timeoutMs: number): SearchToolsError {
  return new SearchToolsError(`web_research timed out after ${timeoutMs} ms`, 'WEB_RESEARCH_TIMEOUT')
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
