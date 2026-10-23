import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { extractPdfText } from '../src/fetch/adapters/wire-http/pdf.ts'

const fixture = new URL('./fixtures/hello.pdf', import.meta.url)

describe('wire-http PDF text extraction', () => {
  it('extracts text locally and reports page metadata', async () => {
    const bytes = new Uint8Array(await readFile(fixture))
    const result = await extractPdfText(bytes, 10, 200_000)
    expect(result.text).toContain('Hello PDF')
    expect(result.pagesRead).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('clips text and marks page-cap truncation', async () => {
    const bytes = new Uint8Array(await readFile(fixture))
    const clipped = await extractPdfText(bytes, 1, 5)
    expect(clipped.text).toBe('Hello')
    expect(clipped.truncated).toBe(true)
  })

  it('rejects invalid PDF bytes instead of returning an empty success', async () => {
    await expect(extractPdfText(new TextEncoder().encode('not a pdf'), 10, 1_000)).rejects.toBeInstanceOf(Error)
  })

  it('honors an aborted signal before starting PDF.js', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(extractPdfText(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 10, 1_000, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('honors the page cap on a real multi-page PDF', async () => {
    const bytes = makePdf(['First page', 'Second page', 'Third page'])

    // PDF.js transfers and detaches the input buffer; give each extraction its
    // own copy so the page-cap assertion exercises the real second document.
    const all = await extractPdfText(bytes.slice(), 10, 200_000)
    expect(all.totalPages).toBe(3)
    expect(all.pagesRead).toBe(3)
    expect(all.text).toContain('First page')
    expect(all.text).toContain('Third page')
    expect(all.truncated).toBe(false)

    const capped = await extractPdfText(bytes.slice(), 2, 200_000)
    expect(capped.totalPages).toBe(3)
    expect(capped.pagesRead).toBe(2)
    expect(capped.text).toContain('First page')
    expect(capped.text).toContain('Second page')
    expect(capped.text).not.toContain('Third page')
    expect(capped.truncated).toBe(true)
  })
})

/** Build a deterministic, uncompressed multi-page PDF without a PDF writer. */
function makePdf(pageTexts: readonly string[]): Uint8Array {
  const pageObject = (index: number): number => 3 + index * 2
  const fontObject = 3 + pageTexts.length * 2
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${pageObject(index)} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
  ]

  for (const [index, text] of pageTexts.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageObject(index) + 1} 0 R `
      + `/Resources << /Font << /F1 ${fontObject} 0 R >> >> >>`,
    )
    const stream = `BT /F1 24 Tf 72 700 Td (${escapePdf(text)}) Tj ET`
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(body.length)
  for (let index = 0; index < body.length; index++) bytes[index] = body.charCodeAt(index)
  return bytes
}

function escapePdf(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)')
}
