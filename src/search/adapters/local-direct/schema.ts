/** local-direct adapter config: defaults, normalisation, and validation. Browser-safe. */

import type { AdapterIssue, AdapterValidation } from '../../../core/types.ts'
import {
  isRecord, issue, normalizeTags, readBoolean, readNumber, readString, result,
} from '../../../shared/validation.ts'

export type LocalDirectEngine = 'duckduckgo' | 'bing' | 'brave' | 'so360'
export type LocalDirectMarket = 'auto' | 'us-en' | 'cn-zh' | 'gb-en' | 'jp-ja' | 'de-de' | 'fr-fr'
export type LocalDirectSafeSearch = 'off' | 'moderate' | 'strict'
export type LocalDirectProfile = 'chrome' | 'firefox'

export interface LocalDirectConfig {
  enabled: boolean
  engines: LocalDirectEngine[]
  market: LocalDirectMarket
  safeSearch: LocalDirectSafeSearch
  maxResults: number
  maxPerHost: number
  profile: LocalDirectProfile
  requestTimeoutMs: number
  deadlineMs: number
  retries: number
  minIntervalMs: number
  cacheTtlMs: number
  cacheMaxEntries: number
  maxResponseBytes: number
  proxy: string
  includeDomains: string[]
  excludeDomains: string[]
}

export const LOCAL_DIRECT_ENGINES: readonly LocalDirectEngine[] = [
  'duckduckgo', 'bing', 'brave', 'so360',
]
export const LOCAL_DIRECT_MARKETS: readonly LocalDirectMarket[] = [
  'auto', 'us-en', 'cn-zh', 'gb-en', 'jp-ja', 'de-de', 'fr-fr',
]
export const LOCAL_DIRECT_SAFE_SEARCH: readonly LocalDirectSafeSearch[] = ['off', 'moderate', 'strict']
export const LOCAL_DIRECT_PROFILES: readonly LocalDirectProfile[] = ['chrome', 'firefox']

export const DEFAULT_LOCAL_DIRECT_CONFIG: LocalDirectConfig = {
  enabled: true,
  engines: ['duckduckgo', 'bing'],
  market: 'auto',
  safeSearch: 'moderate',
  maxResults: 10,
  maxPerHost: 2,
  profile: 'chrome',
  requestTimeoutMs: 8_000,
  deadlineMs: 15_000,
  retries: 1,
  minIntervalMs: 1_000,
  cacheTtlMs: 300_000,
  cacheMaxEntries: 200,
  maxResponseBytes: 2_000_000,
  proxy: '',
  includeDomains: [],
  excludeDomains: [],
}

const ENGINE_SET = new Set<string>(LOCAL_DIRECT_ENGINES)
const MARKET_SET = new Set<string>(LOCAL_DIRECT_MARKETS)
const SAFE_SET = new Set<string>(LOCAL_DIRECT_SAFE_SEARCH)
const PROFILE_SET = new Set<string>(LOCAL_DIRECT_PROFILES)

const NUMBER_FIELDS: readonly {
  key: keyof Pick<LocalDirectConfig,
    'maxResults' | 'maxPerHost' | 'requestTimeoutMs' | 'deadlineMs' | 'retries'
    | 'minIntervalMs' | 'cacheTtlMs' | 'cacheMaxEntries' | 'maxResponseBytes'>
  label: string
  min: number
  max: number
}[] = [
  { key: 'maxResults', label: 'Results per search', min: 1, max: 20 },
  { key: 'maxPerHost', label: 'Results per host', min: 1, max: 5 },
  { key: 'requestTimeoutMs', label: 'Request timeout', min: 1_000, max: 30_000 },
  { key: 'deadlineMs', label: 'Total deadline', min: 1_000, max: 60_000 },
  { key: 'retries', label: 'Retries', min: 0, max: 2 },
  { key: 'minIntervalMs', label: 'Engine interval', min: 0, max: 10_000 },
  { key: 'cacheTtlMs', label: 'Cache TTL', min: 0, max: 86_400_000 },
  { key: 'cacheMaxEntries', label: 'Cache entries', min: 0, max: 1_000 },
  { key: 'maxResponseBytes', label: 'Response limit', min: 65_536, max: 10_485_760 },
]

/** Merge defaults and normalise engines/domain lists. */
export function normalizeLocalDirectConfig(raw: unknown): LocalDirectConfig {
  const value = isRecord(raw) ? raw : {}
  const engines = value.engines === undefined
    ? [...DEFAULT_LOCAL_DIRECT_CONFIG.engines]
    : normalizeEngines(value.engines)
  const market = readString(value.market, DEFAULT_LOCAL_DIRECT_CONFIG.market)
  const safeSearch = readString(value.safeSearch, DEFAULT_LOCAL_DIRECT_CONFIG.safeSearch)
  const profile = readString(value.profile, DEFAULT_LOCAL_DIRECT_CONFIG.profile)
  return {
    ...DEFAULT_LOCAL_DIRECT_CONFIG,
    ...value,
    enabled: readBoolean(value.enabled, DEFAULT_LOCAL_DIRECT_CONFIG.enabled),
    engines,
    market: MARKET_SET.has(market) ? market as LocalDirectMarket : DEFAULT_LOCAL_DIRECT_CONFIG.market,
    safeSearch: SAFE_SET.has(safeSearch) ? safeSearch as LocalDirectSafeSearch : DEFAULT_LOCAL_DIRECT_CONFIG.safeSearch,
    maxResults: clampInt(readNumber(value.maxResults, DEFAULT_LOCAL_DIRECT_CONFIG.maxResults), 1, 20),
    maxPerHost: clampInt(readNumber(value.maxPerHost, DEFAULT_LOCAL_DIRECT_CONFIG.maxPerHost), 1, 5),
    profile: PROFILE_SET.has(profile) ? profile as LocalDirectProfile : DEFAULT_LOCAL_DIRECT_CONFIG.profile,
    requestTimeoutMs: clampInt(readNumber(value.requestTimeoutMs, DEFAULT_LOCAL_DIRECT_CONFIG.requestTimeoutMs), 1_000, 30_000),
    deadlineMs: clampInt(readNumber(value.deadlineMs, DEFAULT_LOCAL_DIRECT_CONFIG.deadlineMs), 1_000, 60_000),
    retries: clampInt(readNumber(value.retries, DEFAULT_LOCAL_DIRECT_CONFIG.retries), 0, 2),
    minIntervalMs: clampInt(readNumber(value.minIntervalMs, DEFAULT_LOCAL_DIRECT_CONFIG.minIntervalMs), 0, 10_000),
    cacheTtlMs: clampInt(readNumber(value.cacheTtlMs, DEFAULT_LOCAL_DIRECT_CONFIG.cacheTtlMs), 0, 86_400_000),
    cacheMaxEntries: clampInt(readNumber(value.cacheMaxEntries, DEFAULT_LOCAL_DIRECT_CONFIG.cacheMaxEntries), 0, 1_000),
    maxResponseBytes: clampInt(readNumber(value.maxResponseBytes, DEFAULT_LOCAL_DIRECT_CONFIG.maxResponseBytes), 65_536, 10_485_760),
    proxy: readString(value.proxy, '').trim(),
    includeDomains: normalizeTags(readStringArray(value.includeDomains)),
    excludeDomains: normalizeTags(readStringArray(value.excludeDomains)),
  }
}

export function validateLocalDirectConfig(raw: unknown): AdapterValidation {
  const value = isRecord(raw) ? raw : {}
  const issues: AdapterIssue[] = []
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    issues.push(issue('enabled', '启用状态必须是布尔值', 'field.boolean', { label: 'Enabled' }))
  }
  validateEngines(value.engines, issues)
  validateEnum(value, 'market', 'Market', MARKET_SET, issues)
  validateEnum(value, 'safeSearch', 'Safe search', SAFE_SET, issues)
  validateEnum(value, 'profile', 'Browser profile', PROFILE_SET, issues)
  for (const field of NUMBER_FIELDS) validateNumber(value, field, issues)
  for (const key of ['includeDomains', 'excludeDomains'] as const) validateStringArray(value, key, issues)
  validateText(value, 'proxy', 'Proxy', issues)

  const requestTimeoutMs = readNumber(value.requestTimeoutMs, DEFAULT_LOCAL_DIRECT_CONFIG.requestTimeoutMs)
  const deadlineMs = readNumber(value.deadlineMs, DEFAULT_LOCAL_DIRECT_CONFIG.deadlineMs)
  if (deadlineMs < requestTimeoutMs) {
    issues.push(issue('deadlineMs', '总预算不能小于单次请求超时', 'local.deadlineBeforeRequest'))
  }

  const proxy = readString(value.proxy, '').trim()
  if (proxy.length > 0) {
    try {
      const url = new URL(proxy)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username.length > 0 || url.password.length > 0) {
        issues.push(issue('proxy', '代理必须是 http(s) URL，且不能包含凭据', 'local.proxyCredentials'))
      }
    } catch {
      issues.push(issue('proxy', '代理必须是 http(s) URL', 'local.proxyInvalid'))
    }
  }
  return result(issues)
}

export function enabledEngines(config: LocalDirectConfig): LocalDirectEngine[] {
  return config.engines.filter(engine => ENGINE_SET.has(engine))
}

function normalizeEngines(value: unknown): LocalDirectEngine[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const engines: LocalDirectEngine[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const engine = entry.trim().toLowerCase()
    if (!ENGINE_SET.has(engine) || seen.has(engine)) continue
    seen.add(engine)
    engines.push(engine as LocalDirectEngine)
  }
  return engines
}

function validateEngines(value: unknown, issues: AdapterIssue[]): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    issues.push(issue('engines', '引擎必须是字符串数组', 'field.stringArray', { label: 'Engines' }))
    return
  }
  if (value.length === 0) {
    issues.push(issue('engines', '至少启用一个搜索引擎', 'local.enginesEmpty'))
    return
  }
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') {
      issues.push(issue('engines', '引擎必须是字符串数组', 'field.stringArray', { label: 'Engines' }))
      return
    }
    const engine = entry.trim().toLowerCase()
    if (!ENGINE_SET.has(engine)) {
      issues.push(issue('engines', `未知搜索引擎：${entry}`, 'local.engineOption', { engine: entry }))
    } else if (seen.has(engine)) {
      issues.push(issue('engines', `搜索引擎重复：${entry}`, 'local.engineDuplicate', { engine: entry }))
    }
    seen.add(engine)
  }
}

function validateNumber(
  value: Record<string, unknown>,
  field: { key: string; label: string; min: number; max: number },
  issues: AdapterIssue[],
): void {
  const raw = value[field.key]
  if (raw === undefined) return
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    issues.push(issue(field.key, `${field.label}必须是数字`, 'field.number', { label: field.label }))
    return
  }
  if (raw < field.min) issues.push(issue(field.key, `${field.label}不能小于 ${field.min}`, 'field.min', { label: field.label, min: field.min }))
  if (raw > field.max) issues.push(issue(field.key, `${field.label}不能大于 ${field.max}`, 'field.max', { label: field.label, max: field.max }))
}

function validateStringArray(value: Record<string, unknown>, key: string, issues: AdapterIssue[]): void {
  const raw = value[key]
  if (raw === undefined) return
  if (!Array.isArray(raw) || raw.some(entry => typeof entry !== 'string')) {
    issues.push(issue(key, `${key}必须是字符串数组`, 'field.stringArray', { label: key }))
  }
}

function validateText(value: Record<string, unknown>, key: string, label: string, issues: AdapterIssue[]): void {
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
