/** Lazy Readability extraction over linkedom. Host-only. */

import { parseHTML } from 'linkedom'

export interface ReadableOptions {
  minArticleChars: number
  maxArticleChars: number
  maxBodyChars: number
  /** Optional HTML safety cap; defaults to four times the text cap, bounded by maxBodyChars. */
  maxHtmlChars?: number
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
  /** True when the returned text or HTML was cut to fit the configured caps. */
  truncated: boolean
  textChars: number
  htmlChars: number
}

const HTML_CONTAINERS = new Set([
  'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'header', 'main', 'nav', 'ol', 'section', 'table', 'tbody', 'tfoot',
  'thead', 'tr', 'ul',
])

let readabilityPromise: Promise<typeof import('@mozilla/readability')> | undefined

/**
 * Extract the main article. Returns undefined when the input is not an article.
 *
 * `maxArticleChars` is a text-character cap, not an HTML cap. HTML is kept only
 * when it fits a separate safety cap and can be truncated by block nodes; when
 * that is not possible the extractor returns text instead of broken markup.
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

  const { Readability } = await loadReadability()
  let document: Document
  try {
    const withBase = addBase(html, url)
    document = parseHTML(withBase).document as unknown as Document
  } catch {
    return undefined
  }
  // Only a plugin-produced root wrapper is already extracted. A page that
  // merely mentions the marker string (or embeds it inside an article) is
  // ordinary content and must still go through Readability.
  if (isReadableWrapper(document)) return undefined
  try {
    const article = new Readability(document, {
      charThreshold: options.minArticleChars,
    }).parse()
    if (article === null) return undefined
    const fullText = (article.textContent ?? '').trim()
    if (fullText.length < options.minArticleChars) return undefined

    const text = fullText.slice(0, options.maxArticleChars)
    const textTruncated = fullText.length > options.maxArticleChars
    const content = (article.content ?? '').trim()
    const htmlLimit = options.maxHtmlChars
      ?? Math.min(options.maxBodyChars, Math.max(options.maxArticleChars * 4, 4_096))
    let html: string | undefined
    let htmlTruncated = false

    if (content.length > 0) {
      if (!textTruncated && content.length <= htmlLimit) {
        html = wrapReadable(content)
      } else {
        const clipped = truncateHtml(content, text.length, htmlLimit)
        if (clipped !== undefined) {
          html = wrapReadable(clipped)
          htmlTruncated = true
        }
      }
    }

    return {
      ...(html === undefined ? {} : { html }),
      text,
      truncated: textTruncated || htmlTruncated,
      textChars: text.length,
      htmlChars: html?.length ?? 0,
      ...(article.title === undefined || article.title === null ? {} : { title: article.title }),
      ...(article.byline === undefined || article.byline === null ? {} : { byline: article.byline }),
      ...(article.excerpt === undefined || article.excerpt === null ? {} : { excerpt: article.excerpt }),
      ...(article.siteName === undefined || article.siteName === null ? {} : { siteName: article.siteName }),
      ...(article.lang === undefined || article.lang === null ? {} : { lang: article.lang }),
      ...(article.publishedTime === undefined || article.publishedTime === null ? {} : { publishedTime: article.publishedTime }),
    }
  } catch {
    return undefined
  }
}

function isReadableWrapper(document: Document): boolean {
  const nodes = document.querySelectorAll('[data-dsh-readable="1"]')
  if (nodes.length !== 1) return false
  const node = nodes[0]
  return node !== undefined
    && node.parentElement?.tagName === 'BODY'
    && node.childNodes.length > 0
}

function wrapReadable(html: string): string {
  return `<div data-dsh-readable="1">${html}</div>`
}

/**
 * Truncate article HTML by whole block nodes while staying within the text
 * budget. Returns undefined when no safe fragment can be produced; callers
 * then keep the plain text, never a half-open tag.
 */
function truncateHtml(html: string, maxChars: number, maxHtmlChars: number): string | undefined {
  if (maxChars <= 0) return undefined
  let root: Element | null
  try {
    root = parseHTML(`<div id="dsh-readable-root">${html}</div>`).document.getElementById('dsh-readable-root')
  } catch {
    return undefined
  }
  if (root === null) return undefined
  let used = 0
  let out = ''
  for (const child of [...root.childNodes]) {
    if (used >= maxChars || out.length >= maxHtmlChars) break
    const rendered = renderNode(child, maxChars - used)
    if (rendered.html.length === 0) continue
    if (out.length + rendered.html.length > maxHtmlChars) break
    out += rendered.html
    used += rendered.used
  }
  return used > 0 && out.trim().length > 0 ? out : undefined
}

function renderNode(node: Node, budget: number): { html: string; used: number } {
  if (budget <= 0) return { html: '', used: 0 }
  if (node.nodeType === 3) {
    const value = node.textContent ?? ''
    const text = value.slice(0, budget)
    return { html: escapeHtml(text), used: text.length }
  }
  if (node.nodeType !== 1) return { html: '', used: 0 }
  const element = node as Element
  const textLength = (element.textContent ?? '').length
  if (textLength <= budget) return { html: element.outerHTML, used: textLength }
  if (budget <= 0) return { html: '', used: 0 }

  const tag = element.tagName.toLowerCase()
  if (!HTML_CONTAINERS.has(tag)) {
    const clone = element.cloneNode(false) as Element
    const text = (element.textContent ?? '').slice(0, budget)
    clone.textContent = text
    return { html: clone.outerHTML, used: text.length }
  }

  const clone = element.cloneNode(false) as Element
  let used = 0
  for (const child of [...element.childNodes]) {
    if (used >= budget) break
    const rendered = renderNode(child, budget - used)
    if (rendered.html.length === 0) continue
    clone.innerHTML += rendered.html
    used += rendered.used
  }
  return used > 0 ? { html: clone.outerHTML, used } : { html: '', used: 0 }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
