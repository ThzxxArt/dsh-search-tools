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
| Page renders | Overview / Search / Fetch / Research / Advanced tabs, adapter manifest fields, instance editor |
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

## Remaining

- Publish `0.1.0`: configure the repository remote, push the `v0.1.0` tag, and
  provide npm credentials or the release-workflow `NPM_TOKEN`.
- Additional adapter packages beyond SearXNG / Readability HTTP.
- Autonomous tool-selection evaluation; the real-model run named the tool under
  test.
