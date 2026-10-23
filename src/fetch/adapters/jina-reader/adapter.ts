import type { FetchAdapter } from '../../../core/host-types.ts'
import { jinaReaderManifest } from './manifest.ts'
import { JinaReaderRuntime } from './provider.ts'
import { validateJinaReaderConfig } from './schema.ts'

export const jinaReaderAdapter: FetchAdapter = {
  manifest: jinaReaderManifest,
  validate: validateJinaReaderConfig,
  create(ctx, getConfig) {
    return new JinaReaderRuntime(ctx, getConfig)
  },
  async probe(ctx, config, url, signal) {
    return await new JinaReaderRuntime(ctx, () => config).probe(url, signal)
  },
}
