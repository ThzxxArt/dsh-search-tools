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

## Component tests (2026-10-22)

`pnpm test` now runs 37 tests across 9 files. The browser-facing additions:

| File | Coverage |
|---|---|
| `tests/research-card.spec.tsx` | settled card from presentation meta, fallback before result / missing meta, malformed source filtering, non-http link rejection |
| `tests/settings-page.spec.tsx` | render + save section ops, secret write through credentials (not the form), takeover requires a passing search test, localized invalid-instance message, research budget persistence |
| `tests/takeover-warning.spec.tsx` | scoped package recognition and previous-provider restore from the Plugins page |

`jsdom` is a **devDependency** only; the production Readability path still uses
linkedom. Component tests mock the DSH primitives to keep the page tests focused
on state transitions rather than CSS/shiki initialization.

## Still to verify / implement

- `web_research` card with a **live** DSH `tool/result` replay. The component-level replay now covers the presentation-meta shape and malformed input.
- Full form UX polish (preview/diagnostics are still basic).
- `web_search` through the actual model/tool call after takeover (the stable dispatcher is unit-tested and the host selection is persisted; the full model turn was not exercised).
- Visual pass for the `plugins.bundle.activation` hint and the zero-instance empty state.
