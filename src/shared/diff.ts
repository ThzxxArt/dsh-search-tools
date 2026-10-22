/** Section-level diffing for the settings page's save path. Browser-safe. */

import type { JsonObject, JsonValue } from '../core/types.ts'
import type { StoredConfig } from './defaults.ts'

export type ConfigSection = keyof StoredConfig

export type PathOp =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }

const SECTIONS: readonly ConfigSection[] = ['search', 'fetch', 'research', 'activation']

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => deepEqual(entry, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
  }
  return false
}

/** Merge known current values under a draft, preserving keys this page version does not know. */
export function mergeUnknown(current: unknown, draft: unknown): JsonValue {
  if (isRecord(current) && isRecord(draft)) {
    const merged: JsonObject = { ...current as JsonObject }
    for (const [key, value] of Object.entries(draft)) {
      merged[key] = mergeUnknown(current[key], value)
    }
    return merged
  }
  return draft as JsonValue
}

/**
 * Produce one atomic batch: a section equal to its inherited base is unset, a
 * changed section is set with unknown keys preserved.
 */
export function diffSections(
  draft: StoredConfig,
  current: StoredConfig,
  base: StoredConfig,
  sections: readonly ConfigSection[] = SECTIONS,
): PathOp[] {
  const ops: PathOp[] = []
  for (const section of sections) {
    const next = draft[section]
    const previous = current[section]
    const inherited = base[section]
    if (deepEqual(next, inherited)) {
      ops.push({ op: 'unset', path: [section] })
      continue
    }
    if (deepEqual(next, previous)) continue
    ops.push({ op: 'set', path: [section], value: mergeUnknown(previous, next) })
  }
  return ops
}

/** Normalise an unknown config value to the sections the page edits. */
export function asStoredConfig(value: unknown): Partial<StoredConfig> {
  return isRecord(value) ? value as Partial<StoredConfig> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
