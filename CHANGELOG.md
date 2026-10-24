# Changelog

## 0.1.8 — 2026-10-24

### Fixed

- Local Direct now returns already-successful engine results when the deadline
  or retry budget is exhausted, instead of converting a partial success into
  `LOCAL_DIRECT_DEADLINE`.
- A 200 HTML response whose parsed results are all removed by domain filters is
  treated as a successful, empty engine result; it no longer turns into
  `LOCAL_DIRECT_ALL_FAILED` (or makes a probe look unreachable). A 200 page
  with zero parsed hits, and HTTP 202/204 challenge/rate-limit responses, stay
  explicit failures instead of being reported as a reachable empty search.
- Complete success after a retry drops stale per-engine failure notes and never
  caches a partial/failed note; cache writes also skip empty result sets.
- A fatal native-runtime or invalid-target worker failure is propagated as its
  own code instead of being retried and flattened into
  `LOCAL_DIRECT_ALL_FAILED`.
- A cached result is never returned after the caller has already aborted.
- The one-shot worker is terminated even when `postMessage` throws or the
  caller signal aborts between the initial check and listener attachment.
- Bing redirect payloads with URL-encoded/padded base64 decode correctly;
  credential-bearing search-result URLs are rejected.
- `StatusResponse.search.sources` normalizes engine case/whitespace and returns
  zero for a malformed/null engine list instead of reporting manifest defaults.
- Local Direct probes show a distinct partial-success state and surface the
  failed-engine notes instead of hiding them when at least one engine worked.
- In-flight engine probes cannot overwrite a newer draft; editing, discarding,
  or an external revision invalidates the pending probe.
- Search probe/preview routes honor the draft search deadline with a small
  margin instead of fixed 20s/30s caps.
- Engine rate gates are shared by probe and live runtimes, and waiting for the
  gate is abortible instead of sleeping through the caller's cancellation.
- Checkbox values are matched case/whitespace-insensitively, preserve defaults,
  and cannot be duplicated by toggling.
- The settings page falls back to the manifest default for an unset checkbox
  group and uses an existing DSH accent token for checkbox controls.

### Changed

- Version metadata and default User-Agents report `0.1.8`.
- Release workflow verifies the tag matches `package.json`, requires the tag
  commit on `main`, runs the full Ubuntu/Windows × Node 22/24 matrix before
  publishing, and uses `docs/release-v0.1.8.md` as the GitHub Release body.
- `pnpm check:package` asserts the built tarball contains both worker entries
  and the host/client entries; CI and the release workflow run it.
- Added regression coverage for partial deadline results, fatal runtime
  propagation, cached aborts, retries, cache TTL/eviction, Bing padding and
  credential URLs, status normalization, partial/stale probes, and search route
  timeouts.

### Verified

- `pnpm release`: typecheck, 260 passed / 8 live-skipped (35 files), host/client/
  types build, `check:package`, pack dry run, publint.
- `SEARCH_LIVE=1` local-direct live tests: 3/3 passed.
- `WIRE_LIVE=1` wire-http live tests: 5/5 passed.

## 0.1.7 — 2026-10-24

### Added

- New `local-direct` search adapter: queries DuckDuckGo and Bing public HTML
  first pages directly from the host, unwraps ad/redirect links, deduplicates
  URLs, RRF-fuses rankings, applies per-host diversity, and caches only complete
  successes. No SearXNG, API key, Reader, browser, or aggregator is required.
- Fixed-origin engine URL construction (`html.duckduckgo.com`, `www.bing.com`),
  market/safe-search mapping, per-engine rate gates, retries, partial-result
  notes, and explicit `LOCAL_DIRECT_ALL_FAILED` failure without fallback.
- One-shot local-direct worker with `impit` TLS/HTTP2 profiles, no cookies,
  Authorization, page JavaScript, or redirect following; the worker terminates
  on every settlement path.
- `checkboxes` manifest field, `StatusResponse.search.sources`, and an
  instance-less **Test engines** probe in the Search tab.
- Fixture/runtime/live tests for schema, fixed origins, parsers, RRF, cache,
  partial failure, worker cleanup, UI, status, and `web_research`.

### Changed

- Version metadata and default User-Agents report `0.1.7`.
- Search defaults still use `searxng`; `local-direct` is explicitly opt-in and
  remains in the built-in defaults for a zero-migration settings page.
- Worker lifecycle is shared by `wire-http` and `local-direct` through
  `src/shared/one-shot-worker.ts`.
- `tsdown` emits `lib/local-direct-worker.js` alongside `lib/wire-worker.js`.

### Security

- Local Direct has no configurable endpoint: queries only go to the two fixed
  public origins. It sends no Cookie/Authorization, follows no redirects, and
  does not execute JS. The query text leaves the machine to the enabled engines;
  this is documented in the manifest, README, and security model.
- Search adapters have adapter-scoped egress: SearXNG uses the configured
  instance; Local Direct uses fixed public engines; `web_research`'s fetch phase
  remains public-only.
- No change to stable provider ids, tool schemas, default adapters, or DSH
  permission/approval behavior.

## 0.1.6 — 2026-10-24

### Added

- New opt-in `wire-http` fetch adapter: local browser-grade TLS/HTTP2
  fingerprinting through `impit` (Chrome/Firefox profiles), no Reader, API key,
  browser, Docker, or system library required.
- A loopback egress guard (`127.0.0.1:0`) validates every CONNECT/HTTP hop,
  rejects private/reserved/link-local/ULA/CGNAT/IPv4-mapped/6to4/Teredo and
  known NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`) answers, and pins the
  connection to a validated IP. The initial target and each redirect hop use
  the same guard; network-specific NAT64 prefixes remain a documented residual
  boundary.
- One-request worker isolation around the native `impit` client. The worker is
  terminated on success, error, abort, and timeout, so native clients and
  sockets cannot survive into the next fetch.
- Local PDF text extraction with lazy `pdfjs-dist` loading, page/byte/character
  caps, `isEvalSupported: false`, and explicit `WIRE_PDF_UNREADABLE` /
  `WIRE_PDF_INVALID` failures.
- Shared public-target parsing/address policy extracted from the Jina guard;
  both Jina and wire-http now use the same `shared/public-target.ts` owner.
- Manifest groups/fields/notice for the settings page, `fetch:wire-http`
  validator registration, built-in defaults, and `html`/`pdf`/`probe`/
  `readability` capabilities. No custom React component was added.
- Contract and integration tests for schema/manifest, public/private/mixed
  targets, IPv4-mapped/NAT64/6to4/Teredo, egress CONNECT/HTTP rejection, worker
  lifecycle/abort/timeout, HTML/Readability, real PDF text, duplicate/missing
  response handling, and the settings UI.

### Changed

- Version metadata and default User-Agents report `0.1.6`.
- `fetch.adapter` remains `readable-http`; `wire-http` is explicit and is kept
  in the built-in defaults so it is visible in the settings page without a
  migration.
- `jina-reader`'s public-target classifier now calls the shared owner; its
  public configuration and error codes are unchanged.
- `tsdown` emits `lib/wire-worker.js` as a separate worker entry.

### Security

- `wire-http` is local-only and does not send target URLs to a third-party
  Reader. It does not execute page JavaScript; SPA pages still require
  `jina-reader` or a future opt-in browser.
- The guard rejects a redirect to a private address at the next CONNECT rather
  than relying on the initial pre-flight check. It also refuses non-80/443
  ports, credentials, non-http(s) schemes, and a missing/oversized CONNECT
  authority.
- The worker sends no cookies, Authorization, or login state. No automatic
  fallback to `jina-reader` or `readable-http` exists, so a blocked private
  target cannot silently leave the machine.
- `impit` is an Apache-2.0 native dependency with platform binaries; `pdfjs-dist`
  is Apache-2.0. The plugin does not bundle Jina, a browser, or a rendering
  engine.
- No change to stable provider ids, `readable-http`'s DSH SSRF path, or DSH's
  permission/approval model.

### Verified

- `pnpm typecheck`, `pnpm test`, `pnpm build`, and the package checks pass.
- Default suite: 203 passed / 5 live tests skipped (28 files); the live suite
  with `WIRE_LIVE=1` passes the real-`impit` worker, plain HTTP absolute-form,
  HTTP→HTTPS redirect, full-runtime readable tests, and `web_research` over
  three wire-http pages.
- Added regression coverage for URL-fragment rejection in the runtime and
  absolute-form guard, all known NAT64 forms (including public-embedded
  `64:ff9b::/96`), native Impit loading on the current platform, and a real
  three-page PDF page-cap fixture.
- Real PDF fixture extraction returns `Hello PDF`; invalid PDF bytes fail
  explicitly.
- The full suite covers private/mixed target rejection, redirect-blocked error
  mapping, egress CONNECT/HTTP guard, worker timeout/abort cleanup, and the
  wire-http settings fields/validator.
- The default remains `readable-http`; `wire-http` is opt-in.

### Real model validation

- 2026-10-24: the supplied Agnes endpoint was exercised with
  `agnes-3.0-flash` through its Anthropic Messages API. The model emitted a
  `web_fetch` tool call for `https://example.com/`; the local `wire-http`
  worker returned HTTP 200 and readable text; the tool result was sent back and
  the model answered **“Page title: Example Domain”**. `agnes-2.5-flash`
  returned the expected direct reply. The credential was supplied at runtime
  and is not stored in the repository or package.

## 0.1.5 — 2026-10-23

### Added

- New opt-in `jina-reader` fetch adapter: auto/browser/curl engines, Markdown/
  HTML/text responses, CSS selectors, wait-for selector, iframe/Shadow DOM, no-cache,
  robots.txt, image/link retention, locale, custom target UA, Reader proxy
  selection, and hosted or self-hosted endpoints.
- `JINA_API_KEY` is a write-only DSH credential; no key or URL query leaks into
  YAML, logs, or diagnostics.
- Public-target guard rejects credentials, non-HTTP(S) URLs, loopback/private/
  link-local literals, and hostnames with any non-public DNS answer before the
  URL leaves the plugin. Common NAT64, IPv4-mapped, and IPv4-compatible
  addresses are handled.
- Generic `manifest.notice` support and `browser`/`pdf` adapter capabilities;
  the Jina manifest renders a data-boundary notice in the existing form.
- Fetch preview/probe route signals now follow the draft `timeoutMs` (base
  30s/30s, plus 5s, capped at 190s), so a 60s Jina draft no longer dies at 30s.
- `X-Timeout` is sent one second below the local `timeoutMs` (Reader wait budget,
  not a hard deadline); HTML/text modes read `data.html`/`data.text` and Markdown
  reads `data.content`. Target status is read from `data.warning`, then official
  `data.httpStatus`, then the optional `data.statusCode` fallback; HTML/text do
  not request a duplicate content companion.
- IPv4-compatible IPv6 transition addresses are rejected by the public-target
  guard, `JINA_RATE_LIMIT` retry hints are bounded to one hour, hanging
  credential lookups share the request deadline, and non-2xx targets with no
  selected-mode body preserve their status instead of becoming
  `JINA_BAD_RESPONSE`.
- Contract tests for request headers/body, key isolation, target 404 mapping,
  warning/httpStatus/statusCode precedence, non-2xx empty-body status
  preservation, 401/403/429/5xx, JSON-code 429 retry hints, timeout/abort,
  hanging credentials, clipping, response caps, bad JSON, probe, CGNAT/link-local/
  ULA/mapped-loopback guards, UI notice/validation/credential write, defaults,
  and host timeout wiring.

### Changed

- Version metadata and default User-Agents report `0.1.5`.
- `fetch.adapter` remains `readable-http` by default; selecting `jina-reader` is
  explicit and persisted per profile.
- `web_fetch`'s 30s tool timeout is unchanged. A Reader timeout above 30s also
  requires raising DSH `tool-web.fetchTimeoutMs`; the README documents this.
- README, README.en, SECURITY, architecture, and design now scope JS/SSRF
  claims to `readable-http` and describe Jina's data boundary and residual
  DNS-rebinding limitation.

### Security

- Hosted Jina sends target URLs off-machine and may cache them; only a
  self-hosted Reader keeps content local. The Reader may also follow redirects
  or browser navigations after our pre-flight guard; self-hosted Reader egress
  must be restricted. The adapter does not sign in, bypass paywalls, or solve
  CAPTCHAs.
- Remote Reader endpoints require HTTPS; plain HTTP is loopback-only. Endpoint
  credentials, query, and hash are rejected.
- `ipaddr.js` is a direct dependency for address classification.
- No change to stable provider ids, `readable-http`'s DSH SSRF path, or DSH's
  permission/approval model.

### Verified

- `pnpm release`: 163 tests / 22 files, typecheck, build, pack, and publint pass.
- Real DSH GUI with a local fake Jina Reader: adapter cards/notice, request
  shape including `x-timeout=59` for a 60s local deadline, Markdown `markdown`
  and HTML/text `html`/`text` request modes, non-2xx `HTTP 404` failure display,
  key write/read/clear, config save/reload (timeout 61000), adapter switch
  persistence, private-target rejection, invalid-endpoint blocking, 31s success
  with `timeoutMs=60000`, 700/560 layout, and version `0.1.5` all pass; no
  page/console errors. A scripted mock LLM also called the real `web_fetch`
  tool through DSH and finished with `DONE`.
- Hosted `r.jina.ai` anonymous request returns HTTP 401 in 588ms through the
  real GUI, mapped to `JINA_AUTH`; this proves reachability and error mapping,
  not a successful hosted run. A real key/self-hosted success path remains an
  environment gap.

## 0.1.4 — 2026-10-23

### Added

- `search.userAgent` now reaches both search requests and probes; `language`
  also emits an `accept-language` header (omitted for `all`).
- `research.timeoutMs` now drives the registered tool's declared timeout and a
  real `AbortSignal` around search/fetch; timeout returns
  `WEB_RESEARCH_TIMEOUT`.
- `readable-http` now exports a real `/probe` implementation, so
  `FetchDispatcher.probe` no longer returns `FETCH_PROBE_UNSUPPORTED`.
- Page-level search degradation: a failed page no longer discards successful
  pages; failed pages become notes and an all-pages failure still raises.
- `format=auto` now retries the same instance with `format=html` on 403/415/406
  or a JSON parse failure; 401 remains an authentication error.
- Probe fallback from `/config` 404/non-JSON to one `/search` JSON probe.
- Search retries honor `Retry-After` (delta-seconds or HTTP date) within the
  shared deadline instead of always using exponential backoff.
- The host calls each adapter's `validate()` before available/search/fetch/
  probe/preview. Invalid live or draft config returns
  `SEARCH_CONFIG_INVALID` / `FETCH_CONFIG_INVALID` instead of being silently
  clamped by normalization.
- Search preview uses the draft `maxResults` instead of a hard-coded 10.
- Search probe uses the configured GET/POST method and combines the configured
  request timeout with the caller signal.
- `/status` reports real `search.enabled` and `fetch.enabled` values.
- `web_research` rejects `defaultFetchTop > maxFetch` and
  `maxCharsPerPage > maxTotalChars` with `RESEARCH_CONFIG_INVALID`.
- Cache keys include auth type, proxy, and user agent; credential rotation
  still requires a manual clear.
- Result snippets/titles/answers are bounded; duplicate URLs keep the longer
  snippet and title.
- Fetch `truncated` now comes from the extractor, not a raw-HTML-length
  comparison. HTML truncation is block-safe and falls back to text rather than
  emitting broken markup.
- `maxArticleChars` is explicitly an extracted-text cap and must not exceed
  `maxBodyChars`.
- Research budgets are reserved before fetching/extraction; pages with no
  remaining budget are skipped.
- Research fetch limits read the active fetch adapter instead of hard-coding
  `readable-http`.
- Research Markdown escapes titles, snippets, headings, and link destinations.
- Numeric/boolean/string-array/enum validation for both built-in adapters, plus
  cross-field checks; the settings page surfaces numeric errors before save.
- `/status` reports `fetch.available` and live `research.registered`; the Fetch
  chip and Diagnostics use those values.
- New tests for status truth, request headers/params, partial pages, format and
  probe fallback, strict deadline/abort, cache keys/TTL zero, fetch probe,
  transport limits, fail-open/closed, research timeout/budget/concurrency, and
  Markdown escaping.

### Changed

- Version metadata and default User-Agents report `0.1.4`.
- README/README.en remove the stale “Advanced tab”, “prompt read-only”, and
  “research timeout not wired” claims; cache TTL 0, probe, UA, and truncation
  semantics are documented.
- Diagnostics now shows live fetch availability and research registration.

### Verified

- `pnpm typecheck`: pass.
- `pnpm test`: 119 tests / 19 files.
- `pnpm build`: host, client, and types pass.
- npm `0.1.4` is published as `latest`; GitHub Release `v0.1.4` is published;
  both tarballs are 239,240 bytes and hash to
  `4da7625d6a17d46b2bbebb0cbb53a65947d6c1dc0dbb23c3cb5d0b65c35f41b9`.
- No new adapter, no stable provider-id change, and no SSRF/permission changes.

## 0.1.3 — 2026-10-23

### Added

- Search now has Connection / Search behavior sub-tabs derived from manifest
  groups, with a compact current-backend summary and a Change backend action.
  The tab content (excluding the global hero/tabs/action bar) measures 772px /
  928px at 564px and 842px / 1,194px at 416px, inside the 1,000px / 1,400px
  targets.
- Fetch results now render a reader card with the DSH `CodeBlock`, Copy content,
  Hide content / Show content, and a reset on every new preview.
- Save conflicts now render a distinct warning notice in addition to the
  action-bar message.
- Credential write and clear failures now render as field-level red errors with
  `aria-invalid`, and clear as soon as the user edits the secret.
- The settings page is split into five tab components
  (`OverviewTab`, `SearchTab`, `FetchTab`, `ResearchTab`, `DiagnosticsTab`) plus
  `AdapterPicker`, `TestConsole`, `ResearchBudget`, `ResearchPrompt`,
  `SettingRows`, `Feedback`, and `settings-utils`; the page component is 691
  lines instead of 1,421.
- The page reserves 104px of bottom padding for the sticky action bar (54px at
  564px, 83px at 416px).
- Four new component tests — fetch reader copy/collapse, credential field error,
  conflict notice, and unavailable/read-only states — plus Home/End coverage on
  the existing tab test. The settings file has 30 tests; the package has 73.
- README screenshots use demo data in `docs/assets/`.
- Version metadata, status, and default User-Agents report `0.1.3`.

### Changed

- The one-screen Search form is now two focused sub-views. Backend selection is
  a compact summary until the user chooses Change backend.
- The old full `pre` fetch body is replaced by a collapsible reader with a copy
  action and code-block wrapping.
- The action-bar surface remains opaque and now has enough bottom padding that
  the final actions are reachable after scrolling.

### Fixed

- Closed the 0.1.2 audit gaps: Search height, Fetch reader, conflict state,
  credential field errors, main-page split, action-bar reserve, test count, and
  README screenshots.
- Fetch and conflict feedback no longer rely only on the global action-bar
  message.
- The short 560px content case is exercised with a controlled container width
  and recorded in the verification note.

## 0.1.2 — 2026-10-23

### Added

- Optional adapter manifest `groups` (`id`, localized label, description, and
  `advanced`), plus optional per-field `group`, `advanced`, and `unit` metadata.
  Manifests without groups still render one configuration block.
- Grouped SearXNG settings: Connection, Search behavior, and a collapsed
  Advanced block. Readability HTTP now has Extraction and Safety limits.
- A responsive settings shell: hero status summary, segmented tabs, section
  cards, stat tiles, a test console, and a sticky action bar.
- Per-instance cards with URL/label fields, enable switch, inline test result,
  reorder and remove actions, and a dashed Add instance row.
- Research scope, projected content-budget meters, execution settings, and a
  model-facing prompt card with a copy action.
- Diagnostics tab with runtime stats, a copyable configuration path, cache
  clearing, and a recent-error timeline.
- New component coverage for grouped/collapsed fields, budget projection, prompt
  copying, and the Diagnostics tab.

### Changed

- The settings page now uses the DSH design tokens for text, cards, borders,
  semantic states, focus rings, and code. The previous page referenced `--dsw-*`
  names that do not exist in DSH 0.2.1-rc.2, so hints and errors shared a color,
  adapter cards had no visible focus ring, and the prompt preview was not
  monospace.
- Adapter fields are two columns at 520px content and one column below it.
  Advanced fields start collapsed.
- Search/Fetch test controls are now labelled test consoles; the overview shows
  both search and fetch tests together.
- The Advanced tab is now Diagnostics. The old name remains only for the
  adapter-level Advanced disclosure.
- The page reports version `0.1.2` in status metadata and default User-Agents.
- README installation, tarball, and release-flow references are updated to
  `0.1.2`; the v0.1.2 release checklist records the real GUI acceptance scope.

### Fixed

- Invalid field errors no longer share the hint color.
- Adapter cards and disclosure summaries have a visible keyboard focus ring.
- The prompt preview uses the DSH code font and card surface.
- The 416px settings pane keeps all five tabs on one row and stacks fields,
  instances, and action-bar buttons without horizontal overflow.
- The sticky save bar now has an opaque surface and labels its dirty/saved state.

## 0.1.1 — 2026-10-22

### Changed

- `README.md` is now the complete Simplified Chinese guide; `README.en.md` is the
  full English counterpart. `README.zh.md` remains only as a compatibility pointer
  to the canonical Chinese README.
- The npm tarball ships `README.md` and `README.en.md`. `README.zh.md` remains a
  small compatibility pointer; npm's automatic README handling may still include
  it even though it is not in the explicit `files` list.
- Status metadata and the default SearXNG/Readability User-Agents report
  `0.1.1`.
- Added the v0.1.1 release checklist. No functional behavior changed.

### Verified

- The full `pnpm release` gate passes after the documentation and metadata
  changes.

## 0.1.0 — 2026-10-22

### Added

- Adapter-first core: `ctx.searchTools` registry, stable search/fetch dispatchers,
  manifest-driven settings metadata.
- SearXNG search adapter skeleton: config validation, JSON/HTML parsing, auth
  lookup, failover, pagination, cache, probe.
- Readability HTTP fetch adapter skeleton: DSH safe fetch, lazily imported
  linkedom/Readability, fail-open extraction.
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
- `web_research` pipeline integration test: real HTML extraction, per-page
  failure isolation, text clipping, total-budget accounting, disabled mode, and
  presentation-meta projection.
- The research card reports successful fetches separately when some pages fail
  (`1/2 fetched`) instead of counting attempts as successes.
- Search and Fetch tabs now have inline test panels. Results are structured:
  elapsed time, safe `http(s)` source links, snippets, and fetch metadata/content,
  instead of the previous single text blob. Tests refuse to run while the draft
  has validation errors.
- Advanced diagnostics can copy a credential-free summary and clear the in-memory
  error ring (`POST /api/dsh-search-tools/diagnostics/clear`).
- Search and Fetch validation is section-scoped: a broken search draft no longer
  blocks a fetch test, and fetch errors no longer attach to search fields that
  happen to share a key.
- Tab semantics (`role=tablist/tab/tabpanel`, arrow/Home/End navigation),
  `aria-invalid` on invalid fields, an aria-live save/diagnostic status, and
  `Cmd/Ctrl+S` save.
- The active-takeover instance rule is driven by the selected manifest's
  `instances` field rather than a hard-coded SearXNG check. External adapters
  without instances no longer produce a false save error.
- `/status` lists credential refs declared by every registered adapter manifest,
  not just SearXNG's two refs.
- The settings footer is no longer sticky, so it cannot cover a long test result
  in the 800px settings pane. Overview cards use `auto-fit` columns to avoid
  label overlap at that width.
- Activation-hint and takeover-warning cards use token fallbacks, so they render
  with a real border/background outside the settings theme scope.
- Adapter picker shows the selected manifest's description/capabilities and keeps
  a visible “not installed” option for orphaned config.
- Adapter picker is now a radio-card group with per-adapter
  configured/needs-setup/needs-attention status, a “not installed” orphan card,
  and a Refresh adapters action.
- Research tab previews the model-facing `web_research` description and parameter
  bounds from the current draft. The contract lives in `src/research/prompt.ts`
  and is shared with the registered tool, so the preview cannot drift from the
  tool description.
- Instance rows stack the URL/label fields and their actions in the 800px
  settings pane, and show a visible “Enabled” label next to the switch. This
  fixes a 4px-wide URL input caused by the action row consuming the grid.
- SearXNG's `unresponsive_engines` are surfaced as `Search notes` in the settings
  preview, so an empty result caused by suspended engines is distinguishable from
  a genuinely empty search.

### Changed

- `pnpm release` now uses a narrow publint policy that ignores only the known
  `FILE_INVALID_FORMAT` verdict for `lib/client.js` (a DSH browser CJS factory)
  and reports every other diagnostic. The same check runs in CI.
- Package metadata now includes search keywords, `publishConfig.access: public`,
  and publishes `CHANGELOG.md` / `SECURITY.md` in the tarball.

### Verified

- M0 on DSH `0.2.1-rc.2`: Settings → Search Tools renders; Save writes
  `cordis.patch.yml`; authenticated routes return 401 without the browser
  cookie and 200 with it; probe/search-preview work against a mock SearXNG;
  search/fetch takeover and restore work; secret write stays out of YAML.
  Details: `docs/m0-verification.md`.
- A scripted model drove `web_research` through the real DSH agent loop and Web
  GUI: the tool executed against a mock SearXNG, fetched two public pages, wrote
  a `tool/result` with presentation meta, and rendered the card in the
  conversation (`2 sources`, `2 fetched`, source links, fetched details).
- 65 tests across 13 files, including settings-page, activation-hint,
  research-card, takeover-warning, diagnostics text, publint policy, and
  `web_research` pipeline tests (`pnpm test`).
- A live Web GUI pass on the new form UX: inline search test rendered two
  structured sources, the footer no longer covered the result, the zero-instance
  empty state and one-column Overview layout rendered correctly, `Copy
  diagnostics`/`diagnostics/clear` worked, and the activation hint rendered as a
  bordered card after disabling/re-enabling the bundle. Dark theme and a 700px
  narrow viewport also rendered correctly; tabs wrap instead of clipping.
- A live Web GUI pass on the product-polish surface: the picker rendered as a
  one-card radiogroup with `Configured`, `Refresh adapters` reported success, the
  research prompt rendered at 530×272 with current bounds, and at 700px the prompt
  reflowed to 382px without horizontal overflow. The same pass caught and fixed a
  4px-wide instance URL input caused by the action row consuming the instance
  grid; URL/label now render full width with actions below.
- A real authenticated SearXNG instance was probed and searched through the
  settings page: JSON API and Basic auth worked, 10 real sources rendered, and
  credentials stayed out of YAML (`Source: env`). With the instance's default
  engines suspended, the preview showed `Search notes`; selecting `bing` returned
  real results. Details: `docs/m0-verification.md`.
- A real OpenAI-compatible model (`agnes-3.0-flash`) called `web_research`,
  built-in `web_search`, and built-in `web_fetch` through the live Web GUI. The
  research turn returned 8 real SearXNG sources and fetched 2 pages (1,792 and
  868 chars); `web_search` used the taken-over provider; `web_fetch` returned
  HTTP 200 for example.com. The provider key stayed in the process environment,
  with no secret in YAML, the repository, or the three test-session logs (the
  chat transcript that supplied it is separate and should be treated as exposed).
  Details: `docs/m0-verification.md`.
- Final v0.1.0 gate: `pnpm release` passed with 65 tests / 13 files, host/client/
  type builds, a pack dry run, and no publint issues after the documented
  client-bundle exemption. `npm publish --dry-run` accepted the 99-file, 158.4 kB
  tarball, including `CHANGELOG.md` / `SECURITY.md`; publication itself remains
  pending npm authentication and a reachable repository remote.

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
