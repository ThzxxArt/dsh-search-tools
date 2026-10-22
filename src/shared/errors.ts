/** Host-side error type carrying a machine-routable code through DSH's WebError. */

import { WebError } from '@deepseek-ai/dsh-web'
import { displayUrl } from './url.ts'

export class SearchToolsError extends WebError {
  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, code, options)
    this.name = 'SearchToolsError'
  }
}

/** Human-safe message for logs and the settings page. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Error code without leaking a stack or secret. */
export function errorCode(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return fallback
}

/** Redact a URL before putting it in diagnostics. */
export function diagnosticUrl(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : displayUrl(raw)
}
