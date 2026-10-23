/** wire-http fetch adapter config: defaults, normalisation, validation. Browser-safe. */

import type { AdapterIssue, AdapterValidation } from '../../../core/types.ts'
import { isRecord, issue, readBoolean, readNumber, result } from '../../../shared/validation.ts'

export type WireProfile = 'chrome' | 'firefox'

export interface WireHttpConfig {
  enabled: boolean
  profile: WireProfile
  timeoutMs: number
  maxResponseBytes: number
  maxBodyChars: number
  maxRedirects: number
  locale: string
  readability: boolean
  minArticleChars: number
  maxArticleChars: number
  failOpen: boolean
  pdf: boolean
  maxPdfPages: number
}

export const DEFAULT_WIRE_HTTP_CONFIG: WireHttpConfig = {
  enabled: true,
  profile: 'chrome',
  timeoutMs: 25_000,
  maxResponseBytes: 5_000_000,
  maxBodyChars: 2_000_000,
  maxRedirects: 5,
  locale: '',
  readability: true,
  minArticleChars: 200,
  maxArticleChars: 200_000,
  failOpen: true,
  pdf: true,
  maxPdfPages: 10,
}

const PROFILES: readonly WireProfile[] = ['chrome', 'firefox']
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/u

const NUMBER_FIELDS: readonly { key: keyof WireHttpConfig; label: string; min: number; max: number }[] = [
  { key: 'timeoutMs', label: 'Timeout', min: 1_000, max: 180_000 },
  { key: 'maxResponseBytes', label: 'Maximum response bytes', min: 1_024, max: 50_000_000 },
  { key: 'maxBodyChars', label: 'Maximum decoded characters', min: 1_024, max: 20_000_000 },
  { key: 'maxRedirects', label: 'Maximum redirects', min: 0, max: 10 },
  { key: 'minArticleChars', label: 'Minimum article characters', min: 0, max: 100_000 },
  { key: 'maxArticleChars', label: 'Maximum article characters', min: 1_000, max: 5_000_000 },
  { key: 'maxPdfPages', label: 'Maximum PDF pages', min: 1, max: 20 },
]

export function normalizeWireHttpConfig(raw: unknown): WireHttpConfig {
  const value = isRecord(raw) ? raw : {}
  return {
    enabled: readBoolean(value.enabled, DEFAULT_WIRE_HTTP_CONFIG.enabled),
    profile: readProfile(value.profile),
    timeoutMs: clampInt(readNumber(value.timeoutMs, DEFAULT_WIRE_HTTP_CONFIG.timeoutMs), 1_000, 180_000),
    maxResponseBytes: clampInt(readNumber(value.maxResponseBytes, DEFAULT_WIRE_HTTP_CONFIG.maxResponseBytes), 1_024, 50_000_000),
    maxBodyChars: clampInt(readNumber(value.maxBodyChars, DEFAULT_WIRE_HTTP_CONFIG.maxBodyChars), 1_024, 20_000_000),
    maxRedirects: clampInt(readNumber(value.maxRedirects, DEFAULT_WIRE_HTTP_CONFIG.maxRedirects), 0, 10),
    locale: localeOrDefault(value.locale),
    readability: readBoolean(value.readability, DEFAULT_WIRE_HTTP_CONFIG.readability),
    minArticleChars: clampInt(readNumber(value.minArticleChars, DEFAULT_WIRE_HTTP_CONFIG.minArticleChars), 0, 100_000),
    maxArticleChars: clampInt(readNumber(value.maxArticleChars, DEFAULT_WIRE_HTTP_CONFIG.maxArticleChars), 1_000, 5_000_000),
    failOpen: readBoolean(value.failOpen, DEFAULT_WIRE_HTTP_CONFIG.failOpen),
    pdf: readBoolean(value.pdf, DEFAULT_WIRE_HTTP_CONFIG.pdf),
    maxPdfPages: clampInt(readNumber(value.maxPdfPages, DEFAULT_WIRE_HTTP_CONFIG.maxPdfPages), 1, 20),
  }
}

export function validateWireHttpConfig(raw: unknown): AdapterValidation {
  const value = isRecord(raw) ? raw : {}
  const issues: AdapterIssue[] = []

  for (const field of NUMBER_FIELDS) {
    const rawValue = value[field.key]
    if (rawValue === undefined) continue
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || !Number.isInteger(rawValue)) {
      issues.push(issue(field.key, `${field.label}必须是数字`, 'field.number', { label: field.label }))
      continue
    }
    if (rawValue < field.min) {
      issues.push(issue(field.key, `${field.label}不能小于 ${field.min}`, 'field.min', { label: field.label, min: field.min }))
    }
    if (rawValue > field.max) {
      issues.push(issue(field.key, `${field.label}不能大于 ${field.max}`, 'field.max', { label: field.label, max: field.max }))
    }
  }

  if (value.profile !== undefined && (typeof value.profile !== 'string' || !PROFILES.includes(value.profile as WireProfile))) {
    issues.push(issue('profile', 'profile 不是允许的选项', 'field.option', { label: 'profile' }))
  }
  for (const key of ['enabled', 'readability', 'failOpen', 'pdf'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      issues.push(issue(key, `${key} 必须是布尔值`, 'field.boolean', { label: key }))
    }
  }

  validateLocale(value.locale, issues)

  const minArticleChars = readNumber(value.minArticleChars, DEFAULT_WIRE_HTTP_CONFIG.minArticleChars)
  const maxArticleChars = readNumber(value.maxArticleChars, DEFAULT_WIRE_HTTP_CONFIG.maxArticleChars)
  const maxBodyChars = readNumber(value.maxBodyChars, DEFAULT_WIRE_HTTP_CONFIG.maxBodyChars)
  if (maxArticleChars < minArticleChars) {
    issues.push(issue('maxArticleChars', '正文上限不能小于正文下限', 'wire.maxArticleBelowMin'))
  }
  if (maxBodyChars < minArticleChars) {
    issues.push(issue('maxBodyChars', '解码上限不能小于正文下限', 'wire.maxBodyBelowMin'))
  }
  if (maxArticleChars > maxBodyChars) {
    issues.push(issue('maxArticleChars', '正文上限不能大于解码上限', 'wire.maxArticleAboveBody'))
  }

  return result(issues)
}

function readProfile(raw: unknown): WireProfile {
  return typeof raw === 'string' && PROFILES.includes(raw as WireProfile)
    ? raw as WireProfile
    : DEFAULT_WIRE_HTTP_CONFIG.profile
}

function localeOrDefault(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function validateLocale(raw: unknown, issues: AdapterIssue[]): void {
  if (raw === undefined) return
  if (typeof raw !== 'string') {
    issues.push(issue('locale', 'locale 必须是字符串', 'field.string', { label: 'locale' }))
    return
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return
  if (trimmed.length > 64 || /[\r\n]/u.test(trimmed) || !LOCALE_PATTERN.test(trimmed)) {
    issues.push(issue('locale', 'locale 必须是 BCP 47 形式，例如 zh-CN', 'wire.locale'))
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
