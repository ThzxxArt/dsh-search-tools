/** Lazy Readability extraction over linkedom. Host-only. */

import { parseHTML } from 'linkedom'

export interface ReadableOptions {
  minArticleChars: number
  maxArticleChars: number
  maxBodyChars: number
}

export interface ReadableExtraction {
  html?: string
  text?: string
  title?: string
  byline?: string
  excerpt?: string
  siteName?: string
  lang?: string
  publishedTime?: string
}

let readabilityPromise: Promise<typeof import('@mozilla/readability')> | undefined

/**
 * Extract the main article. Returns undefined when the input is not an article.
 *
 * linkedom is used instead of jsdom because jsdom's `tr46` dependency calls
 * `createRequire(...).resolve.paths`, which DSH's profile-resolution hook does
 * not implement. linkedom is smaller, has no native deps, and is sufficient
 * for Readability's DOM traversal.
 */
export async function extractReadable(
  html: string,
  url: string,
  options: ReadableOptions,
): Promise<ReadableExtraction | undefined> {
  if (html.length > options.maxBodyChars) return undefined
  if (html.includes('data-dsh-readable="1"')) return undefined

  const { Readability } = await loadReadability()
  let document: Document
  try {
    const withBase = addBase(html, url)
    document = parseHTML(withBase).document as unknown as Document
  } catch {
    return undefined
  }
  try {
    const article = new Readability(document, {
      charThreshold: options.minArticleChars,
    }).parse()
    if (article === null) return undefined
    const text = (article.textContent ?? '').trim()
    if (text.length < options.minArticleChars) return undefined
    const content = (article.content ?? '').trim()
    if (content.length > 0) {
      const clipped = content.slice(0, options.maxArticleChars)
      return {
        html: `<div data-dsh-readable="1">${clipped}</div>`,
        text,
        ...(article.title === undefined || article.title === null ? {} : { title: article.title }),
        ...(article.byline === undefined || article.byline === null ? {} : { byline: article.byline }),
        ...(article.excerpt === undefined || article.excerpt === null ? {} : { excerpt: article.excerpt }),
        ...(article.siteName === undefined || article.siteName === null ? {} : { siteName: article.siteName }),
        ...(article.lang === undefined || article.lang === null ? {} : { lang: article.lang }),
        ...(article.publishedTime === undefined || article.publishedTime === null ? {} : { publishedTime: article.publishedTime }),
      }
    }
    return {
      text: text.slice(0, options.maxArticleChars),
      ...(article.title === undefined || article.title === null ? {} : { title: article.title }),
    }
  } catch {
    return undefined
  }
}

/** Give relative links a usable base without changing the article body. */
function addBase(html: string, url: string): string {
  const href = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${href}">`)
  }
  return `<head><base href="${href}"></head>${html}`
}

async function loadReadability(): Promise<typeof import('@mozilla/readability')> {
  readabilityPromise ??= import('@mozilla/readability')
  return readabilityPromise
}

/** Mark a body that is already readable so `web_research` does not extract twice. */
export function alreadyReadable(html: string): boolean {
  return html.includes('data-dsh-readable="1"')
}
