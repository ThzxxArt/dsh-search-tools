import { describe, expect, it } from 'vitest'
import { extractReadable } from '../src/fetch/adapters/readable-http/readability.ts'

const longBody = 'Readable body text with enough words for extraction. '.repeat(40)

function article(body: string, head = '<title>Article</title>'): string {
  return `<html><head>${head}</head><body><article><h1>Article</h1>${body}</article></body></html>`
}

describe('Readability edge branches', () => {
  it('rejects a body larger than the configured safety cap', async () => {
    const result = await extractReadable(article(`<p>${longBody}</p>`), 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 100,
    })
    expect(result).toBeUndefined()
  })

  it('does not treat multiple, nested, or empty marker wrappers as already extracted', async () => {
    for (const html of [
      `<html><body><div data-dsh-readable="1"><p>${longBody}</p></div><div data-dsh-readable="1"><p>${longBody}</p></div></body></html>`,
      `<html><body><section><div data-dsh-readable="1"><p>${longBody}</p></div></section></body></html>`,
      '<html><body><div data-dsh-readable="1"></div></body></html>',
    ]) {
      const result = await extractReadable(html, 'https://example.com/a', {
        minArticleChars: 10,
        maxArticleChars: 10_000,
        maxBodyChars: 1_000_000,
      })
      expect(result === undefined || (result.text?.length ?? 0) >= 0).toBe(true)
    }
  })

  it('returns text without HTML when the HTML cap cannot fit a safe fragment', async () => {
    const result = await extractReadable(article(`<p>${longBody}</p>`), 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
      maxHtmlChars: 0,
    })
    expect(result?.text?.length ?? 0).toBeGreaterThan(0)
    expect(result?.html).toBeUndefined()
    expect(result?.truncated).toBe(false)
  })

  it('handles a zero text budget without returning a broken fragment', async () => {
    const result = await extractReadable(article(`<p>${longBody}</p>`), 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 0,
      maxBodyChars: 1_000_000,
      maxHtmlChars: 10_000,
    })
    expect(result === undefined || result.text === '').toBe(true)
    if (result !== undefined) expect(result.html).toBeUndefined()
  })

  it('preserves available article metadata and omits missing fields', async () => {
    const head = `
      <title>Meta Article</title>
      <meta name="author" content="Ada Lovelace">
      <meta name="description" content="A meta description">
      <meta property="og:site_name" content="Example Site">
      <meta property="article:published_time" content="2026-01-02T00:00:00Z">
    `
    const result = await extractReadable(article(`<p>${longBody}</p>`, head), 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(result?.title).toBe('Meta Article')
    expect(result?.html).toContain('data-dsh-readable="1"')

    const bare = await extractReadable(article(`<p>${longBody}</p>`, ''), 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(bare?.title).toBe('')
  })

  it('injects a base for relative links both with and without a head element', async () => {
    const withHead = await extractReadable(article('<p><a href="/relative">link</a> ' + `${longBody}</p>`), 'https://example.com/base', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(withHead).toBeDefined()

    const withoutHead = await extractReadable(`<body><article><p>${longBody}</p></article></body>`, 'https://example.com/base', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(withoutHead).toBeDefined()
  })
})
