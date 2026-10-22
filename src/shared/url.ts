/** URL normalisation and domain filters shared by host and page. */

const TRACKING_PARAMS = new Set([
  'gclid', 'fbclid', 'dclid', 'msclkid', 'yclid', 'mc_cid', 'mc_eid',
])

/** Whether a string is a syntactically valid http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Normalise a SearXNG base URL: trim, require http(s), reject embedded
 * credentials, drop query/hash, drop a trailing `/search` segment, and remove
 * trailing slashes.
 */
export function normalizeInstanceUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('实例地址不能为空')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('实例地址必须是 http(s) 绝对 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('实例地址必须是 http(s) 绝对 URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('实例地址不能包含用户名或密码')
  }
  url.search = ''
  url.hash = ''
  let pathname = url.pathname.replace(/\/+$/u, '')
  if (pathname.endsWith('/search')) pathname = pathname.slice(0, -'/search'.length)
  url.pathname = pathname.length === 0 ? '/' : pathname
  return url.toString().replace(/\/$/u, '')
}

/** Normalise a result URL for deduplication: drop hash and common tracking params. */
export function normalizeResultUrl(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase()
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key)
  }
  url.hostname = url.hostname.toLowerCase()
  return url.toString()
}

/** Hostname of a URL, or undefined for malformed input. */
export function hostOf(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** Suffix-aware domain match: `example.com` matches `www.example.com`. */
export function domainMatches(host: string, pattern: string): boolean {
  const normalizedHost = host.toLowerCase().replace(/^\./u, '')
  const normalizedPattern = pattern.toLowerCase().replace(/^\./u, '').replace(/\/$/u, '')
  return normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`)
}

/** Redact query strings and credentials from a URL for logs and diagnostics. */
export function displayUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return raw.replace(/\?.*$/u, '').replace(/\/\/[^/@]+@/u, '//')
  }
}
