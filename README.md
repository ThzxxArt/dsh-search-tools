# dsh-search-tools

Adapter-first web search and readable page fetching for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> **Status: v0.1.0 in progress, M0 verified.** The host and client bundles build,
> Settings → Search Tools appears in the real Web GUI, Save writes YAML,
> authenticated routes work, search/fetch takeover and restore work, and
> credentials stay out of YAML. The settings page has inline search/fetch tests
> with structured results, diagnostics copy/clear, and keyboard save; the
> activation hint and zero-instance empty state have had a visual pass. A real
> model (via an OpenAI-compatible gateway) called `web_research`, built-in
> `web_search`, and built-in `web_fetch`; search used a real SearXNG instance and
> the research card rendered. The provider key stayed in the process environment.
> Remaining work is product polish such as the provider picker and research-prompt
> preview. See `docs/m0-verification.md`.

## What it does

- Exposes **stable** DSH providers `dsh-search-tools` (search) and
  `dsh-search-tools-fetch` (fetch). The provider ids never change when a backend
  is added or swapped.
- Ships **SearXNG** as the first search adapter and **Readability HTTP** as the
  first fetch adapter.
- Adds a `web_research` tool that searches, fetches the top N pages, and returns
  readable content in one call.
- Registers **Settings → Search Tools** in the Web GUI. Configuration is edited
  there, never by hand.
- Search and Fetch tabs include inline test panels with structured sources and
  fetch previews; Advanced can copy or clear diagnostics.
- Stores configuration in the DSH profile's YAML patch
  (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) through the native settings
  service. Secrets go to DSH credentials, not YAML.

## Adding a backend

An adapter package depends on `ctx.searchTools` and registers a manifest plus a
runtime:

```ts
export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.searchTools.registerSearchAdapter(exaAdapter), 'exa adapter')
}
```

The settings page reads adapter manifests from the host route and renders their
fields generically. No page code changes when a new adapter is registered.

## Development

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

`pnpm build` emits:

```text
lib/index.js        Host half
lib/client.js       Browser lazy-CJS factory
lib/types/**        Declarations
```

## Install in DSH

Primary path is the Web UI:

1. Open **Plugins**.
2. **Add plugin** → enter `dsh-search-tools`.
3. Enable it.
4. Open **Settings → Search Tools** and configure a SearXNG instance.

For local development, an absolute-path overlay can load `src/index.ts`; use the
DSH checkout's own docs for the exact `--patch` command.

## Project layout

```text
src/core/                 adapter types, registry, stable dispatchers
src/search/adapters/      search adapters (searxng first)
src/fetch/adapters/       fetch adapters (readable-http first)
src/research/             web_research pipeline, render, tool
src/host/                 authenticated settings routes
src/client/               Settings → Search Tools + tool card
src/shared/               config, validation, diff, URL helpers
tests/                    host units + settings page / research card components
```

Readability uses `linkedom`, not `jsdom`: jsdom's `tr46` dependency calls
`createRequire(...).resolve.paths`, which DSH's profile-resolution hook does not
implement. linkedom is smaller and works inside the Host.

## Security

- Settings routes use DSH's `connection.requestRejection` fence.
- Fetch reuses DSH's SSRF-safe `HttpFetchProvider`.
- Tokens are read from `ctx.credentials`/environment per request and never enter
  YAML, logs, or error text.
- SearXNG requests use `redirect: 'error'` so credentials cannot follow a
  cross-origin redirect.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
