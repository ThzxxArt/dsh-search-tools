import type { FetchAdapter } from '../../../core/host-types.ts'
import { readableHttpManifest } from './manifest.ts'
import { ReadableHttpRuntime } from './provider.ts'
import { validateReadableHttpConfig } from './schema.ts'

export const readableHttpAdapter: FetchAdapter = {
  manifest: readableHttpManifest,
  validate: validateReadableHttpConfig,
  create(ctx, getConfig) {
    return new ReadableHttpRuntime(ctx, getConfig)
  },
  async probe(ctx, config, url, signal) {
    return await new ReadableHttpRuntime(ctx, () => config).probe(url, signal)
  },
}
