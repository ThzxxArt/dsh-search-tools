/** Dot-path helpers used by adapter manifests and the generic settings form. */

import type { JsonObject, JsonValue } from '../core/types.ts'

export function pathOf(key: string): string[] {
  return key.split('.').filter(Boolean)
}

export function getPath(value: unknown, key: string): unknown {
  let current: unknown = value
  for (const segment of pathOf(key)) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Return a copy with one dot-path set; intermediate plain objects are created. */
export function setPath(source: JsonObject, key: string, next: JsonValue): JsonObject {
  const segments = pathOf(key)
  if (segments.length === 0) return source
  const clone = structuredClone(source)
  let cursor: Record<string, JsonValue> = clone
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index] as string
    const child = cursor[segment]
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, JsonValue>
  }
  cursor[segments[segments.length - 1] as string] = next
  return clone
}
