# Third-party notices

This package is MIT-licensed. It depends on:

- `@mozilla/readability` — Apache-2.0
- `linkedom` — MIT
- `cheerio` — MIT
- `lru-cache` — ISC
- `normalize-url` — MIT
- `turndown` — MIT
- `@joplin/turndown-plugin-gfm` — MIT
- `undici` — MIT
- `ipaddr.js` — MIT
- `impit` — Apache-2.0; the npm package includes one platform-specific
  precompiled N-API binary from its optional dependencies (Linux, macOS,
  Windows; x64/arm64). No postinstall script is used.
- `pdfjs-dist` — Apache-2.0; used only for local PDF text extraction. Its
  optional `@napi-rs/canvas` dependency may be installed by the package manager
  for PDF rendering support, but this plugin only uses the text API.

`jina-reader` is an optional adapter that calls a user-configured Jina
Reader-compatible service. Jina Reader code is not bundled with this package;
the hosted service and the open-source Reader have their own terms and licenses.

`wire-http` runs `impit` inside this package. It does not bundle a browser, a
Reader, a rendering engine, or Jina code. The `impit` native binary and
`pdfjs-dist` remain governed by their own licenses; see the packages' LICENSE
files for the authoritative text.

DSH packages (`@deepseek-ai/*`) are peer dependencies supplied by the host
installation; their licenses are those of DeepSeek Harness.
