/** Plain-text diagnostics for a bug report. Never includes credential values. */

import type { StatusResponse } from '../core/types.ts'

export function formatDiagnostics(status: StatusResponse): string {
  const credentials = Object.entries(status.credentials)
    .map(([ref, info]) => `${ref}=${info.configured ? 'configured' : 'unset'}${info.writable ? '' : ' (read-only)'}`)
    .join(', ')
  const sources = status.search.sources ?? status.search.instances
  const lines = [
    `dsh-search-tools ${status.version}`,
    `config: ${status.configPath ?? 'unknown'}`,
    `search: adapter=${status.search.adapter} available=${String(status.search.available)} registered=${String(status.search.registered)} instances=${status.search.instances} sources=${sources}`,
    `fetch: adapter=${status.fetch.adapter} available=${String(status.fetch.available)} registered=${String(status.fetch.registered)}`,
    `research: enabled=${String(status.research.enabled)} registered=${String(status.research.registered)}`,
    `credentials: ${credentials.length > 0 ? credentials : 'none'}`,
    `cache: size=${status.cache.size} hits=${status.cache.hits} misses=${status.cache.misses}`,
    'errors:',
  ]
  if (status.lastErrors.length === 0) lines.push('- none')
  for (const error of status.lastErrors) {
    const host = error.host === undefined ? '' : ` ${error.host}`
    lines.push(`- ${error.time} ${error.code}${host}: ${error.message}`)
  }
  return lines.join('\n')
}
