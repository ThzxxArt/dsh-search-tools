/** Pure adapter/config helpers shared by the page and its tab components. */

import type { AdapterIssue, AdapterManifest, JsonObject } from '../core/types.ts'
import { getPath } from '../shared/path.ts'
import { isRecord, validateManifestConfig } from '../shared/validation.ts'
import { validateSearxngConfig } from '../search/adapters/searxng/schema.ts'
import { validateJinaReaderConfig } from '../fetch/adapters/jina-reader/schema.ts'
import { validateReadableHttpConfig } from '../fetch/adapters/readable-http/schema.ts'

const BUILTIN_VALIDATORS: Readonly<Record<string, (config: unknown) => { issues: readonly AdapterIssue[] }>> = {
  'search:searxng': validateSearxngConfig,
  'fetch:readable-http': validateReadableHttpConfig,
  'fetch:jina-reader': validateJinaReaderConfig,
}

export function adapterState(manifest: AdapterManifest, config: JsonObject | undefined): 'ready' | 'attention' | 'setup' {
  if (config === undefined) return 'setup'
  const instances = manifest.fields.find(field => field.kind === 'instances')
  if (instances !== undefined) {
    if (!hasEnabledInstances(getPath(config, instances.key))) return 'setup'
  } else if (!hasMeaningfulConfig(manifest, config)) {
    return 'setup'
  }
  return validateAdapterConfig(manifest, config).length > 0 ? 'attention' : 'ready'
}

export function hasMeaningfulConfig(manifest: AdapterManifest, config: JsonObject): boolean {
  return manifest.fields
    .filter(field => field.kind !== 'boolean' && field.kind !== 'instances')
    .some((field) => {
      const value = getPath(config, field.key)
      if (typeof value === 'string') return value.trim().length > 0
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null
    })
}

export function validateAdapterConfig(manifest: AdapterManifest, config: JsonObject): readonly AdapterIssue[] {
  const validator = BUILTIN_VALIDATORS[`${manifest.kind}:${manifest.id}`]
  return validator === undefined ? validateManifestConfig(manifest, config).issues : validator(config).issues
}

export function findManifest(list: readonly AdapterManifest[], id: string): AdapterManifest | undefined {
  return list.find(manifest => manifest.id === id)
}

export function adapterConfig(
  section: { adapter: string; adapters: Record<string, JsonObject> },
  id: string,
): JsonObject {
  return section.adapters[id] ?? {}
}

export function hasEnabledInstances(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some(entry => isRecord(entry)
    && entry.enabled !== false
    && typeof entry.url === 'string'
    && entry.url.trim().length > 0)
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
