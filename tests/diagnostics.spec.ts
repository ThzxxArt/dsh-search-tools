import { describe, expect, it } from 'vitest'
import { Diagnostics } from '../src/core/diagnostics.ts'
import { SearchToolsError } from '../src/shared/errors.ts'

describe('diagnostics ring buffer', () => {
  it('records reverse-ordered entries and clears them', () => {
    const diagnostics = new Diagnostics()
    const first = diagnostics.record(new SearchToolsError('first failure', 'FIRST'), 'FALLBACK', 'https://example.com/a?token=secret')
    const second = diagnostics.record('second failure', 'SECOND')

    expect(first.host).toBe('https://example.com/a')
    expect(first.message).toBe('first failure')
    expect(second.host).toBeUndefined()
    expect(diagnostics.list().map(entry => entry.message)).toEqual(['second failure', 'first failure'])

    diagnostics.clear()
    expect(diagnostics.list()).toEqual([])
  })

  it('caps the buffer at fifty entries and redacts secrets in the message', () => {
    const diagnostics = new Diagnostics()
    for (let index = 0; index < 55; index++) {
      diagnostics.record(new Error(`failure ${index} Bearer abcdefghijklmnop`), 'CODE', 'https://example.com/path?q=query')
    }
    const entries = diagnostics.list()
    expect(entries).toHaveLength(50)
    expect(entries[0]?.message).toContain('failure 54')
    expect(entries[0]?.message).not.toContain('abcdefghijklmnop')
    expect(entries.at(-1)?.message).toContain('failure 5')
  })
})
