import { describe, expect, it } from 'vitest'
import type { StatusResponse } from '../src/core/types.ts'
import { Diagnostics } from '../src/core/diagnostics.ts'
import { formatDiagnostics } from '../src/client/diagnostic-text.ts'

const status: StatusResponse = {
  version: '0.1.9',
  configPath: '/home/user/.dsh/profiles/demo/cordis.patch.yml',
  search: { enabled: true, registered: true, available: false, adapter: 'searxng', instances: 0, sources: 0 },
  fetch: { enabled: true, registered: true, available: true, adapter: 'readable-http' },
  research: { enabled: true, registered: true },
  credentials: {
    SEARXNG_TOKEN: { configured: true, source: 'file', writable: true },
    SEARXNG_BASIC_AUTH: { configured: false, writable: true },
  },
  cache: { size: 3, hits: 2, misses: 1 },
  lastErrors: [
    { time: '2026-10-22T08:00:00.000Z', code: 'SEARCH_FAILED', host: 'searx.example.com', message: 'upstream 502' },
  ],
}

describe('formatDiagnostics', () => {
  it('summarizes adapter state, cache, and redacted errors', () => {
    const text = formatDiagnostics(status)

    expect(text).toContain('search: adapter=searxng available=false')
    expect(text).toContain('sources=0')
    expect(text).toContain('SEARXNG_TOKEN=configured')
    expect(text).toContain('SEARXNG_BASIC_AUTH=unset')
    expect(text).toContain('cache: size=3 hits=2 misses=1')
    expect(text).toContain('SEARCH_FAILED searx.example.com: upstream 502')
  })

  it('redacts URLs, bearer tokens, and secret assignments at record time', () => {
    const diagnostics = new Diagnostics()
    const entry = diagnostics.record(
      new Error('fetch https://example.com/private?q=secret failed with Bearer abc.def token=xyz password=hunter2'),
      'FETCH_FAILED',
      'https://example.com/private?q=secret',
    )
    expect(entry.host).toBe('https://example.com/private')
    expect(entry.message).not.toContain('q=secret')
    expect(entry.message).not.toContain('abc.def')
    expect(entry.message).not.toContain('xyz')
    expect(entry.message).not.toContain('hunter2')
    expect(entry.message).toContain('https://example.com/private')
  })

  it('falls back to instances when an older status payload omits sources', () => {
    const { sources: _sources, ...search } = status.search
    const text = formatDiagnostics({ ...status, search })
    expect(text).toContain('sources=0')
  })
})
