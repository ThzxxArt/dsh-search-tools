import { defineConfig } from 'tsdown'

/**
 * Third-party client bundle. DSH's own `clientBundle` preset is not published,
 * so this file reproduces its contract: CJS factory + banner/footer + platform
 * externals. Keep every runtime import outside this list bundled.
 */
export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  outDir: 'lib',
  clean: false,
  sourcemap: true,
  dts: false,
  deps: {
    neverBundle: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-slots',
    ],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-search-tools", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
