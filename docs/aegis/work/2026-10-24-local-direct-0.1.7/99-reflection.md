# 0.1.7 Local Direct search — Reflection

## What held

- Fixed origins are a smaller security surface than a configurable search URL:
  no user-controlled target, no redirect, no Cookie/Authorization.
- Local RRF plus per-host diversity gives useful fused results without a
  second LLM/reranker.
- Complete-only cache prevents a transient single-engine failure from poisoning
  the next query.
- The shared one-shot worker removed duplicated native-lifecycle code and kept
  the existing wire-http tests green.

## Residual risks

- Engine HTML can change; fixtures + explicit notes are the mitigation, not a
  guarantee.
- Engines may rate-limit/block a network; there is no engine SLA and no
  fallback by design.
- No JavaScript rendering; SPA content remains a `jina-reader`/future browser
  concern.
- The query leaves the machine to DuckDuckGo/Bing; this is documented, not
  hidden behind a "local" label.
- `web_research` fetch remains public-only; local result URLs are not readable.
