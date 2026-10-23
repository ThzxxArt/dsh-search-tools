/** Same-origin calls to the host routes; `document.baseURI` respects --public-url. */

import type {
  AdapterListResponse, AdapterManifest, JsonObject, ProbeResult, StatusResponse,
} from '../core/types.ts'

export interface SearchPreviewResult {
  ok: boolean
  sources?: Array<{ url: string; title?: string; snippet?: string }>
  content?: string
  truncated?: boolean
  notes?: string[]
  code?: string
  message?: string
  elapsedMs?: number
}

export interface FetchPreviewResult {
  ok: boolean
  url?: string
  statusCode?: number
  kind?: 'html' | 'text'
  content?: string
  chars?: number
  truncated?: boolean
  code?: string
  message?: string
  elapsedMs?: number
}

function endpoint(path: string): string {
  return new URL(`api/dsh-search-tools/${path}`, document.baseURI).toString()
}

export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  return await getJson<StatusResponse>('status', signal)
}

export async function fetchAdapters(signal?: AbortSignal): Promise<AdapterListResponse> {
  return await getJson<AdapterListResponse>('adapters', signal)
}

export async function probeSearch(adapter: string, config: JsonObject, signal?: AbortSignal): Promise<ProbeResult> {
  return await postJson<ProbeResult>('probe', { kind: 'search', adapter, config }, signal)
}

export async function previewSearch(adapter: string, query: string, config: JsonObject, signal?: AbortSignal): Promise<SearchPreviewResult> {
  return await postJson<SearchPreviewResult>('search-preview', { adapter, query, config }, signal)
}

export async function previewFetch(adapter: string, url: string, config: JsonObject, signal?: AbortSignal): Promise<FetchPreviewResult> {
  return await postJson<FetchPreviewResult>('fetch-preview', { adapter, url, config }, signal)
}

export async function clearCache(): Promise<{ ok: boolean }> {
  return await postJson<{ ok: boolean }>('cache/clear', {}, undefined)
}

export async function clearDiagnostics(): Promise<{ ok: boolean }> {
  return await postJson<{ ok: boolean }>('diagnostics/clear', {}, undefined)
}

/** Stable default adapter manifest lookup. */
export function findManifest(list: readonly AdapterManifest[], id: string): AdapterManifest | undefined {
  return list.find(manifest => manifest.id === id)
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint(path), {
    method: 'GET',
    credentials: 'same-origin',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json() as T
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json() as T
}
