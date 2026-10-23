import { describe, expect, it } from 'vitest'
import type { StatusResponse } from '../src/core/types.ts'
import { formatDiagnostics } from '../src/client/diagnostic-text.ts'

const status: StatusResponse = {
  version: '0.1.6',
  configPath: '/home/user/.dsh/profiles/demo/cordis.patch.yml',
  search: { enabled: true, registered: true, available: false, adapter: 'searxng', instances: 0 },
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
    expect(text).toContain('SEARXNG_TOKEN=configured')
    expect(text).toContain('SEARXNG_BASIC_AUTH=unset')
    expect(text).toContain('cache: size=3 hits=2 misses=1')
    expect(text).toContain('SEARCH_FAILED searx.example.com: upstream 502')
  })

})
