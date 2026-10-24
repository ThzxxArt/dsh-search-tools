import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'wire-worker': 'src/fetch/adapters/wire-http/worker.ts',
    'local-direct-worker': 'src/search/adapters/local-direct/worker.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'lib',
  clean: true,
  sourcemap: true,
  dts: false,
  fixedExtension: false,
  deps: {
    neverBundle: true,
  },
})
