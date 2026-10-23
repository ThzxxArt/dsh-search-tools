/**
 * Best-effort public-target guard for the Jina Reader adapter.
 *
 * The Reader service resolves and fetches the target itself, so this module
 * cannot pin the connection the way DSH's local HTTP provider does. It still
 * rejects obvious private/loopback/link-local targets before their URL leaves
 * this machine, and it documents the remaining DNS-rebinding risk honestly.
 *
 * The address classifier lives in `shared/public-target.ts` so the local
 * wire-http egress guard uses exactly the same public-address policy.
 */

import type { PublicAddressResolver, PublicTargetCodes } from '../../../shared/public-target.ts'
import {
  isPublicIpAddress,
  resolvePublicTarget,
} from '../../../shared/public-target.ts'

export type JinaAddressResolver = PublicAddressResolver

const JINA_CODES: PublicTargetCodes = {
  invalid: 'JINA_INVALID_TARGET',
  blocked: 'JINA_TARGET_BLOCKED',
  unresolved: 'JINA_TARGET_UNRESOLVED',
  label: 'target',
}

/**
 * Parse and resolve one Jina target. DNS is resolved once for this check; the
 * Reader may resolve again, so this is a guard, not a pin.
 */
export async function resolveJinaTarget(
  raw: string,
  signal: AbortSignal,
  resolver?: JinaAddressResolver,
): Promise<URL> {
  const { url } = await resolvePublicTarget(raw, signal, resolver, JINA_CODES)
  return url
}

export { isPublicIpAddress }
