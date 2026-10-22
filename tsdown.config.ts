import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
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
