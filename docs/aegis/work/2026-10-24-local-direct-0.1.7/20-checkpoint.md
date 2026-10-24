# 0.1.7 Local Direct search — Checkpoint

## Baseline

- HEAD `e512eb4` (`v0.1.6`), working tree clean.
- Defaults: `search.adapter: searxng`, `fetch.adapter: readable-http`.
- Existing search contract: `SearchAdapter`, `SearchDispatcher`, manifest fields,
  `StatusResponse.search.instances`, `web_research` public-only fetch.

## Decisions

- `local-direct` is opt-in; default search stays `searxng`.
- Fixed origins only; no custom endpoint field.
- First page per engine; no pagination in 0.1.7.
- RRF (k=60), URL unwrapping/dedupe, per-host diversity, complete-only cache.
- One-shot Impit worker per retry round, shared with `wire-http` via
  `src/shared/one-shot-worker.ts`.
- `checkboxes` field for engine selection; `sources` count for instance-less
  adapters; **Test engines** uses the existing `/probe` route.
- No automatic fallback; all-engine failure is `LOCAL_DIRECT_ALL_FAILED`.

## Slices

1. Schema/manifest/engines.
2. Parsers/fixtures/redirect unwrapping.
3. Worker protocol/handler/transport.
4. Runtime/fusion/cache/rate gate/retries/probe.
5. UI/status/settings validator.
6. Tests/live/GUI/docs/release.
