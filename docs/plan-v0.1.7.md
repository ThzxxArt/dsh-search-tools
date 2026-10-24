# 0.1.7 — local-direct search backend

## Goal

Add a second search adapter, `local-direct`, that queries DuckDuckGo and Bing
HTML endpoints directly from the host process and fuses their first pages
locally. It requires no SearXNG instance, no API key, no Reader, no browser, and
no third-party aggregator. The existing `searxng` adapter and stable provider
id remain unchanged; `searxng` stays the default until the user opts in.

The query necessarily leaves the machine to the enabled public search engines.
"Local" means local request construction, parsing, fusion, ranking, caching, and
worker lifecycle; it does not mean offline search.

## Contract

- New adapter id: `search:local-direct`.
- Runtime: one one-shot Impit worker per retry round, fixed engine origins,
  `followRedirects: false`, no cookies, no auth, no JavaScript.
- Result cap: 1–20; first page of each enabled engine only.
- Fusion: Reciprocal Rank Fusion (k=60), URL unwrapping/deduplication, domain
  diversity (`maxPerHost`), partial-engine notes, complete-only caching.
- Probe: fixed query, reports the reachable engine names; no instance required.
- UI: manifest `checkboxes` field, `StatusResponse.search.sources`, and a
  "Test engines" button that works without instances.
- No automatic fallback to SearXNG or Jina. All enabled engines failing raises
  `LOCAL_DIRECT_ALL_FAILED`.

## Files

```text
src/shared/one-shot-worker.ts          generic worker lifecycle (wire + local-direct)
src/fetch/adapters/wire-http/transport.ts  thin wrapper over the shared transport
src/search/adapters/local-direct/
  schema.ts        defaults, normalisation, validation
  manifest.ts      groups, checkbox engines, notice, capabilities
  engines.ts       fixed origins, market/safe URL builders
  parse.ts         DDG/Bing HTML parsers and redirect unwrapping
  fusion.ts        RRF, dedupe, domain diversity
  protocol.ts      worker request/result/reply types
  worker-handler.ts worker-side Impit request; per-engine failures are data
  worker.ts        worker entry
  transport.ts     one-shot worker call with local-direct error codes
  provider.ts      runtime, cache, rate gates, retries, probe
  adapter.ts       SearchAdapter registration
tests/fixtures/local-direct-ddg.html
tests/fixtures/local-direct-bing.html
tests/local-direct-schema.spec.ts
tests/local-direct-parse.spec.ts
tests/local-direct-runtime.spec.ts
tests/local-direct-worker.spec.ts
tests/local-direct-transport.spec.ts
tests/local-direct-live.spec.ts
```

## Slices

1. **Contract and fixtures** — pin fixed origins, no redirect, parser fixtures,
   schema/manifest tests, registration/defaults tests.
2. **Shared worker lifecycle** — extract the one-request worker transport; keep
   wire-http behavior and tests green.
3. **Worker transport** — local-direct protocol, Impit options, per-engine
   bounded reads, per-target error data, fatal runtime errors.
4. **Engines and parsers** — DDG/Bing URL construction, redirect unwrapping,
   ad filtering, title/snippet cleanup, domain filters.
5. **Fusion/runtime** — RRF, domain diversity, cache, per-engine rate gates,
   retries, deadline/abort, partial notes, probe.
6. **UI/status** — checkboxes field, `sources` count, instance-less probe,
   locales/styles, Overview/Diagnostics compatibility.
7. **Verification and release** — fixture tests, live enabled engines,
   `web_research`, worker cleanup, GUI, full `pnpm release`, docs, version
   `0.1.7`, release guide, commit/tag/publish when authorized.

## Acceptance

- Selecting Local Direct requires no instance, key, Reader, browser, or service.
- DDG and Bing fixed origins are queried; no configurable engine URL exists.
- Results are fused/deduplicated; partial failures are visible as notes; all
  failures raise `LOCAL_DIRECT_ALL_FAILED`.
- Cache writes only complete successes; TTL/entries and clear-cache work.
- Worker terminates on success, failure, abort, and deadline; no orphan.
- `StatusResponse.search.sources` shows the enabled engine count; Overview and
  Diagnostics no longer imply "0 instances = broken" for Local Direct.
- "Test engines" probes a draft without an instance and lists reachable engines.
- `web_research` works through Local Direct search and the configured fetch
  adapter for public pages.
- Defaults remain `searxng` / `readable-http`; provider ids and tool schemas do
  not change.
- `pnpm release` passes; live tests pass when network permits; GUI smoke shows
  the adapter, checkbox group, sources count, probe, and real results.

## Non-goals

Offline search, local document indexing, browser/JS rendering, Google/Brave
scraping, custom engine endpoints, pagination, third-party search APIs,
automatic fallback, query rewriting, and LLM reranking.
