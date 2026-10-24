/** SearXNG adapter config: defaults, normalisation, validation. Browser-safe. */

import type { AdapterIssue, AdapterValidation } from '../../../core/types.ts'
import { normalizeInstanceUrl } from '../../../shared/url.ts'
import {
  isRecord, issue, normalizeTags, readBoolean, readNumber, readString, result,
} from '../../../shared/validation.ts'

export type SearxngAuthType = 'none' | 'bearer' | 'basic'
export type SearxngTimeRange = '' | 'day' | 'week' | 'month' | 'year'
export type SearxngStrategy = 'ordered' | 'round-robin'
export type SearxngFormat = 'auto' | 'json' | 'html'
export type SearxngMethod = 'GET' | 'POST'

export interface SearxngInstance {
  url: string
  enabled: boolean
  label: string
}

export interface SearxngConfig {
  enabled: boolean
  instances: SearxngInstance[]
  engines: string[]
  categories: string[]
  language: string
  safesearch: 0 | 1 | 2
  timeRange: SearxngTimeRange
  pages: number
  maxResults: number
  strategy: SearxngStrategy
  method: SearxngMethod
  format: SearxngFormat
  auth: { type: SearxngAuthType }
  requestTimeoutMs: number
  deadlineMs: number
  retries: number
  cacheTtlMs: number
  cacheMaxEntries: number
  userAgent: string
  proxy: string
  includeDomains: string[]
  excludeDomains: string[]
}

export const DEFAULT_SEARXNG_CONFIG: SearxngConfig = {
  enabled: true,
  instances: [],
  engines: [],
  categories: ['general'],
  language: 'all',
  safesearch: 1,
  timeRange: '',
  pages: 1,
  maxResults: 10,
  strategy: 'ordered',
  method: 'GET',
  format: 'auto',
  auth: { type: 'none' },
  requestTimeoutMs: 12_000,
  deadlineMs: 45_000,
  retries: 1,
  cacheTtlMs: 300_000,
  cacheMaxEntries: 200,
  userAgent: 'dsh-search-tools/0.1.8 (+https://github.com/ThzxxArt/dsh-search-tools)',
  proxy: '',
  includeDomains: [],
  excludeDomains: [],
}

const AUTH_TYPES = new Set(['none', 'bearer', 'basic'])
const TIME_RANGES = new Set(['', 'day', 'week', 'month', 'year'])
const STRATEGIES = new Set(['ordered', 'round-robin'])
const FORMATS = new Set(['auto', 'json', 'html'])
const METHODS = new Set(['GET', 'POST'])

const NUMBER_FIELDS: readonly {
  key: string
  label: string
  min: number
  max: number
  integer?: boolean
}[] = [
  { key: 'safesearch', label: 'Safe search', min: 0, max: 2 },
  { key: 'pages', label: 'Pages', min: 1, max: 3 },
  { key: 'maxResults', label: 'Results per search', min: 1, max: 20 },
  { key: 'requestTimeoutMs', label: 'Request timeout', min: 1_000, max: 120_000 },
  { key: 'deadlineMs', label: 'Total deadline', min: 1_000, max: 300_000 },
  { key: 'retries', label: 'Retries', min: 0, max: 5 },
  { key: 'cacheTtlMs', label: 'Cache TTL', min: 0, max: 86_400_000 },
  { key: 'cacheMaxEntries', label: 'Cache entries', min: 0, max: 10_000 },
]

const STRING_ARRAY_FIELDS: readonly { key: string; label: string }[] = [
  { key: 'engines', label: 'Engines' },
  { key: 'categories', label: 'Categories' },
  { key: 'includeDomains', label: 'Include domains' },
  { key: 'excludeDomains', label: 'Exclude domains' },
]

/** Merge defaults, normalise instances/tags, and keep unknown keys for forward compatibility. */
export function normalizeSearxngConfig(raw: unknown): SearxngConfig {
  const value = isRecord(raw) ? raw : {}
  const instances = Array.isArray(value.instances)
    ? value.instances.flatMap((entry): SearxngInstance[] => {
      if (!isRecord(entry)) return []
      const url = readString(entry.url, '').trim()
      return [{ url, enabled: readBoolean(entry.enabled, true), label: readString(entry.label, '').trim() }]
    })
    : []
  const auth = isRecord(value.auth) ? value.auth : {}
  const safesearch = readNumber(value.safesearch, DEFAULT_SEARXNG_CONFIG.safesearch)
  return {
    ...DEFAULT_SEARXNG_CONFIG,
    ...value,
    instances,
    engines: normalizeTags(readStringArray(value.engines)),
    categories: normalizeTags(readStringArray(value.categories)),
    language: readString(value.language, DEFAULT_SEARXNG_CONFIG.language).trim() || 'all',
    safesearch: safesearch === 0 || safesearch === 1 || safesearch === 2 ? safesearch : 1,
    timeRange: TIME_RANGES.has(readString(value.timeRange, '')) ? readString(value.timeRange, '') as SearxngTimeRange : '',
    pages: clampInt(readNumber(value.pages, 1), 1, 3),
    maxResults: clampInt(readNumber(value.maxResults, 10), 1, 20),
    strategy: STRATEGIES.has(readString(value.strategy, 'ordered')) ? readString(value.strategy, 'ordered') as SearxngStrategy : 'ordered',
    method: METHODS.has(readString(value.method, 'GET')) ? readString(value.method, 'GET') as SearxngMethod : 'GET',
    format: FORMATS.has(readString(value.format, 'auto')) ? readString(value.format, 'auto') as SearxngFormat : 'auto',
    auth: { type: AUTH_TYPES.has(readString(auth.type, 'none')) ? readString(auth.type, 'none') as SearxngAuthType : 'none' },
    requestTimeoutMs: clampInt(readNumber(value.requestTimeoutMs, 12_000), 1_000, 120_000),
    deadlineMs: clampInt(readNumber(value.deadlineMs, 45_000), 1_000, 300_000),
    retries: clampInt(readNumber(value.retries, 1), 0, 5),
    cacheTtlMs: clampInt(readNumber(value.cacheTtlMs, 300_000), 0, 86_400_000),
    cacheMaxEntries: clampInt(readNumber(value.cacheMaxEntries, 200), 0, 10_000),
    userAgent: readString(value.userAgent, DEFAULT_SEARXNG_CONFIG.userAgent).trim() || DEFAULT_SEARXNG_CONFIG.userAgent,
    proxy: readString(value.proxy, '').trim(),
    includeDomains: normalizeTags(readStringArray(value.includeDomains)),
    excludeDomains: normalizeTags(readStringArray(value.excludeDomains)),
  }
}

export function validateSearxngConfig(raw: unknown): AdapterValidation {
  const value = isRecord(raw) ? raw : {}
  const issues: AdapterIssue[] = []
  if (value.instances !== undefined && !Array.isArray(value.instances)) {
    issues.push(issue('instances', '实例必须是数组', 'field.instances', { label: 'Instances' }))
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    issues.push(issue('enabled', '启用状态必须是布尔值', 'field.boolean', { label: 'Enabled' }))
  }
  const instances = Array.isArray(value.instances) ? value.instances : []
  const seen = new Set<string>()
  instances.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(issue(`instances[${index}]`, '实例必须是对象', 'instances.invalid'))
      return
    }
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
      issues.push(issue(`instances[${index}].enabled`, '实例启用状态必须是布尔值', 'field.boolean', { label: 'Enabled' }))
    }
    if (entry.label !== undefined && typeof entry.label !== 'string') {
      issues.push(issue(`instances[${index}].label`, '实例备注必须是字符串', 'field.string', { label: 'Label' }))
    }
    const url = readString(entry.url, '').trim()
    const enabled = readBoolean(entry.enabled, true)
    if (url.length === 0) {
      if (enabled) issues.push(issue(`instances[${index}].url`, '启用的实例必须有 URL', 'instances.urlRequired'))
      return
    }
    try {
      const normalized = normalizeInstanceUrl(url)
      if (seen.has(normalized)) issues.push(issue(`instances[${index}].url`, '实例 URL 重复', 'instances.urlDuplicate'))
      seen.add(normalized)
    } catch (error) {
      issues.push(issue(
        `instances[${index}].url`,
        error instanceof Error ? error.message : '实例 URL 无效',
        'instances.urlInvalid',
        { reason: error instanceof Error ? error.message : 'invalid URL' },
      ))
    }
  })
  if (value.auth !== undefined) {
    if (!isRecord(value.auth)) {
      issues.push(issue('auth', '认证必须是对象', 'auth.typeInvalid'))
    } else if (!AUTH_TYPES.has(readString(value.auth.type, 'none'))) {
      issues.push(issue('auth.type', '认证类型无效', 'auth.typeInvalid'))
    }
  }
  for (const field of NUMBER_FIELDS) validateNumber(value, field, issues)
  for (const field of STRING_ARRAY_FIELDS) validateStringArray(value, field, issues)
  validateEnum(value, 'timeRange', 'Time range', TIME_RANGES, issues)
  validateEnum(value, 'strategy', 'Instance strategy', STRATEGIES, issues)
  validateEnum(value, 'method', 'Request method', METHODS, issues)
  validateEnum(value, 'format', 'Response format', FORMATS, issues)
  validateText(value, 'language', 'Language', issues)
  validateText(value, 'userAgent', 'User-Agent', issues)
  validateText(value, 'proxy', 'Proxy', issues)

  const requestTimeoutMs = readNumber(value.requestTimeoutMs, 12_000)
  const deadlineMs = readNumber(value.deadlineMs, 45_000)
  if (deadlineMs < requestTimeoutMs) issues.push(issue('deadlineMs', '总预算不能小于单次请求超时', 'deadline.beforeRequest'))

  const proxy = readString(value.proxy, '').trim()
  if (proxy.length > 0) {
    try {
      const url = new URL(proxy)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username.length > 0 || url.password.length > 0) {
        issues.push(issue('proxy', '代理必须是 http(s) URL，且不能包含凭据', 'proxy.credentials'))
      }
    } catch {
      issues.push(issue('proxy', '代理必须是 http(s) URL', 'proxy.invalid'))
    }
  }
  const userAgent = readString(value.userAgent, DEFAULT_SEARXNG_CONFIG.userAgent).trim()
  if (userAgent.length === 0 || /[\r\n]/u.test(userAgent)) {
    issues.push(issue('userAgent', 'User-Agent 不能为空或包含换行', 'userAgent.invalid'))
  }
  return result(issues)
}

function validateNumber(
  value: Record<string, unknown>,
  field: { key: string; label: string; min: number; max: number; integer?: boolean },
  issues: AdapterIssue[],
): void {
  const raw = value[field.key]
  if (raw === undefined) return
  if (typeof raw !== 'number' || !Number.isFinite(raw) || (field.integer !== false && !Number.isInteger(raw))) {
    issues.push(issue(field.key, `${field.label}必须是数字`, 'field.number', { label: field.label }))
    return
  }
  if (raw < field.min) issues.push(issue(field.key, `${field.label}不能小于 ${field.min}`, 'field.min', { label: field.label, min: field.min }))
  if (raw > field.max) issues.push(issue(field.key, `${field.label}不能大于 ${field.max}`, 'field.max', { label: field.label, max: field.max }))
}

function validateStringArray(
  value: Record<string, unknown>,
  field: { key: string; label: string },
  issues: AdapterIssue[],
): void {
  const raw = value[field.key]
  if (raw === undefined) return
  if (!Array.isArray(raw) || raw.some(entry => typeof entry !== 'string')) {
    issues.push(issue(field.key, `${field.label}必须是字符串数组`, 'field.stringArray', { label: field.label }))
  }
}

function validateText(
  value: Record<string, unknown>,
  key: string,
  label: string,
  issues: AdapterIssue[],
): void {
  const raw = value[key]
  if (raw === undefined) return
  if (typeof raw !== 'string') issues.push(issue(key, `${label}必须是字符串`, 'field.string', { label }))
}

function validateEnum(
  value: Record<string, unknown>,
  key: string,
  label: string,
  allowed: ReadonlySet<string>,
  issues: AdapterIssue[],
): void {
  const raw = value[key]
  if (raw === undefined) return
  if (typeof raw !== 'string' || !allowed.has(raw)) {
    issues.push(issue(key, `${label}不是允许的选项`, 'field.option', { label }))
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
