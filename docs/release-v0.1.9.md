# Release v0.1.9 — More engines, isolated workers, and fetch stability

v0.1.9 is the 0.1.9 iteration review. It keeps the 0.1.8 default engines
(DuckDuckGo and Bing), adds two opt-in HTML engines (Brave Search and 360
Search), and closes the audited runtime/contract defects without introducing a
browser, API key, or cross-adapter fallback.

## Added

- **Brave Search** as an opt-in Local Direct engine. Brave's Chrome Impit
  profile returned a stable HTTP 429 during the live gate; the Firefox profile
  returned 200 and parseable `data-type="web"` snippets, so the descriptor pins
  only Brave's transport to Firefox. The user-facing `profile` setting still
  applies to DuckDuckGo, Bing, and 360.
- **360 Search** as an opt-in Local Direct engine for the Chinese market. It
  uses a fixed origin and no JavaScript.
- Sogou and Bing China were probed and rejected for 0.1.9: Sogou redirected to
  an anti-spider gate even on its mobile endpoint, and Bing China redirected to
  the existing Bing origin. Neither ships as a half-working or duplicate
  engine.
- Engine descriptor registry: one record now owns each engine's origin, path,
  URL builder, parser, optional transport profile, and no-results detector. An
  incomplete engine record fails type checking.
- Per-engine worker execution. One hanging engine cannot discard another
  engine's successful result; each engine has its own gate, retry budget, and
  abort/deadline settlement.
- Explicit `ProbeResult.partial`, `failedEngines`, and `engineResults`; the
  settings page no longer infers partial success from a human message.
- Manifest `sourceCount` and `engineProbe` metadata, with field-kind fallback
  for third-party manifests.

## Fixed

- Local Direct no longer treats a normal no-results page as an engine failure.
- Deadline measurements use the adapter clock consistently; retry/gate sleeps
  remove their abort listeners on every settlement path.
- SearXNG caches only complete, note-free, non-empty results; cache hits honor
  caller cancellation; credential resolution is bounded by the search deadline;
  missing `categories` uses the documented `general` default; language values
  that could inject a header are rejected.
- `web_research` uses extracted text when Readability cannot return safe HTML,
  releases a failed page's budget, and rejects non-finite numeric arguments.
- Readability's already-extracted marker is validated structurally instead of
  trusting a string anywhere in the page.
- Diagnostics redact URLs, bearer tokens, and secret-looking assignments at
  record time.
- wire-http tries each already-validated DNS address without re-resolving the
  hostname; PDF `pagesRead` reports actual pages read; Jina rejects an empty
  2xx body and accepts numeric-string `httpStatus`.
- Dispatcher runtimes are rebuilt when an adapter with the same id is
  re-registered. Research-tool disposal/registration is serialized and
  generation-guarded. Status credential descriptions are bounded at one second.
- Settings fields merge manifest defaults for display without persisting every
  default; backend pickers are disabled in read-only state; probe requests are
  cancellable and cannot overwrite a newer draft.

## Compatibility

- Default search engines remain **DuckDuckGo + Bing**; Brave Search and 360 are
  opt-in.
- Stable provider ids, tool schemas, and default adapters are unchanged.
- No cross-adapter fetch fallback. `readable-http`, `wire-http`, and
  `jina-reader` keep their existing data boundaries.
- Version metadata and default User-Agents report `0.1.9`.
- A config containing `brave` or `so360` should remove that id before
  downgrading to 0.1.8, whose validator rejects unknown engine values.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`, `pnpm check:package`, `pnpm pack:check`
- `SEARCH_LIVE=1` Local Direct live tests, including Brave and 360 (when the
  network is reachable)
- `WIRE_LIVE=1` wire-http live tests (when the network is reachable)

This release does not publish automatically from this document. Publish only
after the explicit release authorization and a green CI matrix.
