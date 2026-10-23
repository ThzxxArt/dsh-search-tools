/** Readable HTTP fetch adapter config: defaults, normalisation, validation. Browser-safe. */

import type { AdapterIssue, AdapterValidation } from '../../../core/types.ts'
import { isRecord, issue, readBoolean, readNumber, readString, result } from '../../../shared/validation.ts'

export interface ReadableHttpConfig {
  enabled: boolean
  readability: boolean
  minArticleChars: number
  maxArticleChars: number
  maxResponseBytes: number
  maxBodyChars: number
  timeoutMs: number
  maxRedirects: number
  userAgent: string
  failOpen: boolean
}

export const DEFAULT_READABLE_HTTP_CONFIG: ReadableHttpConfig = {
  enabled: true,
  readability: true,
  minArticleChars: 200,
  maxArticleChars: 200_000,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 2_000_000,
  timeoutMs: 20_000,
  maxRedirects: 5,
  userAgent: 'dsh-search-tools/0.1.5 (+https://github.com/ThzxxArt/dsh-search-tools)',
  failOpen: true,
}

const NUMBER_FIELDS: readonly {
  key: string
  label: string
  min: number
  max: number
}[] = [
  { key: 'minArticleChars', label: 'Minimum article characters', min: 0, max: 100_000 },
  { key: 'maxArticleChars', label: 'Maximum article characters', min: 1_000, max: 5_000_000 },
  { key: 'maxResponseBytes', label: 'Maximum response bytes', min: 1_024, max: 50_000_000 },
  { key: 'maxBodyChars', label: 'Maximum decoded characters', min: 1_024, max: 20_000_000 },
  { key: 'timeoutMs', label: 'Timeout', min: 1_000, max: 120_000 },
  { key: 'maxRedirects', label: 'Maximum redirects', min: 0, max: 10 },
]

export function normalizeReadableHttpConfig(raw: unknown): ReadableHttpConfig {
  const value = isRecord(raw) ? raw : {}
  return {
    ...DEFAULT_READABLE_HTTP_CONFIG,
    ...value,
    enabled: readBoolean(value.enabled, DEFAULT_READABLE_HTTP_CONFIG.enabled),
    readability: readBoolean(value.readability, DEFAULT_READABLE_HTTP_CONFIG.readability),
    minArticleChars: clampInt(readNumber(value.minArticleChars, 200), 0, 100_000),
    maxArticleChars: clampInt(readNumber(value.maxArticleChars, 200_000), 1_000, 5_000_000),
    maxResponseBytes: clampInt(readNumber(value.maxResponseBytes, 5_000_000), 1_024, 50_000_000),
    maxBodyChars: clampInt(readNumber(value.maxBodyChars, 2_000_000), 1_024, 20_000_000),
    timeoutMs: clampInt(readNumber(value.timeoutMs, 20_000), 1_000, 120_000),
    maxRedirects: clampInt(readNumber(value.maxRedirects, 5), 0, 10),
    userAgent: readString(value.userAgent, DEFAULT_READABLE_HTTP_CONFIG.userAgent).trim() || DEFAULT_READABLE_HTTP_CONFIG.userAgent,
    failOpen: readBoolean(value.failOpen, DEFAULT_READABLE_HTTP_CONFIG.failOpen),
  }
}

export function validateReadableHttpConfig(raw: unknown): AdapterValidation {
  const value = isRecord(raw) ? raw : {}
  const issues: AdapterIssue[] = []
  const minArticleChars = readNumber(value.minArticleChars, 200)
  const maxArticleChars = readNumber(value.maxArticleChars, 200_000)
  const maxBodyChars = readNumber(value.maxBodyChars, 2_000_000)
  if (maxArticleChars < minArticleChars) issues.push(issue('maxArticleChars', '正文上限不能小于正文下限', 'readable.maxArticleBelowMin'))
  if (maxBodyChars < minArticleChars) issues.push(issue('maxBodyChars', '解码上限不能小于正文下限', 'readable.maxBodyBelowMin'))
  if (maxArticleChars > maxBodyChars) issues.push(issue('maxArticleChars', '正文上限不能大于解码上限', 'readable.maxArticleAboveBody'))

  for (const field of NUMBER_FIELDS) {
    const rawValue = value[field.key]
    if (rawValue === undefined) continue
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || !Number.isInteger(rawValue)) {
      issues.push(issue(field.key, `${field.label}必须是数字`, 'field.number', { label: field.label }))
      continue
    }
    if (rawValue < field.min) issues.push(issue(field.key, `${field.label}不能小于 ${field.min}`, 'field.min', { label: field.label, min: field.min }))
    if (rawValue > field.max) issues.push(issue(field.key, `${field.label}不能大于 ${field.max}`, 'field.max', { label: field.label, max: field.max }))
  }
  for (const key of ['enabled', 'readability', 'failOpen'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      issues.push(issue(key, `${key} 必须是布尔值`, 'field.boolean', { label: key }))
    }
  }
  const userAgent = readString(value.userAgent, DEFAULT_READABLE_HTTP_CONFIG.userAgent).trim()
  if (value.userAgent !== undefined && typeof value.userAgent !== 'string') {
    issues.push(issue('userAgent', 'User-Agent 必须是字符串', 'field.string', { label: 'User-Agent' }))
  } else if (userAgent.length === 0 || /[\r\n]/u.test(userAgent)) {
    issues.push(issue('userAgent', 'User-Agent 不能为空或包含换行', 'userAgent.invalid'))
  }
  return result(issues)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
