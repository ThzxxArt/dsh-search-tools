# Changelog

## 0.1.0 — unreleased

### Added

- Adapter-first core: `ctx.searchTools` registry, stable search/fetch dispatchers,
  manifest-driven settings metadata.
- SearXNG search adapter skeleton: config validation, JSON/HTML parsing, auth
  lookup, failover, pagination, cache, probe.
- Readability HTTP fetch adapter skeleton: DSH safe fetch, lazy jsdom/Readability,
  fail-open extraction.
- `web_research` tool and conversation card.
- Settings section registration (`settings.section`) and authenticated host
  routes for status, adapters, probe, search preview, fetch preview, cache clear.
- YAML-backed config through DSH settings; credentials-backed secrets.
- Project skeleton: TypeScript, tsdown host/client builds, Vitest, CI/release
  workflows, bilingual README, MIT license.
- Component tests for the settings page and `web_research` card
  (`tests/settings-page.spec.tsx`, `tests/research-card.spec.tsx`), with jsdom
  as a dev-only test environment.
- Code-based adapter issue messages, localized for `zh` / `en`; the settings
  page falls back to the English message when no code is present.
- Generic manifest validation for external adapters, so a new adapter's required
  fields and numeric bounds are checked before saving without importing its code
  into the browser.
- The research card only turns `http(s)` source URLs into links and drops
  malformed presentation-meta entries instead of rendering empty rows.

### Verified

- M0 on DSH `0.2.1-rc.2`: Settings → Search Tools renders; Save writes
  `cordis.patch.yml`; authenticated routes return 401 without the browser
  cookie and 200 with it; probe/search-preview work against a mock SearXNG;
  search/fetch takeover and restore work; secret write stays out of YAML.
  Details: `docs/m0-verification.md`.
- 37 tests across 9 files, including settings-page, research-card, and
  takeover-warning component tests (`pnpm test`).

### Fixed during M0

- Resolve credentials per request instead of capturing them at plugin apply.
- Read the `{ ok, value }` envelope from `remote.credentials.describe`.
- Render write-only secret fields from `manifest.secretRefs`.
- Require a passing search test before search takeover and restore the previous
  provider on disable.
- Allow an empty instance list when takeover is off.
- Localize page copy and adapter manifests for `zh` / `en`.
- Rebuild the LRU when cache bounds change; wire `undici.ProxyAgent`.
- Validate a missing `userAgent` against the adapter default.
- Use linkedom instead of jsdom for Readability: jsdom's `tr46` dependency
  calls `createRequire(...).resolve.paths`, which DSH's profile-resolution hook
  breaks; linkedom is smaller and works inside the Host.
- Add the `plugins.detail.section` takeover warning with a direct
  “disable takeover” action.
- Add per-instance probe buttons and an empty-state guide.
- Add localized adapter manifests so external adapters can ship `en` / `zh`
  labels without changing the page.
- Drop malformed `web_research` presentation-meta entries instead of rendering
  empty list items or duplicate React keys.
- Give research number fields real label/id associations, so they are reachable
  by accessible name as well as by mouse.
- Recognize a scoped package name (`@scope/dsh-search-tools`) in the Plugins-page
  takeover warning instead of requiring the unscoped name verbatim.
