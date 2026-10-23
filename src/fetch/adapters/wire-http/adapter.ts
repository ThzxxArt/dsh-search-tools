import type { FetchAdapter } from '../../../core/host-types.ts'
import { wireHttpManifest } from './manifest.ts'
import { WireHttpRuntime } from './provider.ts'
import { validateWireHttpConfig } from './schema.ts'

export const wireHttpAdapter: FetchAdapter = {
  manifest: wireHttpManifest,
  validate: validateWireHttpConfig,
  create(ctx, getConfig) {
    return new WireHttpRuntime(ctx, getConfig)
  },
  async probe(ctx, config, url, signal) {
    return await new WireHttpRuntime(ctx, () => config).probe(url, signal)
  },
}
