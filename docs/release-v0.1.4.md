# v0.1.4 release checklist

Date: 2026-10-23<br>
Package: `dsh-search-tools@0.1.4`<br>
npm: https://www.npmjs.com/package/dsh-search-tools<br>
DSH target: `0.2.1-rc.2` (`>=0.2.1-rc.2 <0.3.0`)<br>
Node target: `^22.19.0 || >=24.0.0`

Status: **release candidate; code gate and real GUI passed after the
2026-10-23 gap-closure audit.** Publication evidence is appended after the
publish gate.

Publication gate (2026-10-23): pending. The local GitHub credential is invalid
and npm has no authenticated user, so `main`/`v0.1.4` were not pushed and no
npm/GitHub release was created. Push attempts returned
`could not read Username for 'https://github.com'`; remote `main` remains
`be2f1c2`.

## Actual GUI evidence (2026-10-23)

Real DSH `0.2.1-rc.2`, profile `m0web`, local `0.1.4` tarball, Chromium via
Playwright, local SearXNG mock, `https://example.com/`, and a scripted
Messages-compatible model for the research timeout path.

| Check | Actual |
|---|---|
| Version / tabs | Diagnostics `v0.1.4`; all five tabs render |
| Fetch chip | `Fetch: available` |
| Diagnostics | `Fetch: available · Research: registered` |
| Fetch probe | `/probe` returns `ok:true`, HTTP 200, `contentType:html`, `readable:false` for the short example.com page, 134ms |
| Numeric validation | Pages=4 shows field errors, `aria-invalid=true`, Save disabled |
| Prompt copy | Clipboard receives the model-facing prompt; button becomes Copied |
| Search request | Mock sees UA `dsh-search-tools/0.1.4-gui`, `accept-language: zh-CN,zh;q=0.9`, JSON format |
| Cache TTL 0 | Real GUI set TTL to 0; the same query twice produced exactly two mock requests; restored afterwards |
| Search result | `Test passed`, source link, title/snippet |
| Fetch preview | HTTP 200, `html`, 577 chars, reader and copy controls |
| Host validation | Draft `pages=4` returns `ok:false`, `SEARCH_CONFIG_INVALID`, message `pages: Pages不能大于 3` |
| Draft result cap | Preview with draft `maxResults: 17` returns exactly 17 sources and `truncated:true` |
| Format fallback | UI shows `Format fallback result`; mock log has JSON (403) then HTML request |
| Research timeout | Real DSH + scripted Messages provider, `timeoutMs=5000`: `tool/result` is `Error: tool call timed out after 5000ms`, error `TOOL_TIMEOUT` |
| 700/560px | `scrollWidth === clientWidth` (416/416, 276/276) |
| Console | No page/console errors |

Still not covered: real SearXNG quality, real credential/conflict failure
injection, physical 560px device, screen reader, non-Chromium engines.

## What changed

- `search.userAgent` reaches search and probe requests; `language` emits
  `accept-language`, except for `all`.
- Search requests share one deadline across instances, retries, pagination, and
  backoff. Abort stops retries and sleeps; `Retry-After` (delta-seconds or HTTP
  date) is bounded by the remaining budget.
- Pagination uses partial success: failed pages become notes, successful pages
  are merged, and only an all-pages failure raises.
- `format=auto` retries the same instance as HTML on 403/415/406 or JSON parse
  failure; 401 remains auth.
- Probe falls back from `/config` 404/non-JSON to one `/search` JSON request and
  reports actual JSON/HTML capability.
- Cache key includes auth type, proxy, and UA; `cacheTtlMs=0` truly disables the
  cache; hits return a copy.
- Search result titles/snippets/answers are bounded; duplicate URLs keep the
  longer snippet/title.
- Fetch `truncated` comes from extraction, not raw HTML length; HTML truncation
  is block-safe and falls back to text. `maxArticleChars` is a text cap and is
  validated against `maxBodyChars`.
- `readable-http` exports a real `probe`, so `FetchDispatcher.probe` no longer
  returns `FETCH_PROBE_UNSUPPORTED`.
- `research.timeoutMs` drives the registered timeout and an internal signal;
  timeout returns `WEB_RESEARCH_TIMEOUT`. Budgets are reserved before fetching;
  pages with no budget are skipped. Fetch limits read the active adapter.
- Research Markdown escapes titles, snippets, headings, and link destinations.
- Both built-in adapters validate all numeric/enum/array fields and cross-field
  ranges. The host calls `validate()` before creating a runtime, so live config,
  drafts, and probes fail with `SEARCH_CONFIG_INVALID` / `FETCH_CONFIG_INVALID`
  instead of silently clamping. Research rejects
  `defaultFetchTop > maxFetch` and `maxCharsPerPage > maxTotalChars` with
  `RESEARCH_CONFIG_INVALID`.
- `/search-preview` uses the draft `maxResults`; probe uses
  `requestTimeoutMs` and the configured GET/POST method. Status reports
  `search.enabled`, `fetch.enabled`, `fetch.available`, and live
  `research.registered`.
- No new adapter, stable provider ids unchanged, no SSRF/permission change.

## Verification

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
npm publish --dry-run
```

Expected/actual:

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` | 119 tests / 19 files, pass |
| `pnpm build` | host, client, declarations emitted |
| `pnpm pack --dry-run` | tarball includes READMEs, locale, patch, icon, lib |
| `pnpm check:publint` | no issues |
| `git diff --check` | clean |
| Version | `0.1.4` in package, routes, default UAs |
| Worktree | clean after build artifacts are ignored |

## Real GUI acceptance

Use a real DSH settings modal, not a standalone React harness.

- 1440px viewport, Light and Dark: hero chips, five tabs, Search sub-tabs,
  Fetch reader, action bar, and Diagnostics runtime state render without
  clipping.
- 700px viewport, Light and Dark: tabs remain one row; fields/instances stack;
  action-bar actions wrap without horizontal overflow.
- 560px controlled content: no horizontal overflow.
- Keyboard: adapter cards, tabs, fields, disclosures, instance actions, and
  action-bar buttons have visible focus; Arrow/Home/End works; Enter/Space opens
  the Advanced disclosure.
- State checks: invalid numeric field shows a field error and blocks save;
  invalid instance shows a field error; conflict/read-only/unavailable/loading
  states remain distinguishable; Fetch chip uses `fetch.available`; Diagnostics
  shows `research.registered`.
- Runtime checks: a real search request carries the configured UA and
  accept-language; an auto JSON→HTML fallback and a fetch `/probe` are exercised;
  a short research timeout returns an error instead of hanging; cache TTL 0
  performs two requests.

Actual results are recorded in `docs/m0-verification.md`. Any unexecuted items
are marked as evidence gaps, not as passed.

## Publish path

```sh
git tag -a v0.1.4 -m "dsh-search-tools v0.1.4"
git push origin main --follow-tags
```

The tag runs `.github/workflows/release.yml`, which repeats the release gate,
publishes with provenance using `NPM_TOKEN`, downloads the published registry
tarball, and attaches that exact file to the GitHub release.

## Post-publish smoke test

1. `npm view dsh-search-tools@0.1.4 version dist.tarball` returns the release.
2. Install in a fresh DSH profile and open **Settings → Search Tools**.
3. Confirm **Diagnostics** reports version `0.1.4`, `fetch.available`, and
   `research.registered`.
4. Run a search test, open a Fetch reader, and make one `web_research` call.
5. Confirm the npm and GitHub tarballs have the same SHA-256.

## Rollback

If the release is broken, deprecate `0.1.4` and publish a fixed `0.1.5`. Do not
unpublish a version that users may already depend on.
