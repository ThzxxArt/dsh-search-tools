# Release v0.1.7 — Local Direct search

> **Status: published 2026-10-24.** Tag `v0.1.7` points at `9c58f23`; npm
> `dsh-search-tools@0.1.7` and GitHub Release `v0.1.7` exist. Do not move or
> recreate the tag. The post-release regression review shipped as
> [v0.1.8](release-v0.1.8.md); 0.1.7 remains as the historical version.

## What ships

- New `search:local-direct` adapter: DuckDuckGo + Bing public HTML first pages,
  fixed origins, local parsing, redirect unwrapping, ad filtering, RRF fusion,
  per-host diversity, per-engine rate gates, complete-only cache, and partial
  failure notes.
- One-shot `impit` worker for local-direct; shared worker lifecycle with
  `wire-http`.
- `checkboxes` manifest field, `StatusResponse.search.sources`, and an
  instance-less **Test engines** probe in the Search settings tab.
- Documentation, locale, manifest notice, and error codes for the new boundary.

Default search remains `searxng`; default fetch remains `readable-http`. Stable
provider ids and DSH tool schemas are unchanged. Existing profiles need no
migration.

## Boundary (must stay in release notes)

- **Not offline.** Queries leave the machine to the enabled public engines.
  Parsing/fusion/ranking/cache are local; no SearXNG, Reader, API key, browser,
  Docker, or third-party aggregator is used.
- **No JavaScript.** DuckDuckGo/Bing HTML endpoints only. SPA content still
  needs `jina-reader` or another rendering backend.
- **No redirect following, cookies, or Authorization.** The two origins are
  fixed in code; there is no custom endpoint.
- **No engine SLA.** Engines can rate-limit, return 202/403, or change markup.
  Failures are explicit; there is no automatic fallback.
- **`web_research` fetch phase is public-only.** Local/private search result URLs
  cannot be read through it.

## Verification

Run from a clean checkout:

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
SEARCH_LIVE=1 pnpm vitest run tests/local-direct-live.spec.ts
WIRE_LIVE=1 pnpm vitest run tests/wire-live.spec.ts
```

Expected evidence (2026-10-24 baseline: **240 passed / 8 live-skipped**):

- `pnpm release`: typecheck, full test suite, host/client/types build, pack dry
  run, publint.
- `SEARCH_LIVE=1`: real worker queries both fixed engines, runtime fuses
  results, probe reports engines, and `web_research` consumes local search.
- `WIRE_LIVE=1`: existing wire-http live tests remain green.
- GUI: select **Local Direct**, see engine checkboxes / notice, no instance
  field; **Test engines** lists reachable engines; a real query returns sources;
  save and reload keeps the selection; Overview shows the source count, not a
  spurious "0 instances" empty state.

## Fresh-profile smoke

1. Install `dsh-search-tools@0.1.7` into a fresh DSH profile.
2. Open **Settings → Search Tools → Search**.
3. Select **Local Direct**; verify the local notice and DuckDuckGo/Bing
   checkboxes; no SearXNG instance is required.
4. Click **Test engines**; confirm at least one engine is reachable.
5. Run a search test; inspect titles/snippets and any `Search notes`.
6. Save; reopen the page and confirm Local Direct is still selected.
7. Turn on search takeover only after the test passes; call `web_search` and
   `web_research` once.
8. Switch back to SearXNG and confirm its configuration was preserved.
9. Run one fetch test through `readable-http` or `wire-http`; Local Direct is a
   search backend and must not affect fetch behavior.
10. Check Diagnostics: `search.sources` equals the enabled engine count
    (`local-direct`) or enabled instances (`searxng`).

## Publish

> Historical procedure only: v0.1.7 is already published. Do not run these
> commands for it. Use [v0.1.8](release-v0.1.8.md) for the corrective release.

Preferred: push the `v0.1.7` tag so `.github/workflows/release.yml` reruns
`pnpm release`, publishes to npm with provenance when the version is not already
present, and creates the GitHub Release with the tarball.

Manual fallback:

```sh
pnpm pack --pack-destination dist
npm publish --access public
gh release create v0.1.7 dist/dsh-search-tools-0.1.7.tgz --title "v0.1.7" --notes-file docs/release-v0.1.7.md
```

Never move a published tag. If the release is broken, deprecate `0.1.7` and
publish `0.1.8`; do not reuse the version.

## Rollback

- Set `search.adapter: searxng`; the previous SearXNG config is still in
  `search.adapters.searxng`.
- If takeover is active, switch it off before uninstalling, or restore
  `web.searchProvider` to the recorded previous provider.
- `local-direct` caches only in process memory; restarting DSH clears it.
