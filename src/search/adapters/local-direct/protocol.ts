/** Structured messages exchanged with the one-shot local-direct worker. */

import type { LocalDirectEngine, LocalDirectProfile } from './schema.ts'

export interface LocalDirectTarget {
  engine: LocalDirectEngine
  url: string
}

export interface LocalDirectWorkerRequest {
  targets: readonly LocalDirectTarget[]
  profile: LocalDirectProfile
  timeoutMs: number
  maxResponseBytes: number
  proxyUrl: string
  locale: string
}

export interface LocalDirectTargetResult {
  engine: LocalDirectEngine
  ok: boolean
  status?: number
  url?: string
  headers?: Record<string, string>
  body?: Uint8Array
  code?: string
  message?: string
}

export interface LocalDirectWorkerResult {
  targets: LocalDirectTargetResult[]
}

export interface LocalDirectWorkerFailure {
  code: string
  message: string
}

export type LocalDirectWorkerReply =
  | { ok: true; result: LocalDirectWorkerResult }
  | { ok: false; error: LocalDirectWorkerFailure }
