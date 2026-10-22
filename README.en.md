# dsh-search-tools

[English](README.en.md) · [简体中文](https://github.com/ThzxxArt/dsh-search-tools/blob/main/README.md)

[![npm](https://img.shields.io/npm/v/dsh-search-tools?label=npm)](https://www.npmjs.com/package/dsh-search-tools)
[![CI](https://github.com/ThzxxArt/dsh-search-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/ThzxxArt/dsh-search-tools/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/ThzxxArt/dsh-search-tools/blob/main/LICENSE)

Adapter-first web search and readable page fetching for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). Everything is configured in the DSH Web GUI under **Settings → Search Tools**; no hand-edited YAML is required.

> **Current version: 0.1.1 (2026-10-22).** This is a documentation and metadata refresh after 0.1.0. The feature surface is unchanged; the primary README is now complete Simplified Chinese and this file is the English counterpart. 0.1.0 was verified against a real DSH instance, a real SearXNG instance, real model tool turns, and the Web GUI; build, test, pack, and publint gates pass. Evidence is recorded in the [M0 verification note](https://github.com/ThzxxArt/dsh-search-tools/blob/main/docs/m0-verification.md).

---

## Contents

- [What it solves](#what-it-solves)
- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install and upgrade](#install-and-upgrade)
- [Quick start](#quick-start)
- [Settings page](#settings-page)
- [Configuration reference](#configuration-reference)
  - [Where configuration lives](#where-configuration-lives)
  - [SearXNG search settings](#searxng-search-settings)
  - [Readability HTTP fetch settings](#readability-http-fetch-settings)
  - [web_research settings](#web_research-settings)
  - [Takeover settings](#takeover-settings)
- [Model tools](#model-tools)
- [Security model](#security-model)
- [Adapter development](#adapter-development)
- [Local development](#local-development)
- [Release process](#release-process)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [License and third-party notices](#license-and-third-party-notices)

---

## What it solves

DSH ships built-in `web_search` and `web_fetch`, but the default backends do not fit every deployment. Some users already run SearXNG, some need search traffic to go through a proxy, and some want readable article text instead of raw HTML.

`dsh-search-tools` separates the backend from DSH core:

- Users pick a backend, enter instances, and test it in the Web settings page.
- The plugin registers **stable provider ids**, so swapping a backend never changes DSH's `web.searchProvider`.
- Adding a backend means registering an adapter; the settings page renders its manifest without page-code changes.
- An extra `web_research` tool performs search + top-N page fetch in one call for turns that need page content, not just links.

It does **not** provide a public search API, bypass logins or paywalls, execute page JavaScript, render a browser, or replace DSH's permission and sandbox model.

## Features

| Capability | Description |
|---|---|
| Stable search/fetch providers | `dsh-search-tools` and `dsh-search-tools-fetch` never change with the backend |
| Built-in search adapter | SearXNG: multiple instances, ordered/round-robin, failover, JSON/HTML, GET/POST, Bearer/Basic auth, proxy, cache, pagination, domain filters |
| Built-in fetch adapter | Readability HTTP: reuses DSH safe HTTP, extracts article text with Readability, can fall back to raw content |
| Research tool | `web_research`: search, fetch top N concurrently, per-page/total clipping, sources + readable content |
| Web settings page | Overview, Search, Fetch, Research, Advanced; inline tests, diagnostics, cache clear, keyboard save |
| Credential isolation | Search tokens go to DSH credentials, never YAML, logs, or diagnostic text |
| Takeover and restore | Optionally route built-in `web_search` / `web_fetch` through this plugin; restore the previous provider when disabled |
| External adapters | Register backends through `ctx.searchTools`; the settings page renders manifest fields generically |

## How it works

```text
DSH ctx.web
  searchProvider = "dsh-search-tools"         (stable)
  fetchProvider  = "dsh-search-tools-fetch"   (stable)
        │
        ▼
  SearchDispatcher / FetchDispatcher
        │ reads config.search.adapter / config.fetch.adapter
        ▼
  ctx.searchTools (adapter registry)
    ├── searxng         built-in search adapter
    ├── readable-http   built-in fetch adapter
    └── future adapters from independent packages
```

Key decisions:

1. **Stable provider ids, swappable adapters.** Adding a backend does not change `web.searchProvider` or require re-registering providers.
2. **Open config sections.** `search.adapters` and `fetch.adapters` are open dictionaries; each adapter owns defaults and validation, so the core schema does not grow per backend.
3. **Manifest-driven UI.** Host routes send adapter manifests to the browser; the page renders their `fields` generically. New adapters do not require React changes.
4. **Resolve config at call time.** The dispatcher selects the current adapter per call; switching backends does not require provider re-registration.

See [docs/architecture.md](https://github.com/ThzxxArt/dsh-search-tools/blob/main/docs/architecture.md) for details.

## Requirements

| Item | Requirement |
|---|---|
| DSH | `>=0.2.1-rc.2 <0.3.0` (verified against `0.2.1-rc.2`) |
| Node.js | `^22.19.0 || >=24.0.0` |
| Search backend | A reachable SearXNG instance; or keep DSH's default search |
| Fetch backend | Public `http(s)` pages; private addresses are blocked by DSH's SSRF protection |
| Browser | DSH Web GUI (the settings section is Web-only) |

DSH itself is preview software and its interfaces can change. The plugin pins its peer range to the verified `0.2.1-rc.2` line; read the [CHANGELOG](https://github.com/ThzxxArt/dsh-search-tools/blob/main/CHANGELOG.md) before upgrading DSH.

## Install and upgrade

### Option 1: Web UI (recommended)

1. Open the DSH Web GUI.
2. Go to **Plugins**.
3. Click **Add plugin**.
4. Enter the package name:

   ```text
   dsh-search-tools
   ```

5. Enable the bundle after installation.
6. Open **Settings → Search Tools**.

If the settings section appears, both the host and browser halves loaded.

### Option 2: CLI

```sh
dsh plugin --profile <profile> add dsh-search-tools
```

Replace `<profile>` with the target profile, then start it:

```sh
dsh --profile <profile>
```

### Option 3: Offline tarball

Download `dsh-search-tools-0.1.1.tgz` from [GitHub Releases](https://github.com/ThzxxArt/dsh-search-tools/releases), then:

```sh
dsh plugin --profile <profile> add ./dsh-search-tools-0.1.1.tgz
```

The tarball is byte-identical to the npm artifact and works on isolated networks.

### Upgrade

DSH plugins do **not** auto-update. To upgrade:

1. Turn off search/fetch takeover under **Settings → Search Tools → Overview** if it is enabled.
2. Remove the old version on the **Plugins** page.
3. Add `dsh-search-tools` again, or install the new tarball.
4. Re-enable it and check that configuration survived (it lives in the profile's YAML patch and normally survives a reinstall).
5. Re-run the search and fetch tests.

CLI equivalent:

```sh
dsh plugin --profile <profile> remove dsh-search-tools
dsh plugin --profile <profile> add dsh-search-tools
```

> Do not uninstall while takeover is still enabled. Built-in `web_search` would point at a provider that no longer exists until you reinstall the plugin or restore `web.searchProvider` manually.

### Post-install checks

- **Settings → Search Tools** shows all five tabs.
- **Advanced** shows the version, config path, and cache stats.
- The model should see `web_research` when the tool is enabled.
- Enable search takeover only after the search test passes.

## Quick start

### 1. Prepare SearXNG

You need a reachable SearXNG instance. Confirm:

- the address is an absolute `http(s)` URL, for example `https://searx.example.com`;
- for JSON API use, `search.formats` includes `json`;
- HTML-only instances work too: set **Response format** to `html`, or leave `auto`;
- if the instance requires auth, prepare a Bearer token or `username:password`;
- if it rate-limits your network, prepare multiple instances or a proxy.

The plugin trims a trailing `/search`, query, and hash from the instance URL. Embedded usernames/passwords are rejected.

### 2. Configure search

1. Open **Settings → Search Tools → Search**.
2. Choose `SearXNG` under **Backend**.
3. Click **Add instance** and enter the instance URL; the label is optional.
4. Adjust engines, categories, language, safe search, pages, result count, and timeouts as needed.
5. If the instance requires auth, choose `Bearer` or `Basic` and save the credential.
6. Click **Test** and confirm structured sources appear.
7. Click **Save and apply**.

### 3. Configure fetch (optional)

1. Open the **Fetch** tab.
2. Keep **Readability HTTP**.
3. Test a public page with the defaults, for example `https://example.com`.
4. If extraction is poor, adjust article bounds, response limits, or timeout; or disable Readability to use raw content.
5. Save after **Test** passes.

### 4. Enable takeover (optional)

On **Overview**:

- **Take over built-in search**: built-in `web_search` uses this plugin's search provider. The page runs a search test first; it will not take over if the test fails.
- **Take over built-in fetch**: built-in `web_fetch` uses this plugin's fetch provider.

Takeover writes DSH's `web.searchProvider` / `web.fetchProvider`. Turning it off restores the previous provider recorded in `activation.previousSearchProvider` / `previousFetchProvider`.

`web_research` does **not** require takeover. It calls the current DSH search/fetch providers; without takeover, it uses DSH defaults.

### 5. Use the model tools

In a model session:

- `web_search`: built-in DSH tool; uses this plugin after takeover;
- `web_fetch`: built-in DSH tool; uses this plugin after takeover;
- `web_research`: registered by this plugin; works without takeover but uses the current providers.

Example `web_research` arguments:

```json
{
  "query": "DeepSeek Harness release notes",
  "max_results": 8,
  "fetch_top": 3,
  "max_chars": 12000
}
```

The result contains `sources`, `fetched`, and `truncated`; the conversation card shows source count, successful fetches, fetch details, and truncation state.

## Settings page

### Overview

- Current search/fetch providers.
- Takeover state and quick toggles.
- Backend availability, instance count, cache size.
- Quick search test and fetch preview.
- Empty-state guide when no instance exists.

### Search

- Card-based adapter picker with description, capabilities, and configuration state.
- Instance editor: add, remove, move up/down, enable/disable, per-instance test.
- Manifest-rendered fields.
- Inline test with elapsed time, source title/link/snippet, and **Search notes** (for example, suspended SearXNG engines).
- Validation errors are field-scoped; a broken search draft does not block a fetch test.

### Fetch

- Fetch adapter picker and fields.
- Public URL preview.
- Status code, body kind, character count, truncation flag, and content preview.
- Private addresses are rejected by SSRF protection; this is expected.

### Research

- Enable/disable `web_research`.
- Default result count, max fetch count, default fetch count, per-page/total character budgets, concurrency, timeout.
- **Model-facing tool prompt** preview generated from the current draft.
- Disabling `web_research` removes the tool from the model after saving.

### Advanced

- Config file path.
- Cache size and hit/miss counts.
- Clear cache.
- Recent errors (ring buffer).
- Copy redacted diagnostics and clear errors.
- Current version.

### Keyboard and state

- `Cmd/Ctrl+S`: save and apply when the draft is valid and dirty.
- Tabs support `←` / `→` / `Home` / `End`.
- Save status, test results, and diagnostic actions are announced through `aria-live`.
- The page is read-only when a higher configuration layer overrides it; external edits produce a conflict and require reload.

## Configuration reference

### Where configuration lives

Configuration is written through DSH's native settings service into the current profile's YAML patch:

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

The shape is roughly:

```yaml
- id: dsh-search-tools
  name: dsh-search-tools
  config:
    search:
      adapter: searxng
      adapters:
        searxng:
          enabled: true
          instances:
            - url: https://searx.example.com
              enabled: true
              label: primary
          engines: []
          categories: [general]
          language: all
          safesearch: 1
          pages: 1
          maxResults: 10
          strategy: ordered
          method: GET
          format: auto
          auth:
            type: none
          requestTimeoutMs: 12000
          deadlineMs: 45000
          retries: 1
          cacheTtlMs: 300000
          cacheMaxEntries: 200
          userAgent: dsh-search-tools/0.1.1 (+https://github.com/ThzxxArt/dsh-search-tools)
          proxy: ""
          includeDomains: []
          excludeDomains: []
    fetch:
      adapter: readable-http
      adapters:
        readable-http:
          enabled: true
          readability: true
          minArticleChars: 200
          maxArticleChars: 200000
          maxResponseBytes: 5000000
          maxBodyChars: 2000000
          timeoutMs: 20000
          maxRedirects: 5
          userAgent: dsh-search-tools/0.1.1 (+https://github.com/ThzxxArt/dsh-search-tools)
          failOpen: true
    research:
      enabled: true
      maxResults: 8
      maxFetch: 8
      defaultFetchTop: 3
      maxCharsPerPage: 12000
      maxTotalChars: 40000
      concurrency: 3
      timeoutMs: 120000
    activation:
      previousSearchProvider: ""
      previousFetchProvider: ""
```

**Do not hand-edit this file to configure the plugin.** The settings page handles validation, section-scoped diffs, secret isolation, and conflicts. Hand edits can break YAML or be overridden by a higher layer.

Secrets do not enter YAML. The plugin resolves them through DSH credentials:

| Credential ref | Purpose | Format |
|---|---|---|
| `SEARXNG_TOKEN` | Bearer auth | raw token |
| `SEARXNG_BASIC_AUTH` | Basic auth | `username:password` |

Secret fields are write-only: the page shows only configured/unconfigured state and source, never the value. Tests use saved credentials; unsaved input is not sent.

### SearXNG search settings

| Field | Default | Range/values | Notes |
|---|---:|---|---|
| `enabled` | `true` | boolean | Disables the adapter |
| `instances` | `[]` | list | Tried in order; each has `url`, `enabled`, `label` |
| `engines` | `[]` | comma-separated | Empty uses instance defaults; e.g. `google, bing` |
| `categories` | `["general"]` | comma-separated | Empty omits the parameter and uses instance defaults |
| `language` | `all` | string | e.g. `zh-CN`, `en-US` |
| `safesearch` | `1` | `0` / `1` / `2` | Safe-search level |
| `timeRange` | empty | `day` / `week` / `month` / `year` | Time range |
| `pages` | `1` | 1–3 | Concurrent page requests; results are merged and deduplicated |
| `maxResults` | `10` | 1–20 | Maximum results returned per search |
| `strategy` | `ordered` | `ordered` / `round-robin` | Instance preference or rotation |
| `method` | `GET` | `GET` / `POST` | SearXNG request method |
| `format` | `auto` | `auto` / `json` / `html` | `auto` tries JSON, then HTML |
| `auth.type` | `none` | `none` / `bearer` / `basic` | Authentication mode |
| `requestTimeoutMs` | `12000` | 1000–120000 | Per-request timeout |
| `deadlineMs` | `45000` | 1000–300000 | Whole-search budget; must be at least the request timeout |
| `retries` | `1` | 0–5 | Retries per instance for retryable errors |
| `cacheTtlMs` | `300000` | 0–86400000 | Search cache TTL; `0` disables |
| `cacheMaxEntries` | `200` | 0–10000 | Cache capacity; `0` disables |
| `userAgent` | versioned default | non-empty, no newlines | Request UA |
| `proxy` | empty | `http(s)` URL | Proxy; must not contain credentials |
| `includeDomains` | `[]` | domain list | Keep matching domains; subdomain-aware |
| `excludeDomains` | `[]` | domain list | Drop matching domains; subdomain-aware |

Behavior:

- **Failover**: a failed instance falls through to the next; an error is raised only when all fail.
- **Retries and budget**: retries are bounded by `retries` and `deadlineMs`; no new instance is attempted after the budget expires.
- **JSON / HTML**: `auto` inspects the response, then falls back to HTML for instances that return an HTML challenge with HTTP 200.
- **Search notes**: SearXNG `unresponsive_engines` are preserved as notes. Zero results often means suspended engines or CAPTCHA, not a truly empty query.
- **Cache key**: query, instance list, engines, categories, language, safe search, time range, pages, strategy, method, format, and domain filters. Changing those naturally invalidates entries.
- **Domain filters**: applied before results become `sources`; `example.com` also matches `www.example.com`.

### Readability HTTP fetch settings

| Field | Default | Range | Notes |
|---|---:|---|---|
| `enabled` | `true` | boolean | Disables the adapter |
| `readability` | `true` | boolean | Use Readability for article extraction |
| `minArticleChars` | `200` | 0–100000 | Below this is not considered article text |
| `maxArticleChars` | `200000` | 1000–5000000 | Article cap; must be at least the minimum |
| `maxResponseBytes` | `5000000` | 1024–50000000 | Response byte cap |
| `maxBodyChars` | `2000000` | 1024–20000000 | Decoded character cap; must be at least the article minimum |
| `timeoutMs` | `20000` | 1000–120000 | Fetch timeout |
| `maxRedirects` | `5` | 0–10 | Redirect limit |
| `userAgent` | versioned default | non-empty, no newlines | Request UA |
| `failOpen` | `true` | boolean | Fall back to raw content when extraction fails |

Fetch behavior:

- Reuses DSH's safe HTTP provider, intended to block SSRF and private addresses.
- Handles `http(s)` URLs only.
- Parses text/HTML only; PDFs, images, and binaries are not converted to article text.
- Does not execute JavaScript; client-rendered pages may have no readable body.
- With `failOpen=true`, a Readability failure returns raw text/HTML instead of failing the whole fetch.

### web_research settings

| Field | Default | Range | Notes |
|---|---:|---|---|
| `enabled` | `true` | boolean | When off, the model does not see the tool |
| `maxResults` | `8` | 1–20 | Source cap; upper bound for `max_results` |
| `maxFetch` | `8` | 1–10 | Fetch cap; upper bound for `fetch_top` |
| `defaultFetchTop` | `3` | 0–10 | Default when the model omits `fetch_top`; must not exceed `maxFetch` |
| `maxCharsPerPage` | `12000` | 1000–200000 | Per-page cap; upper bound for `max_chars` |
| `maxTotalChars` | `40000` | 1000–500000 | Total content budget; must be at least the per-page cap |
| `concurrency` | `3` | 1–8 | Concurrent fetches |
| `timeoutMs` | `120000` | 5000–600000 | Tool timeout budget |

`web_research` clamps model arguments to these bounds and distributes `maxTotalChars` across pages. A failed page does not fail the whole call; it carries an `error` field, and the card still shows sources and successful fetches.

> **Timeout note:** the current `timeoutMs` value is used in the tool prompt preview; the registered tool timeout is fixed at `120000` ms. This is listed under known limitations.

### Takeover settings

Takeover is optional.

| Setting | Effect |
|---|---|
| `web.searchProvider = dsh-search-tools` | Built-in `web_search` uses this plugin's search provider |
| `web.fetchProvider = dsh-search-tools-fetch` | Built-in `web_fetch` uses this plugin's fetch provider |
| `activation.previousSearchProvider` | Search provider recorded before takeover; restored when disabled |
| `activation.previousFetchProvider` | Fetch provider recorded before takeover; restored when disabled |

Rules:

- Enabling search takeover runs a search test with the saved config first; it does not take over on failure.
- Fetch takeover does not force a test; test a public page on the Fetch tab first.
- If no previous provider was recorded, disabling takeover unsets the setting and returns to the DSH default.
- Disable takeover before disabling or uninstalling the bundle. The plugin detail page shows a takeover warning with a direct "disable takeover" action.

## Model tools

### Built-in `web_search` / `web_fetch`

These are DSH tools. The plugin does not replace their names or argument schemas; it only routes their providers:

- takeover off: they keep using DSH's providers, unaffected by this plugin;
- takeover on: requests enter this plugin's dispatcher and the selected adapter;
- takeover off again: the previous provider is restored.

### `web_research`

Registered by this plugin for turns that need page content, not only links.

| Argument | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | Search query |
| `max_results` | number | no | Source count, bounded by `maxResults` |
| `fetch_top` | number | no | Fetch top N; `0` returns sources only |
| `max_chars` | number | no | Per-page character budget, bounded by `maxCharsPerPage` |

Result shape:

```json
{
  "query": "example",
  "sources": [
    { "url": "https://example.com", "title": "Example", "snippet": "..." }
  ],
  "fetched": [
    {
      "url": "https://example.com",
      "title": "Example",
      "content": " readable markdown ...",
      "truncated": false
    }
  ],
  "truncated": false
}
```

Behavior:

- Searches through the current `ctx.web.search` and fetches through `ctx.web.fetch`.
- Fetches the top `fetch_top` results with `concurrency` workers.
- HTML pages go through Readability and Markdown conversion; plain text is used directly.
- Each page is clipped to `max_chars`; pages share `maxTotalChars`.
- A failed page carries `error` and does not fail the rest.
- The conversation card shows sources, successful/failed fetches, character counts, and truncation.
- External page content is **untrusted data**, not instructions. Neither the model nor the user should execute instructions found in a page.

## Security model

- **Authenticated settings routes.** Every `/api/dsh-search-tools/*` route passes DSH's `connection.requestRejection` fence; unauthenticated requests get 401/403.
- **Bounded request bodies.** JSON bodies are capped at 64 KiB; non-JSON requests get 415.
- **SSRF protection.** Fetching reuses DSH's `HttpFetchProvider`; private/reserved addresses are rejected. This is not a custom network stack.
- **No redirects for searches.** SearXNG requests use `redirect: 'error'`, so auth headers cannot follow a cross-origin redirect.
- **Credentials stay out of YAML.** Bearer/Basic secrets go to DSH credentials; YAML stores only `auth.type`. Diagnostics are redacted.
- **Proxies carry no credentials.** `proxy` must be an `http(s)` URL without username/password.
- **Limited error text.** Instance hostnames may appear in diagnostics, but query strings and credentials are stripped.
- **No telemetry.** The plugin sends no usage data to the author or a third party; search requests go only to the instances you configure.

Security still depends on DSH and your deployment. Do not expose the settings page to an untrusted network, and do not treat secrets in a shared profile as public configuration.

## Adapter development

> The external adapter contract is experimental in 0.1.x. Interfaces may change in a minor release; pin `dsh-search-tools` and run integration tests if you depend on it.

An adapter package does three things:

1. Inject `ctx.searchTools`.
2. Provide a manifest (for the settings page) and a runtime (actual search/fetch).
3. Register through `ctx.effect` so unload cleanup is automatic.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.searchTools.registerSearchAdapter(myAdapter),
    'my-search-adapter',
  )
}
```

`myAdapter` looks like:

```ts
const myAdapter = {
  manifest: {
    kind: 'search',
    id: 'my-search',
    label: { en: 'My Search', zh: '我的搜索' },
    description: { en: '...', zh: '...' },
    defaults: { endpoint: 'https://search.example.com' },
    capabilities: ['json', 'probe'],
    fields: [
      { kind: 'text', key: 'endpoint', label: { en: 'Endpoint', zh: '地址' } },
    ],
  },
  validate(rawConfig) {
    return { ok: true, issues: [] }
  },
  create(ctx, getConfig) {
    return {
      available: () => true,
      async search(request, signal) {
        return { sources: [], truncated: false }
      },
    }
  },
}
```

Conventions:

- Search adapter `id` values must be unique; `kind` is `search` or `fetch`.
- Config lives under `config.search.adapters.<id>` (or `fetch.adapters.<id>`); the adapter normalizes and validates it.
- `fields` supports `text`, `url`, `password`, `number`, `boolean`, `select`, `tags`, and `instances`.
- Declare secrets with `secretRefs`; values go through DSH credentials and must not be in manifest defaults.
- New adapters do not require settings-page code; the page renders manifest fields.
- v0.1.x does not support a fully custom adapter settings UI. An adapter can register its own `settings.section` in the future, but that is outside the unified page.
- External adapter localization currently uses the manifest's `label` / `description` text; built-in adapters have `zh` / `en` dictionaries.

`ctx.effect` returns a disposer. Do not keep global registration state outside `apply`; duplicate ids are rejected.

## Local development

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm typecheck
pnpm test
pnpm build
pnpm release
```

`pnpm build` emits:

```text
lib/index.js       Host half
lib/client.js      Browser lazy-CJS factory
lib/types/**       TypeScript declarations
```

Checks:

| Command | What it covers |
|---|---|
| `pnpm typecheck` | TypeScript |
| `pnpm test` | Vitest: host units, settings page/research card components, pipeline, publint policy |
| `pnpm build` | Host, browser, and declarations |
| `pnpm pack:check` | build + `pnpm pack --dry-run` + publint |
| `pnpm release` | typecheck + test + pack:check |

CI runs typecheck, test, build, pack dry-run, and publint on Ubuntu/Windows × Node 22/24. Publint ignores only `FILE_INVALID_FORMAT` for `lib/client.js`; DSH loads it as a browser CJS factory, not a Node ESM entry. Every other diagnostic fails.

### Project layout

```text
src/core/                 adapter types, registry, stable dispatchers, diagnostics
src/search/adapters/      SearXNG adapter (manifest/schema/client/parser)
src/fetch/adapters/       Readability HTTP adapter
src/research/             web_research pipeline, prompt, render, tool
src/host/                 authenticated settings routes
src/client/               Settings → Search Tools + research card
src/shared/               config, validation, diff, URL, limits
tests/                    host units + settings/research card component tests
docs/                     architecture, design, M0 verification, release checklist
```

### Why linkedom instead of jsdom

Readability runs inside the Host. `jsdom`'s `tr46` dependency calls `createRequire(...).resolve.paths`, which DSH's profile-resolution hook does not implement. `linkedom` is smaller and works inside the Host. `jsdom` remains a dev-only dependency for component tests.

## Release process

Before releasing:

- `package.json` version is `0.1.1`;
- `CHANGELOG.md` has the matching entry;
- `pnpm release` passes;
- the worktree is clean;
- npm auth works, or the repository has an `NPM_TOKEN` secret.

Local check:

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
pnpm pack --pack-destination dist
```

Tag and push:

```sh
git tag -a v0.1.1 -m "dsh-search-tools v0.1.1"
git push origin main --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`:

1. re-runs `pnpm release`;
2. checks whether the version is already published and skips if so;
3. publishes to npm with provenance using `NPM_TOKEN`;
4. attaches the tarball to the GitHub Release.

Manual publish:

```sh
npm publish --provenance --access public
```

After publishing, smoke-test a fresh profile: install, enable, configure SearXNG, run search and fetch tests, and make one `web_research` call. See the [v0.1.1 release checklist](https://github.com/ThzxxArt/dsh-search-tools/blob/main/docs/release-v0.1.1.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No "Search Tools" settings section | Bundle disabled; DSH version mismatch; client load failure | Enable it on the Plugins page; confirm DSH is `>=0.2.1-rc.2 <0.3.0`; check browser console/plugin logs |
| Search test 401/403 | Instance needs auth; credential not saved; Basic format is not `username:password` | Choose the right auth mode, save the secret, retry; confirm `Source: env` is expected |
| Search test 429 | Instance rate limit | Slow down, switch instance, raise cache TTL, or use another backend |
| Test passes but returns 0 results | SearXNG default engines are rate-limited/CAPTCHA | Check **Search notes**; set engines (for example `bing`) or switch instance |
| JSON parse failure | Instance does not serve JSON | Add `json` to SearXNG `search.formats`, or set format to `html` |
| `web_research is disabled` | Research tool off | Settings → Research → enable `web_research`, save |
| Research returns sources without content | `fetch_top=0`; fetch failed; page not readable | Raise `fetch_top`; inspect fetch `error`; test the URL on the Fetch tab |
| Private URL fetch fails | SSRF protection | Expected; do not try to bypass |
| Built-in search breaks after takeover | Bundle disabled/removed while takeover still points at it | Re-enable the plugin or disable takeover; the settings/plugin detail page has recovery actions |
| Save conflict | Config changed elsewhere or overridden by a higher layer | Click **Reload**; inspect the profile's `cordis.patch.yml` and overlays |
| Config is read-only | Higher layer overrides it | The page explains; edit the overriding layer or remove it |
| Duplicate instance URL | Same URL after normalization | Remove the duplicate; trailing `/search`, query, and hash are stripped |
| Proxy validation error | Not `http(s)`, or contains credentials | Use `http(s)://host:port` without username/password |
| Cache results are stale | TTL not expired | Clear cache on Advanced, or wait for TTL |
| No `web_research` after install | Tool disabled; model has not refreshed tools | Enable and save; start a new session or reload |
| npm install fails | Registry/network/peer mismatch | Check DSH/Node versions and npm registry; use the offline tarball |

Suggested diagnosis order:

1. **Settings → Advanced → Recent errors**;
2. **Search notes** (engine-level errors);
3. reproduce with **Test**, not only a model turn;
4. confirm takeover state and the active provider;
5. then inspect DSH and instance logs.

## Known limitations

- **One search adapter and one fetch adapter are built in.** The architecture supports more; 0.1.x does not ship Google/Bing/Exa or other commercial backends.
- **No auto-update.** Upgrade by removing and reinstalling.
- **The external adapter contract is experimental.** It may change in 0.1.x; pin versions for production integrations.
- **No browser rendering.** No JavaScript execution, login state, SPA, paywall, or CAPTCHA handling.
- **Text/HTML only.** PDFs, images, audio, and video are not converted to article text.
- **`web_research` is not a crawler.** It fetches the top N results only; no site traversal, graph deduplication, or deep crawling.
- **The research prompt preview is read-only.** No copy button; the tool description stays English to match what the model sees.
- **The research timeout field is not wired to tool registration.** `research.timeoutMs` currently appears only in the prompt budget preview; the actual `web_research` registration timeout is fixed at `120000` ms. Deployments that need a different timeout must wait for a later release or patch the code.
- **Takeover is a global provider switch.** It affects every `ctx.web` consumer in the DSH profile, not only this plugin.
- **Cache is in-process memory.** It is lost on restart and not shared across processes.
- **Narrow DSH preview compatibility.** Pinned to the `0.2.1-rc.2` line; run a regression before upgrading DSH.

## License and third-party notices

MIT. See [LICENSE](https://github.com/ThzxxArt/dsh-search-tools/blob/main/LICENSE).

Third-party components and licenses are listed in [THIRD_PARTY_NOTICES.md](https://github.com/ThzxxArt/dsh-search-tools/blob/main/THIRD_PARTY_NOTICES.md). Main runtime dependencies include `@mozilla/readability`, `linkedom`, `cheerio`, `turndown`, `@joplin/turndown-plugin-gfm`, `undici`, `lru-cache`, and `normalize-url`.

---

If this plugin helps you, open an issue or discussion on GitHub. For security reports, do not post tokens, instance passwords, or full configuration publicly.
