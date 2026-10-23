/**
 * Best-effort public-target guard for the Jina Reader adapter.
 *
 * The Reader service resolves and fetches the target itself, so this module
 * cannot pin the connection the way DSH's local HTTP provider does. It still
 * rejects obvious private/loopback/link-local targets before their URL leaves
 * this machine, and it documents the remaining DNS-rebinding risk honestly.
 */

import { lookup as systemLookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { SearchToolsError } from '../../../shared/errors.ts'
import { displayUrl } from '../../../shared/url.ts'

export type JinaAddressResolver = (
  hostname: string,
  options: { all: true; order: 'verbatim' },
) => Promise<LookupAddress[]>

const MAX_TARGET_URL_LENGTH = 2_048

/**
 * Parse and resolve one target URL, rejecting the complete address set when any
 * answer is non-public. DNS is resolved once for this check; the Reader may
 * resolve again, so this is a guard, not a pin.
 */
export async function resolveJinaTarget(
  raw: string,
  signal: AbortSignal,
  resolver: JinaAddressResolver = systemLookup,
): Promise<URL> {
  if (raw.length > MAX_TARGET_URL_LENGTH) {
    throw new SearchToolsError(`target URL exceeds ${MAX_TARGET_URL_LENGTH} characters`, 'JINA_INVALID_TARGET')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new SearchToolsError('target URL is not a valid absolute URL', 'JINA_INVALID_TARGET', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SearchToolsError('target URL must use http or https', 'JINA_INVALID_TARGET')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SearchToolsError('credentials in target URLs are not allowed', 'JINA_INVALID_TARGET')
  }
  if (signal.aborted) throw abortError(signal)

  const hostname = stripIpv6Brackets(url.hostname)
  const literalFamily = isIP(hostname)
  let addresses: LookupAddress[]
  if (literalFamily !== 0) {
    addresses = [{ address: hostname, family: literalFamily }]
  } else {
    try {
      addresses = await raceWithSignal(resolver(hostname, { all: true, order: 'verbatim' }), signal)
    } catch (error) {
      if (signal.aborted) throw abortError(signal)
      throw new SearchToolsError(
        `target hostname "${hostname}" could not be resolved`,
        'JINA_TARGET_UNRESOLVED',
        { cause: error },
      )
    }
  }
  if (addresses.length === 0) {
    throw new SearchToolsError(`target hostname "${hostname}" resolved to no addresses`, 'JINA_TARGET_UNRESOLVED')
  }
  for (const entry of addresses) {
    if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
      throw new SearchToolsError(`target hostname "${hostname}" resolved to an invalid address`, 'JINA_TARGET_UNRESOLVED')
    }
    if (!isPublicIpAddress(entry.address)) {
      throw new SearchToolsError(
        `target "${displayUrl(url.toString())}" resolves to a non-public address`,
        'JINA_TARGET_BLOCKED',
      )
    }
  }
  return url
}

/** Public unicast check with IPv4-mapped, IPv4-compatible, and NAT64/transition handling. */
export function isPublicIpAddress(input: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.parse(stripIpv6Brackets(input))
  } catch {
    return false
  }
  if (parsed instanceof ipaddr.IPv4) return parsed.range() === 'unicast'
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === 'unicast'
  const bytes = parsed.toByteArray()
  // Deprecated IPv4-compatible ::/96 is still treated as unicast by some
  // resolvers/runtimes. Reject it together with unspecified/loopback so a
  // private IPv4 destination cannot hide behind an IPv6-compatible literal.
  if (bytes.slice(0, 12).every(byte => byte === 0)) return false
  if (isPrefix(bytes, [0x20, 0x02])) return false // 6to4 can embed an arbitrary IPv4 destination.
  if (isPrefix(bytes, [0x20, 0x01, 0x00, 0x00])) return false // Teredo.
  if (isPrefix(bytes, [0x00, 0x64, 0xff, 0x9b])) {
    if (isPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01])) return false // local-use NAT64.
    // 64:ff9b::/96 embeds the destination in the last four bytes.
    if (bytes.slice(4, 12).every(byte => byte === 0)) {
      return ipaddr.fromByteArray(bytes.slice(12)).range() === 'unicast'
    }
    return false
  }
  return parsed.range() === 'unicast'
}

function isPrefix(bytes: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => { finish(() => { reject(abortError(signal)) }) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => { finish(() => { resolve(value) }) },
      error => { finish(() => { reject(error) }) },
    )
  })
}

function abortError(signal: AbortSignal): SearchToolsError {
  return new SearchToolsError('Jina target resolution aborted', 'WEB_ABORTED', { cause: signal.reason })
}
