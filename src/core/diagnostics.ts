/** Small in-memory diagnostic ring buffer; no secrets and no persistence. */

import type { DiagnosticEntry } from './types.ts'
import { errorCode, errorMessage } from '../shared/errors.ts'
import { redactText } from '../shared/redact.ts'
import { displayUrl } from '../shared/url.ts'

const MAX_ENTRIES = 50

export class Diagnostics {
  private readonly entries: DiagnosticEntry[] = []

  record(error: unknown, fallbackCode: string, subject?: string): DiagnosticEntry {
    const entry: DiagnosticEntry = {
      time: new Date().toISOString(),
      code: errorCode(error, fallbackCode),
      ...subject === undefined ? {} : { host: displayUrl(subject) },
      message: redactText(errorMessage(error)),
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    return entry
  }

  list(): DiagnosticEntry[] {
    return [...this.entries].reverse()
  }

  clear(): void {
    this.entries.length = 0
  }
}
