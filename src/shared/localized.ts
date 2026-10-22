/** Tiny helper for adapter manifests that ship English + Chinese copy. */

import type { LocalizedText } from '../core/types.ts'

/** Build a localized label; English is the required fallback. */
export function lt(en: string, zh: string): LocalizedText {
  return { en, zh }
}
