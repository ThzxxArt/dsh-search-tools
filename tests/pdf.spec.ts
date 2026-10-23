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
})
