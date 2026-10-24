/** Redact URLs and secret-looking values from user-visible diagnostics. */

import { displayUrl } from './url.ts'

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/giu
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu
const SECRET_PATTERN = /\b(authorization|proxy-authorization|token|api[_-]?key|password|secret)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/giu

/**
 * Keep diagnostics useful without copying a full query, URL credentials, or
 * bearer token into the UI. This is deliberately text-level: errors from
 * native fetch/native workers have no structured field to sanitize.
 */
export function redactText(value: string, maxChars = 500): string {
  let text = value
    .replace(URL_PATTERN, raw => displayUrl(raw))
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(SECRET_PATTERN, (_match, key: string) => `${key}=[redacted]`)
  if (text.length > maxChars) text = text.slice(0, maxChars)
  return text
}
