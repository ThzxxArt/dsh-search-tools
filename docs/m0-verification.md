# M0 verification — Settings section + YAML + routes

Date: 2026-10-22
DSH checkout: `/home/tianhao/deepseek-harness` (`0.2.1-rc.2`)
Test profile: `m0web` (fresh web-app template + local `dsh-search-tools-0.1.0.tgz`)
Web URL: `http://127.0.0.1:3091` (separate from the running GUI at `dsh.metona.cn`)

## Passed

| Check | Evidence |
|---|---|
| Package installs as a bundle | `dsh plugin --profile m0web add ...tgz`; package.json lists `dsh-search-tools` in `dsh.profile.bundles` |
| Client half loads | browser boot graph contains `dsh-search-tools/client.js`; no module-system error |
| Settings menu appears | Settings → **Search Tools** is in the left nav |
| Page renders | Overview / Search / Fetch / Research / Diagnostics (named Advanced in the 0.1.0 snapshot), adapter manifest fields, instance editor |
| YAML write | `~/.dsh/profiles/m0web/cordis.patch.yml` gained the `dsh-search-tools` entry after Save |
| YAML survives restart | after reloading the page, instance URL and adapter config are read back |
| Auth fence | `GET /api/dsh-search-tools/status` → 401 without cookie, 200 with cookie |
| Probe route | mock SearXNG `/config` returned `ok:true`, engines/categories |
| Search preview | mock JSON returned normalized sources + answer |
| Search takeover | test passed, `web.searchProvider` became `dsh-search-tools`; previous provider stored in `activation.previousSearchProvider` |
| Restore takeover | restoring set `web.searchProvider` back to `deepseek-official` and removed the override when it matched inherited config |
| Fetch takeover | `web.fetchProvider` became `dsh-search-tools-fetch`; restore removed the override |
| Secret write | UI wrote `SEARXNG_TOKEN` through `remote.credentials`; status reported `configured:true, source:file`; YAML contained no token |
| Per-instance test | Search tab “Test instance” showed `Connected · 9ms` against the mock |
| Readability extraction | Wikipedia article returned a 200k-char `data-dsh-readable="1"` body through linkedom |
| Empty instance list | `instances: []` validates; the page can stay installed but unconfigured (empty state added) |

## Bugs found and fixed during M0

1. **Credentials resolved too early.** `createAdapterContext` captured `ctx.get('credentials')` during `apply`, before the credentials service mounted in some orderings. The adapter now resolves credentials per call through `getCredentials()`.
2. **Credential remote response envelope.** `remote.credentials.describe()` returns `{ ok, value }`; the page initially treated it as a plain map, so the token showed “Not configured” after a successful save.
3. **No secret UI.** The manifest declared `secretRefs` but the page only rendered the auth-type select. Added write-only credential fields with status, save, and clear.
4. **Takeover without a test.** Search takeover now runs a search test with the saved draft and refuses to switch on failure; it also stores the previous provider.
5. **Empty config could not be saved.** Validation required at least one instance, trapping users who wanted to remove the last one. Empty lists are now valid; only an *active* takeover blocks removing all instances.
6. **Mixed-language page.** Page labels and adapter manifests now follow the active locale (`zh` / `en`); the manifest labels are localized instead of hard-coded Chinese.
7. **Static cache bounds.** The LRU is rebuilt when `cacheTtlMs` / `cacheMaxEntries` change; `cacheMaxEntries: 0` disables it.
8. **Proxy stub.** `search.proxy` now creates a lazy `undici.ProxyAgent` instead of being ignored.
9. **UA validation default.** Missing `userAgent` now validates against the adapter default rather than an empty string.
10. **Fetched count on failure.** The card counted attempted fetches as successes. It now shows `ok/total fetched` when any page failed and keeps the warning dot.
11. **Instance editor collapsed in the settings pane.** The action row's auto-width column consumed the instance grid, leaving the URL input 4px wide at the 530px card width. URL/label now stack full width and the actions sit below; a visible “Enabled” label was added beside the switch.

## Component tests (2026-10-22)

`pnpm test` now runs 61 tests across 12 files. The browser-facing additions:

| File | Coverage |
|---|---|
| `tests/research-card.spec.tsx` | settled card from presentation meta, fallback before result / missing meta, malformed source filtering, non-http link rejection |
| `tests/settings-page.spec.tsx` | render + save section ops, secret write through credentials (not the form), takeover requires a passing search test, localized invalid-instance message, research budget persistence, card picker/orphan/refresh states, research prompt bounds |
| `tests/takeover-warning.spec.tsx` | scoped package recognition and previous-provider restore from the Plugins page |
| `tests/research-pipeline.spec.ts` | real HTML extraction into Markdown, per-page failure isolation, clipping/total budget, disabled mode, presentation-meta projection |

`jsdom` is a **devDependency** only; the production Readability path still uses
linkedom. Component tests mock the DSH primitives to keep the page tests focused
on state transitions rather than CSS/shiki initialization.

## Live `web_research` replay (2026-10-22)

The real DSH agent loop and Web UI ran `web_research` end to end:

| Check | Evidence |
|---|---|
| Model request reaches the tool | scripted Messages server returned `tool_call_success` for `web_research` with `{ query, max_results: 3, fetch_top: 2 }` |
| Host executes the tool | `tool/call` and non-error `tool/result` landed in the session log |
| Search adapter runs | mock SearXNG returned two sources; `meta.sourceCount` was 2 |
| Fetch adapter runs | public pages were fetched; `meta.fetched` carried `chars: 12000` (Wikipedia) and `chars: 172` (example.com) |
| Card renders | conversation shows `2 sources`, `2 fetched`, both source links, and a `Fetched details` disclosure under **Called tools** |
| SSRF fence | a first run with `http://127.0.0.1` article URLs produced `Fetch failed: URL hostname "127.0.0.1" resolves to a non-public IP address`; this is DSH's safe-fetch policy doing its job |
| Replay persistence | after collapsing/reopening the session, the same card renders from the persisted `tool/result` meta |

The card sits inside the conversation's **Called tools** group; expand that group
to see it. This is the host UI's grouping, not a missing card.

The model here is scripted; it exercises the real loop, tool execution, event
log, and client card, but not a real model choosing `web_research` on its own.

## Form UX and visual pass (2026-10-22)

The settings page now has inline test panels on the Search and Fetch tabs, not only
on Overview. Results are structured rather than one text blob: elapsed time,
status, safe `http(s)` source links, snippets, and fetch metadata/content.

| Check | Evidence |
|---|---|
| Inline search test | Search tab → Test rendered `Test passed`, `Took 19ms`, two source links, and both snippets |
| Footer/pane layout | at the bottom of the scrolled pane, the last source ended above the action footer; no sticky overlay |
| Zero-instance empty state | after removing the instance and saving, Overview showed “No usable search backend yet” and “0 instances” |
| Overview layout | in the 800px settings pane the two takeover cards became one column (560px), with no overlapping labels |
| Advanced diagnostics | Version/config/cache/errors rendered; `Copy diagnostics` produced a credential-free summary; `POST /diagnostics/clear` returned `{ ok: true }` |
| Activation hint | disabling/re-enabling the bundle showed the hint; computed style had a real border/background and a 720px width |
| Adapter-driven rule | an external fixture adapter without an `instances` field did not trigger the instance-required error; the component test covers this |
| Section-scoped validation | an invalid search draft did not block the Fetch tab test; search fields no longer receive fetch errors with the same key |
| Dark theme | Settings → Search Tools rendered with the DSH dark tokens; cards, labels, inputs, and the action footer kept contrast |
| Narrow viewport | at 700px wide the fields/cards stacked and the tabs wrapped (`Advanced` moved to a second row) instead of clipping |

The activation hint sits in a slot outside the settings theme scope, so its CSS
uses token fallbacks and an explicit `dshst-activation` width. Without the
fallbacks the card rendered with transparent background and no border.

## Real SearXNG instance (2026-10-22)

A private authenticated instance was tested through the settings page, without
recording its address or credentials in this repository:

| Check | Evidence |
|---|---|
| Probe | `/config` reachable, JSON supported, Basic auth `ok`, 3.6s latency |
| Credentials | DSH reported `Configured · Source: env`; the secret was supplied through `SEARXNG_BASIC_AUTH` and never written to YAML |
| Real search | query `DeepSeek Harness`, engine `bing`, 10 normalized sources, 2.9s elapsed, links to deepseek.com / GitHub / runoob |
| Empty-engine behavior | with `engines: []`, the instance's default engines were suspended and returned no sources; the preview displayed `Search notes` listing `google: access denied`, `duckduckgo: CAPTCHA`, etc. |
| Engine selection | adding `bing` returned real results; the notes still list the unrelated suspended engines |
| UI | Test passed, sources rendered with titles/snippets, no secret in the form or YAML |

The default-engine empty result was initially indistinguishable from a genuinely
empty search. `parseSearxngJson` now carries `unresponsive_engines` as notes and
the settings preview renders them under **Search notes**.

## Live real-model validation (2026-10-22)

A real OpenAI-compatible model (`agnes-3.0-flash`, 512K context / 64K output)
drove three tool turns in the test profile. The provider used `apiKeyEnv`, so the
key stayed in the process environment and never entered YAML, the repository, or
the three test-session logs. (The chat message that supplied the key is a
separate transcript; treat that credential as exposed and rotate it.) The model's
`request/header` recorded `provider: agnes, model: agnes-3.0-flash`; the exposed
web tools were `web_fetch`, `web_research`, and `web_search`.

| Turn | Prompt | Evidence |
|---|---|---|
| `web_research` | search “DeepSeek Harness GitHub”, fetch the top 2 pages, then summarize | assistant emitted `web_research` with `{"query":"DeepSeek Harness GitHub","fetch_top":2}`; `tool/result` meta had `sourceCount: 8`, two `fetched` entries (`deepseek.com` 1,792 chars, download page 868 chars), `truncated: true` |
| `web_search` | use `web_search`, not `web_research`, for “DeepSeek Harness release notes” | built-in `web_search` emitted `{"queries":["DeepSeek Harness release notes"]}`; result meta contained 8 normalized sources from the real SearXNG instance |
| `web_fetch` | use `web_fetch`, not `web_research`, on `https://example.com` | built-in `web_fetch` emitted `{"url":"https://example.com"}`; result was HTTP 200, 290 chars, and the answer quoted `Example Domain` |

The research card rendered under **Called tools** with `8 sources`, `2 fetched`,
`truncated`, all source links, and the `Fetched details` disclosure. The three
turns completed in 29s, 14s, and 7s respectively; no provider error event was
logged.

The prompts named the tool under test, so this validates tool availability,
argument shape, real provider routing, and the UI end to end — not autonomous
tool selection under an ambiguous request. The provider key and the SearXNG
address/credentials are intentionally absent from this repository.

## Product polish (2026-10-22)

The provider picker is now a native radio group of adapter cards rather than a
`<select>`, and the Research tab previews the model-facing tool contract.

| Check | Evidence |
|---|---|
| Picker semantics | one `radiogroup` named “Backend”; the selected SearXNG card contains a native radio; description + capabilities render inside the card |
| Per-adapter status | the configured SearXNG instance rendered `Configured`; unconfigured and invalid drafts map to `Needs setup` / `Needs attention`; an orphaned adapter keeps a visible `Not installed` card |
| Refresh | `Refresh adapters` re-fetched `/adapters`; footer showed `Adapters refreshed`; a failed refresh keeps the previous list and shows the error |
| Research prompt | `web_research` description, `query/max_results/fetch_top/max_chars`, defaults/ranges, and total/concurrency/timeout limits rendered from the current draft |
| Prompt geometry | 530×272 in the 800px settings pane; 382px wide at a 700px viewport with no horizontal overflow; long text wraps inside the scrollable preview |
| Instance layout regression | live measurement before the fix: URL input `width: 4`; after the fix: URL and label render full width (280px in the final packaged smoke test) with the action row below |
| Narrow viewport | at 700px, fields stack, tabs wrap (`Advanced` on a second row), and the prompt remains readable |

The prompt preview is intentionally read-only and uses the draft values, not the
saved values, so changing a research bound updates the preview immediately. It
does not yet copy the prompt to the clipboard.

## Release closeout (2026-10-22)

- Package version is `0.1.0`; the changelog is dated and the README marks the
  release-candidate state.
- `pnpm release` passes with **65 tests / 13 files**, typecheck, host/client/type
  builds, and a pack dry run.
- The publint `lib/client.js` CJS/ESM verdict is handled by a narrow, tested
  policy: only that exact `FILE_INVALID_FORMAT` diagnostic is ignored, and every
  other publint diagnostic remains fatal.
- Package metadata now ships `CHANGELOG.md` / `SECURITY.md` and declares public
  npm access.
- Publication steps and post-publish smoke tests live in
  `docs/release-v0.1.0.md`.

## 0.1.2 UI/UX verification (2026-10-23)

Environment: real DSH `0.2.1-rc.2`, profile `m0web`, packaged
`dsh-search-tools@0.1.2` installed from the local tarball, Chromium via
Playwright, real SearXNG instance `https://hk.search.metona.cn`.

| Check | Evidence |
|---|---|
| Design tokens | The page no longer uses the 10 missing `--dsw-*` names. Light hint `#81858c`, error `#ec1313`; dark card `#2c2c2e`, action bar `#2c2c2e`, hint `#adb2b8`. |
| 1440px / 564px content | Five tabs rendered at 110px each on one row; no page/card horizontal overflow. Page heights: Overview 860, Search 1939, Fetch 1271, Research 1557, Diagnostics 739. |
| 700px / 416px content | Five tabs at 81px each on one row; no page/options horizontal overflow on any tab. Action bar 83px high; both actions fit within 412px. |
| Hero | Status chips wrap below the title at narrow widths; the status block stays inside the hero (564px: right 949 < hero right 1094; 416px: right 633 < hero right 650). |
| Search groups | Connection and Search behavior are visible; Advanced is a closed disclosure with 11 fields. Opening it shows Request method and the remaining transport/cache fields. |
| Error semantics | An empty enabled instance produces a red field error (`rgb(236, 19, 19)`), a red summary notice, `aria-invalid="true"`, and a disabled Save button. Hints stay tertiary. Search errors are not repeated on the Fetch tab; the action bar still reports invalid state and Save stays disabled. |
| Focus | Adapter card focus ring `rgb(65, 118, 230) solid 2px`; focused instance input border `rgb(65, 118, 230)`; Advanced summary gets the same 2px ring under keyboard navigation. |
| Instance layout | Instance card URL and label are full-width at 416px; test/reorder/delete actions wrap below. No input overflow. |
| Research | Research scope, Content budget, and Execution use a two-column field grid at 564px and one column at 416px. Budget shows 30% per-page share and `36,000 / 40,000 chars`. Prompt uses the DSH code font, `word-break: normal`, and scrolls inside 360px. |
| Prompt copy | Clicking Copy prompt writes the model-facing prompt to the clipboard and changes the button to Copied. |
| Live console | Search test passed in 2681ms with 10 structured sources and engine notes; fetch preview passed in 156ms with HTTP 200, HTML, 577 chars. |
| Locales | English and Simplified Chinese both render; Chinese tabs are 概览 / 搜索 / 抓取 / 研究 / 诊断, groups 连接 / 搜索行为. |
| Browser errors | No page errors or console errors during the measured flows. |

Not covered: physical touch devices, screen readers, non-Chromium engines, and a
fresh-profile install from the public npm registry (the package was installed
from the local tarball). The Search and Research pages remain long at 416px
because all required fields and instance/credential editors stay visible; the
earlier 1,000px Search-height target was not met without hiding controls.

## Publication (2026-10-23)

- `v0.1.2` tag points at `fa9e2e4`; CI on `main` and the Release workflow both
  completed successfully.
- npm `dsh-search-tools@0.1.2` is published and is the `latest` dist-tag.
- The GitHub Release `v0.1.2` has `dsh-search-tools-0.1.2.tgz` attached.
- npm registry and GitHub Release tarballs both hash to
  `8dbe193776a0e7748fb513a3511a4fca33cfdc56db50729c25ac426cf45871a8`.
- The published package was installed into `m0web` from
  `registry.npmjs.org`; the settings page reported `0.1.2`, all five tabs
  rendered, and there were no browser errors.

## 0.1.3 gap-closure verification (2026-10-23)

Environment: real DSH `0.2.1-rc.2`, profile `m0web`, local
`dsh-search-tools@0.1.3` tarball, Chromium via Playwright, demo data
(`https://searxng.example.com`, no real credentials).

| Check | Evidence |
|---|---|
| Search sub-tabs | Connection and Search behavior are separate panels; the current backend is a compact summary with a Change backend action. |
| Search heights at 564px content | Connection panel 772px; Search behavior panel 928px; both inside the 1,000px target. |
| Search heights at 416px content | Connection panel 842px; Search behavior panel 1,194px; both inside the 1,400px target. |
| Search heights at 560px content | Controlled 560px content width: Connection 772px; Search behavior 928px; no horizontal overflow. |
| Fetch reader | Real fetch preview renders `Page content`, Copy content, and Hide content. Copy writes the body; Hide removes the code block; Show restores it. Reader element 526×293. |
| Conflict state | Component test: rejected save renders the conflict text in the unsaved-state notice and the action bar remains enabled. |
| Credential error state | Component test: rejected `credentials.set` renders `vault locked` as a field-level alert and sets `aria-invalid="true"`. |
| Read-only / unavailable | Component test: unavailable status renders its notice and disables Save; ready + unwritable renders the overridden notice. |
| Keyboard | Adapter card 2px focus ring; field focus border; Arrow/Home/End tests for the five top tabs; Enter/Space on the native advanced disclosure. |
| Action bar | Page reserves 104px; real bar is 54px at 564px and 83px at 416px; final controls remain reachable. |
| Tests | 73 passed / 13 files; 30 settings tests, 8 new since 0.1.1. |
| Screenshots | `docs/assets/settings-overview.png`, `settings-search.png`, `settings-fetch-reader.png` use demo data. |

Not covered: injecting real credential-store and conflict failures into the live
profile; those two states are covered by component tests. The 560px case uses a
controlled content width, not a physical device. No screen-reader or non-Chromium
run in this round.

## 0.1.3 publication (2026-10-23)

- Tag `v0.1.3` points at `0e241d6`; Release workflow
  [39896837283](https://github.com/ThzxxArt/dsh-search-tools/actions/runs/39896837283)
  completed successfully.
- npm `dsh-search-tools@0.1.3` is published and is the `latest` dist-tag;
  publish time is `2026-10-23T03:40:49.353Z`.
- GitHub Release [v0.1.3](https://github.com/ThzxxArt/dsh-search-tools/releases/tag/v0.1.3)
  is published (not draft/prerelease) with `dsh-search-tools-0.1.3.tgz`.
- The npm and GitHub tarballs are both 219,425 bytes and hash to
  `d779fb0eb01fd56175c9c503086fb86ab960ca35d636fd9257cb6eee71f04890`.
- The first release run failed at the registry-download step while npm was still
  catching up. The workflow now retries the `npm view` and download together;
  the rerun succeeded.

## 0.1.4 configuration and search/fetch verification (2026-10-23)

Environment: real DSH `0.2.1-rc.2`, profile `m0web`, local
`dsh-search-tools@0.1.4` tarball, Chromium via Playwright, a local SearXNG mock
on `127.0.0.1:8899`, and `https://example.com/` for fetch.

| Check | Evidence |
|---|---|
| Version / tabs | Diagnostics reports `v0.1.4`; Overview, Search, Fetch, Research, Diagnostics all render. |
| Status truth | Hero chip `Fetch: available`; Diagnostics `Fetch: available · Research: registered`; `/status` returns `fetch.available=true`, `research.registered=true`. |
| Fetch probe | `POST /api/dsh-search-tools/probe` with `kind=fetch` returns `{ok:true,statusCode:200,contentType:"html",readable:false,latencyMs:134}` for the short `example.com` page; no `FETCH_PROBE_UNSUPPORTED`. |
| Numeric validation | Setting Pages to 4 renders two `Pages cannot be larger than 3.` alerts, `aria-invalid=true`, and disables Save. |
| Prompt copy | Copy prompt writes the model-facing prompt to the clipboard and changes the button to Copied. |
| Search request headers | Mock log: `ua=dsh-search-tools/0.1.4-gui`, `al=zh-CN,zh;q=0.9`, `format=json`, plus engines/categories/language/safesearch. |
| Cache TTL 0 | Set Cache TTL to 0 in the real GUI, then run the same query twice; the mock receives exactly two requests. Restored to 300000 afterwards. |
| Search success | Search test returns `Test passed`, one source link, and `GUI result`/`GUI snippet`; no console errors. |
| Fetch preview | `https://example.com/` returns HTTP 200, `html`, 577 chars, Page content, Copy content, Hide content. |
| Responsive | 700px and 560px viewports report page `scrollWidth === clientWidth` (416/416 and 276/276 content); no horizontal overflow. |
| Console | No page errors or console errors across the GUI run. |
| Tests | `pnpm test`: 119 tests / 19 files (109 at the first 0.1.4 round). |
| Build | `pnpm build`: host, client, declarations pass. |

Not covered in this GUI round: a real SearXNG instance (the mock validates request
shape/headers but not engine quality), real credential-store/conflict injection,
physical 560px device, screen reader, and non-Chromium engines. Those remain
evidence gaps, not passes.

## 0.1.4 gap-closure verification (2026-10-23)

Environment: real DSH `0.2.1-rc.2`, profile `m0web`, rebuilt
`dsh-search-tools@0.1.4` tarball, Chromium via Playwright, local SearXNG mock
on `127.0.0.1:8899`, `https://example.com/`, and a scripted Messages-compatible
model on `127.0.0.1:8897` for the research timeout path.

| Check | Evidence |
|---|---|
| Version / status | Diagnostics `v0.1.4`; `Fetch: available · Research: registered`; no page/console errors |
| Host validation | `POST /search-preview` with draft `pages:4` returns `ok:false`, `code:"SEARCH_CONFIG_INVALID"`, message `pages: Pages不能大于 3`; the dispatcher rejects before creating a runtime |
| Draft result cap | `POST /search-preview` with draft `maxResults:17` against a 20-result mock returns exactly 17 sources and `truncated:true` |
| Format fallback | Search test with query `format-fallback` shows `Format fallback result`; mock log records JSON 403 followed by an HTML request |
| Research timeout | Real DSH loop + scripted model, `timeoutMs=5000`; session `c1096f01-a269-402e-a623-5319f37a2027` records `tool/result` `Error: tool call timed out after 5000ms` with error `TOOL_TIMEOUT`; internal `WEB_RESEARCH_TIMEOUT` is covered by `tests/research-timeout.spec.ts` |
| Search probe | `probeSearxng` integration tests cover configured POST and a hanging request bounded by `requestTimeoutMs` |
| Tests | `pnpm test`: 119 tests / 19 files, pass |
| Build | `pnpm build`: host, client, declarations pass |

The research timeout evidence uses a scripted model to exercise the real DSH
tool loop and event log; it is not a real-model selection run. The timeout
observed at the GUI boundary is the tool-wrapper `TOOL_TIMEOUT`; the pipeline's
own abort path is separately asserted to return `WEB_RESEARCH_TIMEOUT`.

Still not covered: real SearXNG engine quality, real credential/conflict
injection, physical 560px device, screen reader, and non-Chromium engines.

## 0.1.4 publication (2026-10-23)

- Release workflow
  [39914636598](https://github.com/ThzxxArt/dsh-search-tools/actions/runs/39914636598)
  completed successfully; `publish` job succeeded.
- npm `dsh-search-tools@0.1.4` is the `latest` dist-tag on
  `https://registry.npmjs.org`.
- GitHub Release
  [v0.1.4](https://github.com/ThzxxArt/dsh-search-tools/releases/tag/v0.1.4)
  is published with `dsh-search-tools-0.1.4.tgz`.
- npm and GitHub tarballs are both 239,240 bytes and hash to
  `4da7625d6a17d46b2bbebb0cbb53a65947d6c1dc0dbb23c3cb5d0b65c35f41b9`.
- `main` CI run
  [39914616653](https://github.com/ThzxxArt/dsh-search-tools/actions/runs/39914616653)
  completed successfully.

## 0.1.5 Jina Reader implementation and GUI verification (2026-10-23)

Environment: real DSH `0.2.1-rc.2`, profile `m0web`, local
`dsh-search-tools@0.1.5` tarball, Chromium 140 via Playwright, and a local fake
Jina Reader at `127.0.0.1:8898`. The fake validated the request and returned
synthetic `data.content`; it is not a hosted Jina success claim.

| Check | Evidence |
|---|---|
| Version / tabs | Diagnostics reports `v0.1.5`; Overview/Search/Fetch/Research/Diagnostics render. |
| Adapter discovery | Fetch tab shows `Readability HTTP` and `Jina Reader`; Jina cards show `browser`, `pdf`, `probe`; the manifest notice is visible. |
| Jina request | Fake Reader saw `POST /`, `accept: application/json`, `content-type: application/x-www-form-urlencoded`, `user-agent: dsh-search-tools/0.1.5…`, `x-engine: browser`, `x-respond-with: markdown`, `x-timeout: 59` (local timeout 60000 minus one second), `x-no-cache: true`, `x-robots-txt: dsh-search-tools`, and body `url=https%3A%2F%2Fexample.com%2F`. |
| Response modes | Real GUI switched Response format through HTML, text, and Markdown; all three returned `Test passed` with the corresponding `data.html` / `data.text` / `data.content` payload. Contract tests also cover missing mode fields → `JINA_BAD_RESPONSE`. |
| Jina result | Real GUI shows `Test passed`, HTTP 200, text, 113 chars, and the rendered `# Fake Jina Reader` reader card; no console/page errors. |
| API key chain | Saved `test-jina-key` in the UI; fake Reader saw `authorization: Bearer test-jina-key`; the value did not enter the config form; clearing the secret returned the field to `Not configured`. |
| Config persistence | Changed Reader timeout to 61000, saved, reloaded; the field read back 61000. |
| Adapter switch | Switched to `Readability HTTP`, saved, reloaded (selected); switched back to `Jina Reader`, saved, reloaded (selected + notice). |
| Public-target guard | GUI fetch of `http://127.0.0.1/admin` fails with `target "http://127.0.0.1/admin" resolves to a non-public address`; no Reader request is made. |
| Endpoint validation | Draft `http://reader.example.com` sets `aria-invalid=true` and disables Save and apply. |
| Host timeout wiring | Slow fake path (31s) with draft `timeoutMs=60000`: GUI returns `Test passed` after 31,200ms; a 30s fixed route would have failed. |
| Live Jina reachability | Switching the draft endpoint to `https://r.jina.ai/` and testing anonymous yields `Jina Reader rejected the credentials (HTTP 401)` in 588ms; this validates error mapping, not success. |
| Responsive | 700px and 560px: `scrollWidth === clientWidth` (700/700, 560/560); no horizontal overflow. |
| Tests | `pnpm test`: 155 tests / 22 files, pass. Coverage includes Markdown/HTML/text mode fields, missing-mode errors, blocked-target/no-fetch, content-length oversize, Retry-After dates, mid-resolution timeout, Jina → `web_research` clipping, `JINA_API_KEY` status, and the documented `curl` engine. |
| Typecheck / build / pack | `pnpm typecheck`, `pnpm build`, `pnpm pack:check`, and `pnpm release` pass. |

`X-Timeout` is a Reader wait budget, not a hard deadline; the adapter sends it
one second below `timeoutMs`, while the local `AbortController` enforces the
actual deadline. Target 404 preservation depends on a Reader-supplied
`data.warning` (primarily Markdown mode). Redirect/browser-navigation hops after
the pre-flight guard are Reader-side residual risk; self-hosted Reader egress
must be restricted.

The local fake and unit tests cover the protocol, UI, security guard, key
handling, response modes, and timeout chain. **Not covered:** hosted Jina HTTP
200 with a real key, a real self-hosted Jina Reader, real SearXNG quality,
physical 560px device, screen reader, non-Chromium browsers, or a real-model
`web_research` selection run. Those remain evidence gaps, not passes.

## Remaining

- Hosted Jina (real API key) and self-hosted Jina Reader success-path verification.
- Additional adapter packages beyond SearXNG / Readability HTTP / Jina Reader.
- Autonomous tool-selection evaluation; the real-model run named the tool under
  test.
