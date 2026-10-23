/** Jina Reader fetch adapter config: defaults, normalisation, validation. Browser-safe. */

import type { AdapterIssue, AdapterValidation } from '../../../core/types.ts'
import { isRecord, issue, readBoolean, readNumber, result } from '../../../shared/validation.ts'

export type JinaEngine = 'auto' | 'browser' | 'curl'
export type JinaResponseMode = 'markdown' | 'html' | 'text'
export type JinaRetainImages = 'none' | 'all'
export type JinaRetainLinks = 'none' | 'all'
export type JinaUpstreamProxy = 'none' | 'auto'

export interface JinaReaderConfig {
  enabled: boolean
  endpoint: string
  engine: JinaEngine
  responseMode: JinaResponseMode
  timeoutMs: number
  maxResponseBytes: number
  maxBodyChars: number
  waitForSelector: string
  targetSelector: string
  removeSelector: string
  includeIframes: boolean
  includeShadowDom: boolean
  noCache: boolean
  respectRobots: boolean
  retainImages: JinaRetainImages
  retainLinks: JinaRetainLinks
  upstreamProxy: JinaUpstreamProxy
  locale: string
  userAgent: string
}

export const DEFAULT_JINA_READER_CONFIG: JinaReaderConfig = {
  enabled: true,
  endpoint: 'https://r.jina.ai/',
  engine: 'auto',
  responseMode: 'markdown',
  timeoutMs: 25_000,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 200_000,
  waitForSelector: '',
  targetSelector: '',
  removeSelector: '',
  includeIframes: false,
  includeShadowDom: false,
  noCache: false,
  respectRobots: true,
  retainImages: 'none',
  retainLinks: 'all',
  upstreamProxy: 'none',
  locale: '',
  userAgent: '',
}

const ENGINES: readonly JinaEngine[] = ['auto', 'browser', 'curl']
const RESPONSE_MODES: readonly JinaResponseMode[] = ['markdown', 'html', 'text']
const RETAIN_IMAGES: readonly JinaRetainImages[] = ['none', 'all']
const RETAIN_LINKS: readonly JinaRetainLinks[] = ['none', 'all']
const UPSTREAM_PROXIES: readonly JinaUpstreamProxy[] = ['none', 'auto']
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/u
const SELECTOR_MAX_CHARS = 1_000
const USER_AGENT_MAX_CHARS = 512

const NUMBER_FIELDS: readonly { key: keyof JinaReaderConfig; label: string; min: number; max: number }[] = [
  { key: 'timeoutMs', label: 'Timeout', min: 1_000, max: 180_000 },
  { key: 'maxResponseBytes', label: 'Maximum response bytes', min: 1_024, max: 50_000_000 },
  { key: 'maxBodyChars', label: 'Maximum decoded characters', min: 1_024, max: 20_000_000 },
]

export function normalizeJinaReaderConfig(raw: unknown): JinaReaderConfig {
  const value = isRecord(raw) ? raw : {}
  return {
    enabled: readBoolean(value.enabled, DEFAULT_JINA_READER_CONFIG.enabled),
    endpoint: endpointOrDefault(value.endpoint),
    engine: readEnum(value.engine, ENGINES, DEFAULT_JINA_READER_CONFIG.engine),
    responseMode: readEnum(value.responseMode, RESPONSE_MODES, DEFAULT_JINA_READER_CONFIG.responseMode),
    timeoutMs: clampInt(readNumber(value.timeoutMs, DEFAULT_JINA_READER_CONFIG.timeoutMs), 1_000, 180_000),
    maxResponseBytes: clampInt(readNumber(value.maxResponseBytes, DEFAULT_JINA_READER_CONFIG.maxResponseBytes), 1_024, 50_000_000),
    maxBodyChars: clampInt(readNumber(value.maxBodyChars, DEFAULT_JINA_READER_CONFIG.maxBodyChars), 1_024, 20_000_000),
    waitForSelector: selectorOrDefault(value.waitForSelector),
    targetSelector: selectorOrDefault(value.targetSelector),
    removeSelector: selectorOrDefault(value.removeSelector),
    includeIframes: readBoolean(value.includeIframes, DEFAULT_JINA_READER_CONFIG.includeIframes),
    includeShadowDom: readBoolean(value.includeShadowDom, DEFAULT_JINA_READER_CONFIG.includeShadowDom),
    noCache: readBoolean(value.noCache, DEFAULT_JINA_READER_CONFIG.noCache),
    respectRobots: readBoolean(value.respectRobots, DEFAULT_JINA_READER_CONFIG.respectRobots),
    retainImages: readEnum(value.retainImages, RETAIN_IMAGES, DEFAULT_JINA_READER_CONFIG.retainImages),
    retainLinks: readEnum(value.retainLinks, RETAIN_LINKS, DEFAULT_JINA_READER_CONFIG.retainLinks),
    upstreamProxy: readEnum(value.upstreamProxy, UPSTREAM_PROXIES, DEFAULT_JINA_READER_CONFIG.upstreamProxy),
    locale: localeOrDefault(value.locale),
    userAgent: userAgentOrDefault(value.userAgent),
  }
}

export function validateJinaReaderConfig(raw: unknown): AdapterValidation {
  const value = isRecord(raw) ? raw : {}
  const issues: AdapterIssue[] = []

  if (value.endpoint !== undefined) {
    if (typeof value.endpoint !== 'string') {
      issues.push(issue('endpoint', 'Endpoint 必须是字符串', 'field.string', { label: 'Endpoint' }))
    } else {
      try {
        normalizeJinaEndpoint(value.endpoint)
      } catch (error) {
        issues.push(issue(
          'endpoint',
          error instanceof Error ? error.message : String(error),
          error instanceof JinaEndpointError ? error.code : 'jina.endpointInvalid',
        ))
      }
    }
  }

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

  for (const [key, allowed] of [
    ['engine', ENGINES],
    ['responseMode', RESPONSE_MODES],
    ['retainImages', RETAIN_IMAGES],
    ['retainLinks', RETAIN_LINKS],
    ['upstreamProxy', UPSTREAM_PROXIES],
  ] as const) {
    const rawValue = value[key]
    if (rawValue === undefined) continue
    if (typeof rawValue !== 'string' || !(allowed as readonly string[]).includes(rawValue)) {
      issues.push(issue(key, `${key} 不是允许的选项`, 'field.option', { label: key }))
    }
  }

  for (const key of ['enabled', 'includeIframes', 'includeShadowDom', 'noCache', 'respectRobots'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      issues.push(issue(key, `${key} 必须是布尔值`, 'field.boolean', { label: key }))
    }
  }

  for (const key of ['waitForSelector', 'targetSelector', 'removeSelector'] as const) {
    validateSelector(value[key], key, issues)
  }
  validateLocale(value.locale, issues)
  validateUserAgent(value.userAgent, issues)

  return result(issues)
}

/**
 * Normalise a Reader endpoint. HTTPS is required for remote endpoints; plain
 * HTTP is only accepted for loopback, where the configured API key cannot
 * cross a network in cleartext.
 */
export class JinaEndpointError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'JinaEndpointError'
  }
}

export function normalizeJinaEndpoint(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new JinaEndpointError('Endpoint 不能为空', 'jina.endpointEmpty')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new JinaEndpointError('Endpoint 必须是 http(s) 绝对 URL', 'jina.endpointInvalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new JinaEndpointError('Endpoint 必须是 http(s) 绝对 URL', 'jina.endpointInvalid')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new JinaEndpointError('Endpoint 不能包含用户名或密码', 'jina.endpointCredentials')
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new JinaEndpointError('Endpoint 不能包含 query 或 hash', 'jina.endpointQuery')
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new JinaEndpointError('远程 Endpoint 必须使用 https；只有 loopback 允许 http', 'jina.endpointInsecure')
  }
  const pathname = url.pathname.replace(/\/+$/u, '')
  url.pathname = `${pathname}/`
  return url.toString()
}

function endpointOrDefault(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return DEFAULT_JINA_READER_CONFIG.endpoint
  try {
    return normalizeJinaEndpoint(raw)
  } catch {
    return raw.trim()
  }
}

function selectorOrDefault(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function localeOrDefault(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function userAgentOrDefault(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? raw as T : fallback
}

function validateSelector(raw: unknown, key: string, issues: AdapterIssue[]): void {
  if (raw === undefined) return
  if (typeof raw !== 'string') {
    issues.push(issue(key, `${key} 必须是字符串`, 'field.string', { label: key }))
    return
  }
  if (raw.length > SELECTOR_MAX_CHARS || /[\r\n]/u.test(raw)) {
    issues.push(issue(key, `${key} 不能超过 ${SELECTOR_MAX_CHARS} 字符或包含换行`, 'jina.selector'))
  }
}

function validateLocale(raw: unknown, issues: AdapterIssue[]): void {
  if (raw === undefined) return
  if (typeof raw !== 'string') {
    issues.push(issue('locale', 'locale 必须是字符串', 'field.string', { label: 'locale' }))
    return
  }
  const trimmed = raw.trim()
  if (trimmed.length > 0 && !LOCALE_PATTERN.test(trimmed)) {
    issues.push(issue('locale', 'locale 必须是 BCP 47 形式，例如 zh-CN', 'jina.locale'))
  }
}

function validateUserAgent(raw: unknown, issues: AdapterIssue[]): void {
  if (raw === undefined) return
  if (typeof raw !== 'string') {
    issues.push(issue('userAgent', 'User-Agent 必须是字符串', 'field.string', { label: 'User-Agent' }))
    return
  }
  if (raw.length > USER_AGENT_MAX_CHARS || /[\r\n]/u.test(raw)) {
    issues.push(issue('userAgent', `User-Agent 不能超过 ${USER_AGENT_MAX_CHARS} 字符或包含换行`, 'jina.userAgent'))
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/u, '').replace(/\]$/u, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (ipv4 === null || Number(ipv4[1]) !== 127) return false
  return ipv4.slice(1).every(octet => Number(octet) <= 255)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
