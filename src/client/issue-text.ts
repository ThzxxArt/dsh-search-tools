/** Resolve an adapter issue through the active locale, falling back to its English message. */

import type { AdapterIssue } from '../core/types.ts'
import type { Translate } from './components/Field.tsx'

export function issueText(issue: AdapterIssue, t: Translate): string {
  if (issue.code !== undefined) {
    const translated = t(issue.code, issue.params)
    if (translated !== issue.code && translated.length > 0) return translated
  }
  return issue.message
}
