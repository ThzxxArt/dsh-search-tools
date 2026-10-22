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

## Component tests (2026-10-22)

`pnpm test` now runs 41 tests across 10 files. The browser-facing additions:

| File | Coverage |
|---|---|
| `tests/research-card.spec.tsx` | settled card from presentation meta, fallback before result / missing meta, malformed source filtering, non-http link rejection |
| `tests/settings-page.spec.tsx` | render + save section ops, secret write through credentials (not the form), takeover requires a passing search test, localized invalid-instance message, research budget persistence |
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

## Still to verify / implement

- A real model choosing `web_research` after takeover (the scripted model above exercised the same loop, but not model judgment).
- Full form UX polish (preview/diagnostics are still basic).
- Visual pass for the `plugins.bundle.activation` hint and the zero-instance empty state.
