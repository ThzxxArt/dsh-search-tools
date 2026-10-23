import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { extractReadable } from '../src/fetch/adapters/readable-http/readability.ts'

const article = `<!doctype html>
<html>
  <head><title>Test article</title></head>
  <body>
    <nav>Navigation noise</nav>
    <article>
      <h1>Test article</h1>
      <p>${'Readable body text. '.repeat(40)}</p>
      <p>${'Second paragraph. '.repeat(40)}</p>
    </article>
  </body>
</html>`

describe('Readability extraction', () => {
  it('extracts an article and marks the body for research', async () => {
    const result = await extractReadable(article, 'https://example.com/a', {
      minArticleChars: 100,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(result?.title).toBe('Test article')
    expect(result?.html).toContain('data-dsh-readable="1"')
    expect(result?.text?.length).toBeGreaterThan(100)
  })

  it('skips a body that is already marked', async () => {
    const result = await extractReadable(`<div data-dsh-readable="1">${article}</div>`, 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(result).toBeUndefined()
  })

  it('returns undefined for a short page', async () => {
    const result = await extractReadable('<html><body><p>too short</p></body></html>', 'https://example.com/a', {
      minArticleChars: 200,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(result).toBeUndefined()
  })

  it('does not flag a short text article just because the HTML is long', async () => {
    const markup = `<article><h1>Short</h1><p>Short readable text. ${'<span class="noise">x</span>'.repeat(200)}</p></article>`
    const result = await extractReadable(`<html><body>${markup}</body></html>`, 'https://example.com/a', {
      minArticleChars: 10,
      maxArticleChars: 10_000,
      maxBodyChars: 1_000_000,
    })
    expect(result?.textChars).toBeLessThan(10_000)
    expect(result?.truncated).toBe(false)
    expect(result?.htmlChars).toBeGreaterThan(result?.textChars ?? 0)
  })

  it('truncates long text, reports it, and never returns a broken HTML fragment', async () => {
    const result = await extractReadable(article, 'https://example.com/a', {
      minArticleChars: 50,
      maxArticleChars: 100,
      maxBodyChars: 1_000_000,
      maxHtmlChars: 600,
    })
    expect(result?.truncated).toBe(true)
    expect(result?.textChars).toBeLessThanOrEqual(100)
    if (result?.html !== undefined) {
      expect(result.html).toMatch(/^<div data-dsh-readable="1">[\s\S]*<\/div>$/)
      expect(() => parseHTML(result.html as string)).not.toThrow()
      expect(result.html).not.toMatch(/<[^>]*$/)
    }
  })
})
