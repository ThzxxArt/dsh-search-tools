# Release v0.1.8 — Local Direct regression review

## What ships

v0.1.8 is a corrective release for the 0.1.7 Local Direct search path. It keeps
the same adapter id, defaults, provider ids, and tool schemas; it fixes
correctness, lifecycle, status, UI, and release-gate gaps found by a full
regression review.

- Partial engine success is preserved when the deadline or retry budget stops
  further attempts; only a search with no successful engine raises
  `LOCAL_DIRECT_ALL_FAILED` / `LOCAL_DIRECT_DEADLINE`.
- A 200 HTML page whose results are all filtered by include/exclude domains is a
  successful empty engine result; it is not mislabeled as an engine failure or
  an unreachable probe. Retry-completed searches do not retain stale notes.
- Fatal native-runtime and invalid-target worker errors are not retried.
- One-shot workers are terminated when request cloning fails and when abort
  races the initial signal check.
- Cached results honor an already-aborted caller.
- Bing padded/URL-encoded redirect payloads decode; credential-bearing result
  URLs are rejected.
- `search.sources` normalizes engine case/whitespace and handles malformed
  values without inflating the count.
- Probe UI distinguishes partial success, shows notes, and cannot be overwritten
  by a stale in-flight draft, discard, or external revision.
- Search probe/preview signals follow the draft deadline with a margin; the
  shared engine gate is abortible and applies across probe/live runtimes.
- Release workflow: tag/version/branch guard, full Ubuntu/Windows Node 22/24
  verification before publish, and release-notes body from this file.
- Package gate: `pnpm check:package` verifies both built worker entries are in
  the npm tarball.

## Boundary (must stay in release notes)

- **Not offline.** Queries leave the machine to the enabled public engines.
  Parsing, fusion, ranking, and caching are local; no SearXNG, Reader, API key,
  browser, Docker, or third-party aggregator is required.
- **No JavaScript.** DuckDuckGo/Bing HTML endpoints only. SPA content still
  needs `jina-reader` or another rendering backend.
- **No redirect following, cookies, or Authorization.** The two origins are
  fixed in code; there is no custom endpoint.
- **No engine SLA.** Engines can rate-limit, return 202/403, or change markup.
  Failures are explicit; there is no automatic fallback.
- **`web_research` fetch phase is public-only.** Local/private search result URLs
  cannot be read through it.
- 0.1.7 remains on npm as a published historical version. 0.1.8 is the fixed
  release; do not move the `v0.1.7` tag.

## Verification

Run from a clean checkout:

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
SEARCH_LIVE=1 pnpm vitest run tests/local-direct-live.spec.ts
WIRE_LIVE=1 pnpm vitest run tests/wire-live.spec.ts
```

Evidence (2026-10-24 baseline):

- `pnpm release`: typecheck, **260 passed / 8 live-skipped (35 files)**, host/
  client/types build, `check:package`, pack dry run, publint.
- `SEARCH_LIVE=1 tests/local-direct-live.spec.ts`: **3/3 passed** (real Impit
  worker, both fixed engines, probe, `web_research`).
- `WIRE_LIVE=1 tests/wire-live.spec.ts`: **5/5 passed** after the shared worker
  changes.

Expected gate:
- `SEARCH_LIVE=1`: real worker queries both fixed engines, runtime fuses
  results, probe reports engines, and `web_research` consumes local search.
- `WIRE_LIVE=1`: existing wire-http live tests remain green.
- CI matrix: Ubuntu + Windows × Node 22/24 all green before npm publish.
- GUI: Local Direct checkboxes/notice, no instance field, partial/reachable
  engine probe, real query, save/reload, source count, and no stale probe after
  editing.

## Publish

Preferred: push the annotated `v0.1.8` tag only after `main` CI is green. The
release workflow verifies the tag/version/branch, runs the matrix, runs
`pnpm release`, publishes to npm with provenance when the version is absent,
and creates the GitHub Release with the registry tarball and this file as its
body.

Manual fallback (no provenance):

```sh
pnpm pack --pack-destination dist
npm publish --access public --registry=https://registry.npmjs.org
```

Never move a published tag. If 0.1.8 is broken, publish 0.1.9; do not reuse the
version.

## Rollback

- Set `search.adapter: searxng`; the previous SearXNG config is still in
  `search.adapters.searxng`.
- If takeover is active, switch it off before uninstalling, or restore
  `web.searchProvider` to the recorded previous provider.
- `local-direct` caches only in process memory; restarting DSH clears it.
