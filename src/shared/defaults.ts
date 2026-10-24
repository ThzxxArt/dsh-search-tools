/** Plain stored configuration shared by host, tests, and the settings page. */

import type { JsonObject } from '../core/types.ts'
import { DEFAULT_JINA_READER_CONFIG, type JinaReaderConfig } from '../fetch/adapters/jina-reader/schema.ts'
import { DEFAULT_READABLE_HTTP_CONFIG, type ReadableHttpConfig } from '../fetch/adapters/readable-http/schema.ts'
import { DEFAULT_WIRE_HTTP_CONFIG, type WireHttpConfig } from '../fetch/adapters/wire-http/schema.ts'
import { DEFAULT_LOCAL_DIRECT_CONFIG, type LocalDirectConfig } from '../search/adapters/local-direct/schema.ts'
import { DEFAULT_SEARXNG_CONFIG, type SearxngConfig } from '../search/adapters/searxng/schema.ts'

export interface SearchSection {
  adapter: string
  adapters: Record<string, JsonObject>
}

export interface FetchSection {
  adapter: string
  adapters: Record<string, JsonObject>
}

export interface ResearchConfig {
  enabled: boolean
  maxResults: number
  maxFetch: number
  defaultFetchTop: number
  maxCharsPerPage: number
  maxTotalChars: number
  concurrency: number
  timeoutMs: number
}

export interface ActivationConfig {
  previousSearchProvider: string
  previousFetchProvider: string
}

export interface StoredConfig {
  search: SearchSection
  fetch: FetchSection
  research: ResearchConfig
  activation: ActivationConfig
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  enabled: true,
  maxResults: 8,
  maxFetch: 8,
  defaultFetchTop: 3,
  maxCharsPerPage: 12_000,
  maxTotalChars: 40_000,
  concurrency: 3,
  timeoutMs: 120_000,
}

export const DEFAULT_ACTIVATION_CONFIG: ActivationConfig = {
  previousSearchProvider: '',
  previousFetchProvider: '',
}

export const DEFAULT_SEARCH_SECTION: SearchSection = {
  adapter: 'searxng',
  adapters: {
    searxng: DEFAULT_SEARXNG_CONFIG as unknown as JsonObject,
    'local-direct': DEFAULT_LOCAL_DIRECT_CONFIG as unknown as JsonObject,
  },
}

export const DEFAULT_FETCH_SECTION: FetchSection = {
  adapter: 'readable-http',
  adapters: {
    'readable-http': DEFAULT_READABLE_HTTP_CONFIG as unknown as JsonObject,
    'jina-reader': DEFAULT_JINA_READER_CONFIG as unknown as JsonObject,
    'wire-http': DEFAULT_WIRE_HTTP_CONFIG as unknown as JsonObject,
  },
}

export const DEFAULT_STORED_CONFIG: StoredConfig = {
  search: DEFAULT_SEARCH_SECTION,
  fetch: DEFAULT_FETCH_SECTION,
  research: DEFAULT_RESEARCH_CONFIG,
  activation: DEFAULT_ACTIVATION_CONFIG,
}

/** Built-in adapter config types, re-exported for adapter implementations. */
export type { JinaReaderConfig, LocalDirectConfig, ReadableHttpConfig, SearxngConfig, WireHttpConfig }
