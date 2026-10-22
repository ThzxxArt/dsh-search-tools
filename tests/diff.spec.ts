import { describe, expect, it } from 'vitest'
import { deepEqual, diffSections, mergeUnknown } from '../src/shared/diff.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'

describe('section diff', () => {
  it('unsets a section equal to base and sets a changed section', () => {
    const draft: StoredConfig = structuredClone(DEFAULT_STORED_CONFIG)
    draft.research.maxResults = 5
    const current: StoredConfig = structuredClone(DEFAULT_STORED_CONFIG)
    const ops = diffSections(draft, current, DEFAULT_STORED_CONFIG)
    expect(ops).toContainEqual({ op: 'set', path: ['research'], value: expect.objectContaining({ maxResults: 5 }) })
  })

  it('emits no op for an unchanged section', () => {
    const draft = structuredClone(DEFAULT_STORED_CONFIG)
    const ops = diffSections(draft, DEFAULT_STORED_CONFIG, DEFAULT_STORED_CONFIG)
    expect(ops).toEqual([{ op: 'unset', path: ['search'] }, { op: 'unset', path: ['fetch'] }, { op: 'unset', path: ['research'] }, { op: 'unset', path: ['activation'] }])
  })

  it('preserves unknown keys when merging', () => {
    const merged = mergeUnknown({ known: 1, future: { a: 1 } }, { known: 2 })
    expect(merged).toEqual({ known: 2, future: { a: 1 } })
  })

  it('compares nested values structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: [1] }, { a: [2] })).toBe(false)
  })
})
