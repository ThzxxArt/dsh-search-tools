# Architecture: adapter-first

> This note records the v3 direction implemented by the skeleton. The longer
> `design-v0.1.0.md` keeps the UI/product detail; where the two differ on
> provider selection, this note wins.

## Stable providers, swappable adapters

```text
DSH ctx.web
  searchProvider = "dsh-search-tools"        (stable)
  fetchProvider  = "dsh-search-tools-fetch"  (stable)
        │
        ▼
  SearchDispatcher / FetchDispatcher
        │ reads search.adapter / fetch.adapter from Config
        ▼
  ctx.searchTools (adapter registry)
    ├── searxng        built-in search adapter (default)
    ├── local-direct   built-in search adapter (fixed DDG + Bing origins)
    ├── readable-http  built-in fetch adapter (default, DSH safe HTTP)
    ├── wire-http      built-in fetch adapter (optional, local browser-grade HTTP + PDF)
    ├── jina-reader    built-in fetch adapter (optional, Reader rendering)
    └── future packages
```

Adding a backend never changes `web.searchProvider`. It registers an adapter and
the user selects it in Settings. Old adapter configuration stays in YAML, so
switching back does not lose it.

## Config is open by section

```yaml
- id: dsh-search-tools
  name: dsh-search-tools
  config:
    search:
      adapter: searxng
      adapters:
        searxng:
          instances: [...]
        local-direct:
          # Optional: so360. Defaults remain duckduckgo, bing.
          engines: [duckduckgo, bing]
          maxPerHost: 2
    fetch:
      adapter: readable-http
      adapters:
        readable-http:
          readability: true
        wire-http:
          profile: chrome
          pdf: true
        jina-reader:
          endpoint: https://r.jina.ai/
          engine: auto
    research:
      enabled: true
```

`search` and `fetch` are volatile sections; `adapters` is an open
dictionary. Adding an adapter does not require a core schema change. The adapter
owns its defaults and validation.

## Manifest-driven settings

Each adapter declares `AdapterManifest`:

- `id`, `label`, `description`
- `groups` (optional: `id`, localized `label`, optional `description`, and
  `advanced`)
- `fields` (`text`, `url`, `password`, `number`, `boolean`, `select`, `tags`,
  `checkboxes`, `instances`) with optional `group`, `advanced`, and `unit`
- `defaults`
- `notice` (optional localized data-boundary/service warning, rendered above the form)
- `secretRefs` with optional `group` / `advanced`
- `capabilities` (`json`, `html`, `probe`, `cache`, `pagination`, `readability`,
  `browser`, `pdf`)

The Settings page fetches `/api/dsh-search-tools/adapters`, renders the selected
adapter's fields, and stores values in `adapters.<id>`. No page code changes when
a new adapter is registered. A manifest that does not declare groups falls back
to one configuration block; fields marked `advanced` without an advanced group
are placed in a generated disclosure. Group metadata is presentation-only and
does not change validation or the stored config shape.

External adapters can ship their own Client UI later; the host contract does not
require it. Whether takeover requires a non-empty instance list is decided from
the selected manifest's `instances` field, not a hard-coded SearXNG check.
Instance-less adapters use `checkboxes` values for the source count and can
probe through the same `/probe` route.

## Host surface

| Route | Purpose |
|---|---|
| `GET /api/dsh-search-tools/status` | provider availability, YAML path, cache, `search.sources` (instances or enabled engines), credentials declared by every adapter manifest, recent errors |
| `GET /api/dsh-search-tools/adapters` | manifests for the settings page |
| `POST /api/dsh-search-tools/probe` | test one unsaved adapter config |
| `POST /api/dsh-search-tools/search-preview` | run one search with draft config |
| `POST /api/dsh-search-tools/fetch-preview` | run one fetch with draft config |
| `POST /api/dsh-search-tools/cache/clear` | clear the selected adapter cache |
| `POST /api/dsh-search-tools/diagnostics/clear` | clear the in-memory error ring |

Every route uses `connection.requestRejection`; bodies are JSON, bounded to
64 KiB, and secrets are never logged or returned. `fetch-preview` and the fetch
branch of `probe` derive their signals from the draft `timeoutMs`
(30s/30s base, +5s, 190s cap); the search preview/probe branches do the same
from `deadlineMs` (falling back to `requestTimeoutMs`), so a valid 60s Local
Direct draft is not cut to 20/30s. DSH's own `web_fetch` 30s tool timeout
remains an outer bound outside this plugin.

## Settings entry

The browser half registers `settings.section` with id `search-tools`, so the
page appears as **Settings → Search Tools** next to General, Models, Plugins.
It registers only while DSH serves the `dsh-search-tools` settings namespace.

## Search security boundaries

`searxng` sends the query to the instance(s) configured by the user; those may be
private or loopback by design. It uses `redirect: 'error'`.

`local-direct` has no configurable endpoint. It constructs URLs only for
`https://html.duckduckgo.com` and `https://www.bing.com`, pins those origins in
tests, and sends `followRedirects:false` + `redirect:'manual'`. It sends no
Cookie/Authorization, executes no page JavaScript, and raises
`LOCAL_DIRECT_ALL_FAILED` rather than falling back to another backend.

Parsing, ad removal, redirect unwrapping, RRF fusion, per-host diversity, and
caching are local. A one-shot worker owns the native Impit client; it is
terminated on reply, error, abort, and deadline, including request-clone and
abort-race failures. Per-engine failures are data (partial result + `notes`),
not a reason to fail the other engine; if the deadline stops a retry after one
engine already succeeded, that partial result is returned rather than throwing.

`web_research`'s search phase follows the selected search adapter; its fetch
phase still requires public pages, so local/private result URLs are not read.

## Fetch security boundaries

`readable-http` delegates to `@deepseek-ai/dsh-web-fetch-http`, which resolves
public addresses and pins the connection through a per-request Undici agent. Its
SSRF boundary is DSH's, not this plugin's.

`jina-reader` is an external-Reader adapter. It:

1. rejects non-HTTP(S), credential-bearing, loopback/private/link-local,
   IPv4-compatible transition addresses, and non-public-DNS targets before sending;
2. sends `POST <endpoint>/` with the target in the form body, never as an
   authorization-bearing redirect;
3. requires HTTPS for remote endpoints; plain HTTP is loopback-only;
4. resolves `JINA_API_KEY` per request from DSH credentials/environment and never
   returns it in errors or diagnostics.

The Reader resolves the target again and may follow redirects or browser
navigations, so the target guard is best-effort, not a connection-level pin.
Hosted Jina sends the target URL off-machine and may cache it; only a
self-hosted Reader keeps the page local, and its egress still needs restricting.
This is documented in the manifest `notice` and README/SECURITY.

`wire-http` is a local adapter and a connection-level pin:

1. it parses the initial target with the shared `shared/public-target.ts` owner;
2. it starts a loopback HTTP proxy on `127.0.0.1:0`; every CONNECT/HTTP hop
   resolves DNS, requires every answer to be public, and connects to one
   validated IP without re-resolving the hostname;
3. it runs `impit` inside a one-request worker; the worker is terminated on
   success, failure, abort, and timeout;
4. it reads HTML through the shared Readability path and PDF through a lazy
   `pdfjs-dist` text extractor, with page/byte/character caps;
5. it does not execute page JavaScript, send cookies/Authorization, or fall
   back to another adapter. SPA content remains the job of `jina-reader` or a
   future opt-in browser backend.

The worker boundary exists because Impit's native client has no close/dispose
API. A worker per request makes cleanup deterministic; no persistent native
client or socket can survive into the next fetch. HTTP/3 is deliberately out of
scope because the TCP guard cannot pin it.

## Extension path

An adapter package:

```ts
export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.searchTools.registerSearchAdapter(adapter), 'my adapter')
}
```

The registry rejects duplicate ids and wrong `kind`. The dispatcher resolves the
selected adapter at call time, so enabling an adapter does not require a
provider re-registration.
