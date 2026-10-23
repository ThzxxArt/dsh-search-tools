import { describe, expect, it } from 'vitest'

describe('wire-http native runtime', () => {
  it('loads the Impit native binding on the current platform', async () => {
    const impit = await import('impit')
    expect(typeof impit.Impit).toBe('function')
  })
})
