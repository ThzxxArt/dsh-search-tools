import { describe, expect, it } from 'vitest'
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
})
