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
  userAgent: 'dsh-search-tools/0.1.0 (+https://github.com/ThzxxArt/dsh-search-tools)',
  proxy: '',
  includeDomains: [],
  excludeDomains: [],
}

const AUTH_TYPES = new Set(['none', 'bearer', 'basic'])
const TIME_RANGES = new Set(['', 'day', 'week', 'month', 'year'])
const STRATEGIES = new Set(['ordered', 'round-robin'])
const FORMATS = new Set(['auto', 'json', 'html'])
const METHODS = new Set(['GET', 'POST'])

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
  const instances = Array.isArray(value.instances) ? value.instances : []
  const seen = new Set<string>()
  instances.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(issue(`instances[${index}]`, '实例必须是对象'))
      return
    }
    const url = readString(entry.url, '').trim()
    const enabled = readBoolean(entry.enabled, true)
    if (url.length === 0) {
      if (enabled) issues.push(issue(`instances[${index}].url`, '启用的实例必须有 URL'))
      return
    }
    try {
      const normalized = normalizeInstanceUrl(url)
      if (seen.has(normalized)) issues.push(issue(`instances[${index}].url`, '实例 URL 重复'))
      seen.add(normalized)
    } catch (error) {
      issues.push(issue(`instances[${index}].url`, error instanceof Error ? error.message : '实例 URL 无效'))
    }
  })
  const auth = isRecord(value.auth) ? readString(value.auth.type, 'none') : 'none'
  if (!AUTH_TYPES.has(auth)) issues.push(issue('auth.type', '认证类型无效'))
  const requestTimeoutMs = readNumber(value.requestTimeoutMs, 12_000)
  const deadlineMs = readNumber(value.deadlineMs, 45_000)
  if (deadlineMs < requestTimeoutMs) issues.push(issue('deadlineMs', '总预算不能小于单次请求超时'))
  const proxy = readString(value.proxy, '').trim()
  if (proxy.length > 0) {
    try {
      const url = new URL(proxy)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username.length > 0 || url.password.length > 0) {
        issues.push(issue('proxy', '代理必须是 http(s) URL，且不能包含凭据'))
      }
    } catch {
      issues.push(issue('proxy', '代理必须是 http(s) URL'))
    }
  }
  const userAgent = readString(value.userAgent, DEFAULT_SEARXNG_CONFIG.userAgent).trim()
  if (userAgent.length === 0 || /[\r\n]/u.test(userAgent)) issues.push(issue('userAgent', 'User-Agent 不能为空或包含换行'))
  return result(issues)
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
