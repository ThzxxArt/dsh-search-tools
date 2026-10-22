/** Plugin Config schema and current-value snapshot. */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { JsonObject } from './core/types.ts'
import type {
  ActivationConfig, FetchSection, ResearchConfig, SearchSection, StoredConfig,
} from './shared/defaults.ts'
import {
  DEFAULT_ACTIVATION_CONFIG, DEFAULT_RESEARCH_CONFIG,
} from './shared/defaults.ts'

export interface Config {
  search: Volatile<SearchSection>
  fetch: Volatile<FetchSection>
  research: Volatile<ResearchConfig>
  activation: Volatile<ActivationConfig>
}

const AdaptersSchema = z.dict(z.any()).default({})

export const Config = z.object({
  search: z.object({
    adapter: z.string().default('searxng'),
    adapters: AdaptersSchema,
  }).volatile(),
  fetch: z.object({
    adapter: z.string().default('readable-http'),
    adapters: AdaptersSchema,
  }).volatile(),
  research: z.object({
    enabled: z.boolean().default(DEFAULT_RESEARCH_CONFIG.enabled),
    maxResults: z.number().step(1).min(1).max(20).default(DEFAULT_RESEARCH_CONFIG.maxResults),
    maxFetch: z.number().step(1).min(1).max(10).default(DEFAULT_RESEARCH_CONFIG.maxFetch),
    defaultFetchTop: z.number().step(1).min(0).max(10).default(DEFAULT_RESEARCH_CONFIG.defaultFetchTop),
    maxCharsPerPage: z.number().step(1).min(1_000).max(200_000).default(DEFAULT_RESEARCH_CONFIG.maxCharsPerPage),
    maxTotalChars: z.number().step(1).min(1_000).max(500_000).default(DEFAULT_RESEARCH_CONFIG.maxTotalChars),
    concurrency: z.number().step(1).min(1).max(8).default(DEFAULT_RESEARCH_CONFIG.concurrency),
    timeoutMs: z.number().step(1).min(5_000).max(600_000).default(DEFAULT_RESEARCH_CONFIG.timeoutMs),
  }).volatile(),
  activation: z.object({
    previousSearchProvider: z.string().default(DEFAULT_ACTIVATION_CONFIG.previousSearchProvider),
    previousFetchProvider: z.string().default(DEFAULT_ACTIVATION_CONFIG.previousFetchProvider),
  }).volatile(),
}) as unknown as z<any>

/** Take one plain snapshot at the start of an operation. */
export function snapshot(config: Config): StoredConfig {
  // Schemastery owns the resolved shape; adapters validate their own
  // sub-objects. The local cast avoids an excessively deep generic expansion
  // through the open adapter dictionary.
  const current = config as unknown as {
    search: { get(): SearchSection }
    fetch: { get(): FetchSection }
    research: { get(): ResearchConfig }
    activation: { get(): ActivationConfig }
  }
  return {
    search: current.search.get(),
    fetch: current.fetch.get(),
    research: current.research.get(),
    activation: current.activation.get(),
  }
}

/** Read one adapter's stored object. The adapter owns defaults and validation. */
export function adapterConfig(section: { adapter: string; adapters: Record<string, JsonObject> }, adapterId: string): JsonObject {
  return section.adapters[adapterId] ?? {}
}
