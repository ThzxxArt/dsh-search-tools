import type { SearchAdapter } from '../../../core/host-types.ts'
import { SearxngRuntime, probeSearxng } from './client.ts'
import { searxngManifest } from './manifest.ts'
import { validateSearxngConfig } from './schema.ts'

export const searxngAdapter: SearchAdapter = {
  manifest: searxngManifest,
  validate: validateSearxngConfig,
  create(ctx, getConfig) {
    return new SearxngRuntime(ctx, getConfig)
  },
  probe(ctx, config, signal) {
    return probeSearxng(ctx, config, signal)
  },
}
