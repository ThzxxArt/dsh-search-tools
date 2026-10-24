/** Lazy PDF text extraction. Host-only; never imported by the client bundle. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

interface PdfTextItem { str?: string; hasEOL?: boolean }
interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }> }
interface PdfDocument { numPages: number; getPage(page: number): Promise<PdfPage> }
interface PdfLoadingTask { promise: Promise<PdfDocument>; destroy(): Promise<void> }
interface PdfModule {
  getDocument(options: Record<string, unknown>): PdfLoadingTask
}

export interface PdfExtraction {
  text: string
  pagesRead: number
  totalPages: number
  truncated: boolean
}

class PdfAbortError extends Error {
  readonly code = 'WEB_ABORTED'

  constructor() {
    super('PDF text extraction aborted')
    this.name = 'PdfAbortError'
  }
}

const PDFJS_LEGACY = 'pdfjs-dist/legacy/build/pdf.mjs'
const require = createRequire(import.meta.url)
const resources = pdfResources()

/** Extract text from the first `maxPages` pages; no OCR and no rendering. */
export async function extractPdfText(
  bytes: Uint8Array,
  maxPages: number,
  maxChars: number,
  signal?: AbortSignal,
): Promise<PdfExtraction> {
  throwIfAborted(signal)
  const pdfjs = await import(PDFJS_LEGACY) as unknown as PdfModule
  throwIfAborted(signal)
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
    ...resources,
  })
  let document: PdfDocument | undefined
  try {
    document = await loadingTask.promise
    throwIfAborted(signal)
    const pageLimit = Math.min(document.numPages, maxPages)
    let pagesRead = 0
    const parts: string[] = []
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      throwIfAborted(signal)
      const page = await document.getPage(pageNumber)
      throwIfAborted(signal)
      const content = await page.getTextContent()
      throwIfAborted(signal)
      parts.push(textOf(content.items))
      pagesRead = pageNumber
      if (parts.join('\n').length > maxChars) break
    }
    const joined = parts.join('\n').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
    const clipped = clipCodePoints(joined, maxChars)
    return {
      text: clipped.text,
      pagesRead,
      totalPages: document.numPages,
      truncated: document.numPages > pageLimit || pagesRead < pageLimit || clipped.truncated,
    }
  } finally {
    await loadingTask.destroy().catch(() => {})
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new PdfAbortError()
}

function textOf(items: readonly PdfTextItem[]): string {
  let result = ''
  for (const item of items) {
    if (typeof item.str !== 'string' || item.str.length === 0) continue
    result += item.str
    if (item.hasEOL === true) result += '\n'
  }
  return result
}

function clipCodePoints(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  let end = max
  const last = value.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { text: value.slice(0, end), truncated: true }
}

function pdfResources(): { standardFontDataUrl?: string; cMapUrl?: string; cMapPacked?: boolean } {
  try {
    const packageJson = require.resolve('pdfjs-dist/package.json')
    const root = dirname(packageJson)
    return {
      standardFontDataUrl: `${join(root, 'standard_fonts')}/`,
      cMapUrl: `${join(root, 'cmaps')}/`,
      cMapPacked: true,
    }
  } catch {
    return {}
  }
}
