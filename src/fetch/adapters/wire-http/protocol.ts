/** Structured messages exchanged with the one-request wire worker. */

import type { WireProfile } from './schema.ts'

export interface WireWorkerRequest {
  url: string
  profile: WireProfile
  timeoutMs: number
  maxRedirects: number
  maxResponseBytes: number
  proxyUrl: string
  locale: string
}

export interface WireWorkerResult {
  url: string
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

export interface WireWorkerFailure {
  code: string
  message: string
}

export type WireWorkerReply =
  | { ok: true; result: WireWorkerResult }
  | { ok: false; error: WireWorkerFailure }
