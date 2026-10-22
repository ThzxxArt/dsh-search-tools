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
  userAgent: 'dsh-search-tools/0.1.0 (+https://github.com/ThzxxArt/dsh-search-tools)',
  failOpen: true,
}

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
  if (maxArticleChars < minArticleChars) issues.push(issue('maxArticleChars', '正文上限不能小于正文下限'))
  if (maxBodyChars < minArticleChars) issues.push(issue('maxBodyChars', '解码上限不能小于正文下限'))
  if (readNumber(value.timeoutMs, 20_000) < 1_000) issues.push(issue('timeoutMs', '超时不能小于 1000ms'))
  if (readNumber(value.maxResponseBytes, 5_000_000) < 1_024) issues.push(issue('maxResponseBytes', '响应上限不能小于 1024 字节'))
  const userAgent = readString(value.userAgent, '').trim()
  if (userAgent.length === 0 || /[\r\n]/u.test(userAgent)) issues.push(issue('userAgent', 'User-Agent 不能为空或包含换行'))
  return result(issues)
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
