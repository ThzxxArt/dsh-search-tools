import type { SearchAdapter } from '../../../core/host-types.ts'
import { localDirectManifest } from './manifest.ts'
import { LocalDirectRuntime } from './provider.ts'
import { validateLocalDirectConfig } from './schema.ts'

export const localDirectAdapter: SearchAdapter = {
  manifest: localDirectManifest,
  validate: validateLocalDirectConfig,
  create(ctx, getConfig) {
    return new LocalDirectRuntime(ctx, getConfig)
  },
  probe(ctx, config, signal) {
    return new LocalDirectRuntime(ctx, () => config).probe(signal)
  },
}
