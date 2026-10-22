/** Small, dependency-free validation helpers shared by adapters and the page. */

import type { AdapterField, AdapterIssue, AdapterManifest, AdapterValidation, JsonObject } from '../core/types.ts'
import { getPath } from './path.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean)
}

export function normalizeTags(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

export function issue(path: string, message: string): AdapterIssue {
  return { path, message }
}

export function result(issues: readonly AdapterIssue[]): AdapterValidation {
  return { ok: issues.length === 0, issues }
}

/** Validate fields declared by an external adapter manifest without adapter code in the browser. */
export function validateManifestConfig(manifest: AdapterManifest, config: unknown): AdapterValidation {
  const value = isRecord(config) ? config : {}
  const issues: AdapterIssue[] = []
  for (const field of manifest.fields) {
    validateField(field, getPath(value, field.key), issues)
  }
  return result(issues)
}

function validateField(field: AdapterField, value: unknown, issues: AdapterIssue[]): void {
  if (value === undefined || value === null || value === '') {
    if (field.required) issues.push(issue(field.key, `${field.label}不能为空`))
    return
  }
  switch (field.kind) {
    case 'text':
    case 'url':
    case 'password':
      if (typeof value !== 'string') issues.push(issue(field.key, `${field.label}必须是字符串`))
      else if (field.kind === 'url' && !isHttpUrl(value)) issues.push(issue(field.key, `${field.label}必须是 http(s) URL`))
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(issue(field.key, `${field.label}必须是数字`))
        return
      }
      if (field.min !== undefined && value < field.min) issues.push(issue(field.key, `${field.label}不能小于 ${field.min}`))
      if (field.max !== undefined && value > field.max) issues.push(issue(field.key, `${field.label}不能大于 ${field.max}`))
      break
    case 'boolean':
      if (typeof value !== 'boolean') issues.push(issue(field.key, `${field.label}必须是布尔值`))
      break
    case 'select':
      if (typeof value !== 'string' || !field.options.some(option => option.value === value)) {
        issues.push(issue(field.key, `${field.label}不是允许的选项`))
      }
      break
    case 'tags':
      if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        issues.push(issue(field.key, `${field.label}必须是字符串数组`))
      }
      break
    case 'instances':
      if (!Array.isArray(value) || value.some(entry => !isRecord(entry))) {
        issues.push(issue(field.key, `${field.label}必须是实例数组`))
      }
      break
  }
}

/** Return a plain JSON object from an unknown adapter config. */
export function asJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? value as JsonObject : {}
}

/** Build a stable cache key from JSON-shaped values. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!isRecord(entry)) return entry
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)))
  })
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
