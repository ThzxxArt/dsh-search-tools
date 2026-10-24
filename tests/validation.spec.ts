import { describe, expect, it } from 'vitest'
import type { AdapterField, AdapterManifest } from '../src/core/types.ts'
import {
  asJsonObject, isRecord, issue, normalizeTags, readBoolean, readNumber,
  readString, readStringArray, result, stableKey, validateManifestConfig,
} from '../src/shared/validation.ts'

const fields: AdapterField[] = [
  { key: 'name', label: { en: 'Name' }, kind: 'text', required: true },
  { key: 'site', label: 'Site', kind: 'url' },
  { key: 'token', label: 'Token', kind: 'password' },
  { key: 'count', label: 'Count', kind: 'number', min: 1, max: 10 },
  { key: 'enabled', label: 'Enabled', kind: 'boolean' },
  { key: 'mode', label: 'Mode', kind: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  { key: 'tags', label: 'Tags', kind: 'tags' },
  {
    key: 'sources', label: 'Sources', kind: 'checkboxes', required: true,
    options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }],
  },
  { key: 'instances', label: 'Instances', kind: 'instances' },
]

const manifest: AdapterManifest = {
  kind: 'search',
  id: 'validation',
  label: 'Validation',
  description: 'Validation adapter',
  fields,
  defaults: {},
}

function issuesFor(config: unknown): string[] {
  return validateManifestConfig(manifest, config).issues.map(entry => entry.code ?? entry.path)
}

describe('validation primitives', () => {
  it('reads and normalizes primitive values', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord({})).toBe(true)
    expect(readString('value', 'fallback')).toBe('value')
    expect(readString(1, 'fallback')).toBe('fallback')
    expect(readBoolean(false, true)).toBe(false)
    expect(readBoolean('false', true)).toBe(true)
    expect(readNumber(2, 1)).toBe(2)
    expect(readNumber(Number.NaN, 1)).toBe(1)
    expect(readNumber(Number.POSITIVE_INFINITY, 1)).toBe(1)
    expect(readStringArray([' a ', 2, '', 'b'], ['fallback'])).toEqual(['a', 'b'])
    expect(readStringArray('not-an-array', ['fallback'])).toEqual(['fallback'])
    expect(normalizeTags([' A ', 'a', '', 'B', 'b'])).toEqual(['A', 'B'])
    expect(issue('path', 'message')).toEqual({ path: 'path', message: 'message' })
    expect(issue('path', 'message', 'code', { value: 1 }))
      .toEqual({ path: 'path', message: 'message', code: 'code', params: { value: 1 } })
    expect(result([])).toEqual({ ok: true, issues: [] })
    expect(result([issue('x', 'bad')]).ok).toBe(false)
  })

  it('builds stable keys regardless of object key order', () => {
    expect(stableKey({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableKey({ a: { c: 3, d: 4 }, b: 2 }))
    expect(stableKey([1, 'two', null])).toBe('[1,"two",null]')
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 })
    expect(asJsonObject(null)).toEqual({})
    expect(asJsonObject([1])).toEqual({})
  })
})

describe('manifest field validation', () => {
  it('accepts a complete valid config', () => {
    const validation = validateManifestConfig(manifest, {
      name: 'n',
      site: 'https://example.com',
      token: 'secret',
      count: 5,
      enabled: true,
      mode: 'a',
      tags: ['one', 'two'],
      sources: ['one'],
      instances: [{ url: 'https://example.com' }],
    })
    expect(validation).toEqual({ ok: true, issues: [] })
  })

  it('reports required, empty, and wrong-type values', () => {
    expect(issuesFor({})).toEqual(expect.arrayContaining(['field.required', 'field.required']))
    expect(issuesFor({ name: '', sources: [] })).toEqual(expect.arrayContaining(['field.required', 'field.required']))
    expect(issuesFor({
      name: 1,
      site: 'not-a-url',
      token: false,
      count: 'five',
      enabled: 'yes',
      mode: 'missing',
      tags: ['ok', 2],
      sources: 'one',
      instances: ['not-an-object'],
    })).toEqual(expect.arrayContaining([
      'field.string', 'field.httpUrl', 'field.number', 'field.boolean',
      'field.option', 'field.stringArray', 'field.stringArray', 'field.instances',
    ]))
  })

  it('reports numeric bounds and malformed numbers', () => {
    expect(issuesFor({ name: 'n', count: 0, sources: ['one'] }))
      .toContain('field.min')
    expect(issuesFor({ name: 'n', count: 11, sources: ['one'] }))
      .toContain('field.max')
    expect(issuesFor({ name: 'n', count: Number.NaN, sources: ['one'] }))
      .toContain('field.number')
    expect(issuesFor({ name: 'n', count: Number.POSITIVE_INFINITY, sources: ['one'] }))
      .toContain('field.number')
  })

  it('reports unknown checkbox options, malformed arrays, and non-object configs', () => {
    expect(issuesFor({ name: 'n', sources: ['one', 'unknown'] }))
      .toContain('field.option')
    expect(issuesFor({ name: 'n', sources: [1] }))
      .toContain('field.stringArray')
    expect(issuesFor({ name: 'n', sources: ['one'], instances: {} }))
      .toContain('field.instances')
    expect(issuesFor({ name: 'n', sources: ['one'], instances: [{}, { url: 'x' }] }))
      .not.toContain('field.instances')
    expect(validateManifestConfig(manifest, null).ok).toBe(false)
  })

  it('does not require optional empty fields', () => {
    expect(issuesFor({ name: 'n', sources: ['one'], tags: null, enabled: null }))
      .toEqual([])
  })
})
