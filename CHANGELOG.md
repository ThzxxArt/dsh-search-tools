# Changelog

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
