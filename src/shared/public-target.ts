/**
 * Public-target parsing and address validation shared by the Jina Reader
 * guard and the local wire-http egress guard.
 *
 * This module is host-only: it imports Node's DNS resolver and must never be
 * imported by the browser settings bundle.
 */

import { lookup as systemLookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { SearchToolsError } from './errors.ts'
import { displayUrl } from './url.ts'

export type PublicAddressResolver = (
  hostname: string,
  options: { all: true; order: 'verbatim' },
) => Promise<LookupAddress[]>

export interface PublicTargetCodes {
  invalid: string
  blocked: string
  unresolved: string
  label: string
}

export interface PublicTarget {
  url: URL
  addresses: LookupAddress[]
}

export const MAX_TARGET_URL_LENGTH = 2_048

const DEFAULT_CODES: PublicTargetCodes = {
  invalid: 'TARGET_INVALID',
  blocked: 'TARGET_BLOCKED',
  unresolved: 'TARGET_UNRESOLVED',
  label: 'target',
}

/**
 * Parse one absolute http(s) target. Credentials, non-http(s) schemes, and
 * over-long URLs are rejected before any DNS query.
 */
export function parseHttpTarget(
  raw: string,
  codes: PublicTargetCodes = DEFAULT_CODES,
  maxUrlLength = MAX_TARGET_URL_LENGTH,
): URL {
  if (raw.length > maxUrlLength) {
    throw new SearchToolsError(`${codes.label} URL exceeds ${maxUrlLength} characters`, codes.invalid)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new SearchToolsError(`${codes.label} URL is not a valid absolute URL`, codes.invalid, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SearchToolsError(`${codes.label} URL must use http or https`, codes.invalid)
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SearchToolsError(`credentials in ${codes.label} URLs are not allowed`, codes.invalid)
  }
  return url
}

/**
 * Resolve one hostname and require every answer to be public unicast. The
 * caller receives the validated addresses so it can pin the connection.
 */
export async function resolvePublicHost(
  hostname: string,
  signal: AbortSignal,
  resolver: PublicAddressResolver = systemLookup,
  codes: PublicTargetCodes = DEFAULT_CODES,
): Promise<LookupAddress[]> {
  if (signal.aborted) throw abortError(signal, codes)
  const host = stripIpv6Brackets(hostname)
  const literalFamily = isIP(host)
  let addresses: LookupAddress[]
  if (literalFamily !== 0) {
    addresses = [{ address: host, family: literalFamily }]
  } else {
    try {
      addresses = await raceWithSignal(resolver(host, { all: true, order: 'verbatim' }), signal, codes)
    } catch (error) {
      if (signal.aborted) throw abortError(signal, codes)
      throw new SearchToolsError(
        `${codes.label} hostname "${host}" could not be resolved`,
        codes.unresolved,
        { cause: error },
      )
    }
  }
  if (addresses.length === 0) {
    throw new SearchToolsError(`${codes.label} hostname "${host}" resolved to no addresses`, codes.unresolved)
  }
  for (const entry of addresses) {
    if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
      throw new SearchToolsError(`${codes.label} hostname "${host}" resolved to an invalid address`, codes.unresolved)
    }
    if (!isPublicIpAddress(entry.address)) {
      throw new SearchToolsError(
        `${codes.label} "${displayUrl(`http://${host}/`)}" resolves to a non-public address`,
        codes.blocked,
      )
    }
  }
  return addresses
}

/** Parse and resolve one target, returning both the URL and its pinned addresses. */
export async function resolvePublicTarget(
  raw: string,
  signal: AbortSignal,
  resolver: PublicAddressResolver = systemLookup,
  codes: PublicTargetCodes = DEFAULT_CODES,
): Promise<PublicTarget> {
  const url = parseHttpTarget(raw, codes)
  const addresses = await resolvePublicHost(url.hostname, signal, resolver, codes)
  return { url, addresses }
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

export function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isPrefix(bytes: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  codes: PublicTargetCodes,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal, codes))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => { finish(() => { reject(abortError(signal, codes)) }) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => { finish(() => { resolve(value) }) },
      error => { finish(() => { reject(error) }) },
    )
  })
}

function abortError(signal: AbortSignal, codes: PublicTargetCodes): SearchToolsError {
  return new SearchToolsError(`${codes.label} resolution aborted`, 'WEB_ABORTED', { cause: signal.reason })
}
