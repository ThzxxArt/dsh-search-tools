/**
 * Browser-safe vocabulary shared by the host plugin, the Web settings page,
 * and adapter authors. This module must not import Node.js, Cordis, or DSH
 * runtime packages: the settings page bundles it.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/**
 * User-facing text that an adapter can ship in more than one language.
 * Mirrors DSH's package-manifest `LocalizedText`: English is the required
 * fallback, every other key is a lowercase locale id.
 */
export type LocalizedText = string | { readonly en: string; readonly [locale: string]: string }

/** A search source in the portable shape DSH's `ctx.web` consumes. */
export interface SearchSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export interface SearchRequest {
  query: string
  maxResults?: number
}

export interface SearchResult {
  content?: string
  sources: readonly SearchSource[]
  truncated: boolean
  /** Adapter diagnostics (for example unresponsive SearXNG engines) shown in the settings preview. */
  notes?: readonly string[]
}

export interface FetchRequest {
  url: string
}

export type FetchBody =
  | { kind: 'html'; content: string }
  | { kind: 'text'; content: string }

export interface FetchResult {
  url: string
  statusCode: number
  body: FetchBody
  truncated: boolean
}

/** Normalised probe outcome for the settings page. */
export interface ProbeResult {
  ok: boolean
  code?: string
  message?: string
  latencyMs: number
  version?: string
  json?: boolean
  html?: boolean
  engines?: string[]
  categories?: string[]
  /** Fetch probe details: HTTP status and decoded body kind. */
  statusCode?: number
  contentType?: 'html' | 'text'
  readable?: boolean
}

export interface CacheStats {
  size: number
  hits: number
  misses: number
}

export interface DiagnosticEntry {
  time: string
  code: string
  host?: string
  message: string
}

/** One form field declared by an adapter. The settings page renders it generically. */
export type AdapterField = TextField | NumberField | BooleanField | SelectField | TagsField | CheckboxesField | InstancesField

export interface FieldBase {
  key: string
  label: LocalizedText
  description?: LocalizedText
  required?: boolean
  /** Group id declared by `AdapterManifest.groups`; unknown ids fall back visibly. */
  group?: string
  /** Hide a field behind the page's advanced disclosure when it has no advanced group. */
  advanced?: boolean
  /** Short unit shown inside the control, for example `ms`, `chars`, or `bytes`. */
  unit?: string
}

export interface TextField extends FieldBase {
  kind: 'text' | 'url' | 'password'
  placeholder?: string
  default?: string
  /** Credential reference written through DSH credentials instead of YAML. */
  secretRef?: string
}

export interface NumberField extends FieldBase {
  kind: 'number'
  default?: number
  min?: number
  max?: number
  step?: number
}

export interface BooleanField extends FieldBase {
  kind: 'boolean'
  default?: boolean
}

export interface SelectField extends FieldBase {
  kind: 'select'
  default?: string
  options: readonly { value: string; label: LocalizedText }[]
}

export interface TagsField extends FieldBase {
  kind: 'tags'
  default?: string[]
  placeholder?: string
}

/** A fixed-choice multi-select, rendered as native checkboxes. */
export interface CheckboxesField extends FieldBase {
  kind: 'checkboxes'
  default?: string[]
  options: readonly { value: string; label: LocalizedText }[]
}

/** A list of `{ url, label, enabled }` instances, rendered by the instance editor. */
export interface InstancesField extends FieldBase {
  kind: 'instances'
}

export type AdapterCapability = 'json' | 'html' | 'probe' | 'cache' | 'pagination' | 'readability' | 'browser' | 'pdf'

/** One labeled block of adapter fields; `advanced` blocks start collapsed. */
export interface AdapterGroup {
  id: string
  label: LocalizedText
  description?: LocalizedText
  advanced?: boolean
}

/** Everything the settings page needs to render and validate an adapter. */
export interface AdapterManifest {
  kind: 'search' | 'fetch'
  id: string
  label: LocalizedText
  description: LocalizedText
  /**
   * Optional data-boundary / service warning rendered above the adapter form.
   * Kept in the manifest so every adapter can carry its own notice without a
   * page-specific component.
   */
  notice?: LocalizedText
  /** Optional field grouping; a manifest without groups renders one Configuration block. */
  groups?: readonly AdapterGroup[]
  fields: readonly AdapterField[]
  defaults: JsonObject
  capabilities?: readonly AdapterCapability[]
  /** Secret fields this adapter resolves; the page renders them as write-only. */
  secretRefs?: readonly {
    key: string
    ref: string
    label: LocalizedText
    description?: LocalizedText
    authType?: 'bearer' | 'basic'
    group?: string
    advanced?: boolean
  }[]
}

export interface AdapterIssue {
  path: string
  message: string
  /** Stable message key for UI localization; `message` stays a readable fallback. */
  code?: string
  params?: Record<string, string | number>
}

export interface AdapterValidation {
  ok: boolean
  issues: readonly AdapterIssue[]
}

/** Runtime contract for one search backend. */
export interface SearchAdapterRuntime {
  available(): boolean
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>
  probe?(signal?: AbortSignal): Promise<ProbeResult>
  clearCache?(): void
  cacheStats?(): CacheStats
}

/** Runtime contract for one fetch backend. */
export interface FetchAdapterRuntime {
  available(): boolean
  fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult>
  probe?(url: string, signal?: AbortSignal): Promise<ProbeResult>
}

export interface AdapterListResponse {
  search: AdapterManifest[]
  fetch: AdapterManifest[]
}

export interface StatusResponse {
  version: string
  configPath: string | null
  search: {
    enabled: boolean
    registered: boolean
    available: boolean
    adapter: string
    /** Enabled instances/sources for the current search adapter. */
    instances: number
    /** Adapter-neutral source count: engines for local-direct, instances for SearXNG. */
    sources?: number
  }
  fetch: {
    enabled: boolean
    registered: boolean
    available: boolean
    adapter: string
  }
  research: {
    enabled: boolean
    registered: boolean
  }
  credentials: Record<string, { configured: boolean; source?: string; writable: boolean }>
  cache: CacheStats
  lastErrors: DiagnosticEntry[]
}
