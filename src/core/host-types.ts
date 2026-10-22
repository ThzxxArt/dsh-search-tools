/**
 * Host-only adapter contracts. Never import this module from `src/client`.
 */
import type {
  AdapterManifest, AdapterValidation, FetchAdapterRuntime, JsonObject,
  ProbeResult, SearchAdapterRuntime,
} from './types.ts'

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface AdapterLogger {
  debug(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface CredentialLookup {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

/** Host services an adapter may use without importing Cordis or DSH. */
export interface AdapterContext {
  logger: AdapterLogger
  credentials?: CredentialLookup
  env: Record<string, string | undefined>
  fetch: FetchLike
  now: () => number
}

export interface SearchAdapter {
  readonly manifest: AdapterManifest
  validate(config: unknown): AdapterValidation
  create(ctx: AdapterContext, getConfig: () => JsonObject): SearchAdapterRuntime
  probe?(ctx: AdapterContext, config: JsonObject, signal: AbortSignal): Promise<ProbeResult>
}

export interface FetchAdapter {
  readonly manifest: AdapterManifest
  validate(config: unknown): AdapterValidation
  create(ctx: AdapterContext, getConfig: () => JsonObject): FetchAdapterRuntime
  probe?(ctx: AdapterContext, config: JsonObject, url: string, signal: AbortSignal): Promise<ProbeResult>
}
