import { describe, expect, it } from 'vitest'
import { fetchPreviewTimeoutMs, fetchProbeTimeoutMs } from '../src/host/routes.ts'

describe('fetch route timeouts', () => {
  it('keeps the previous defaults when no adapter timeout is configured', () => {
    expect(fetchPreviewTimeoutMs({})).toBe(30_000)
    expect(fetchProbeTimeoutMs({})).toBe(30_000)
  })

  it('adds five seconds of route overhead to a Jina-sized timeout', () => {
    expect(fetchPreviewTimeoutMs({ timeoutMs: 25_000 })).toBe(30_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: 60_000 })).toBe(65_000)
    expect(fetchProbeTimeoutMs({ timeoutMs: 25_000 })).toBe(30_000)
    expect(fetchProbeTimeoutMs({ timeoutMs: 60_000 })).toBe(65_000)
  })

  it('caps the route signal below the Jina 180s limit plus overhead', () => {
    expect(fetchPreviewTimeoutMs({ timeoutMs: 180_000 })).toBe(185_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: 999_999 })).toBe(190_000)
    expect(fetchProbeTimeoutMs({ timeoutMs: 180_000 })).toBe(185_000)
    expect(fetchProbeTimeoutMs({ timeoutMs: 999_999 })).toBe(190_000)
  })

  it('ignores malformed or non-positive timeout drafts instead of crashing the route', () => {
    expect(fetchPreviewTimeoutMs({ timeoutMs: '60s' })).toBe(30_000)
    expect(fetchPreviewTimeoutMs({ timeoutMs: Number.NaN })).toBe(30_000)
    expect(fetchProbeTimeoutMs({ timeoutMs: -1 })).toBe(30_000)
  })
})
