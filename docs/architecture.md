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
    ├── searxng        first search adapter
    ├── readable-http  first fetch adapter
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
    fetch:
      adapter: readable-http
      adapters:
        readable-http:
          readability: true
    research:
      enabled: true
```

`search.search` and `fetch` are volatile sections; `adapters` is an open
dictionary. Adding an adapter does not require a core schema change. The adapter
owns its defaults and validation.

## Manifest-driven settings

Each adapter declares `AdapterManifest`:

- `id`, `label`, `description`
- `groups` (optional: `id`, localized `label`, optional `description`, and
  `advanced`)
- `fields` (`text`, `url`, `password`, `number`, `boolean`, `select`, `tags`,
  `instances`) with optional `group`, `advanced`, and `unit`
- `defaults`
- `secretRefs` with optional `group` / `advanced`
- `capabilities`

The Settings page fetches `/api/dsh-search-tools/adapters`, renders the selected
adapter's fields, and stores values in `adapters.<id>`. No page code changes when
a new adapter is registered. A manifest that does not declare groups falls back
to one configuration block; fields marked `advanced` without an advanced group
are placed in a generated disclosure. Group metadata is presentation-only and
does not change validation or the stored config shape.

External adapters can ship their own Client UI later; the host contract does not
require it. Whether takeover requires a non-empty instance list is decided from
the selected manifest's `instances` field, not a hard-coded SearXNG check.

## Host surface

| Route | Purpose |
|---|---|
| `GET /api/dsh-search-tools/status` | provider availability, YAML path, cache, credentials declared by every adapter manifest, recent errors |
| `GET /api/dsh-search-tools/adapters` | manifests for the settings page |
| `POST /api/dsh-search-tools/probe` | test one unsaved adapter config |
| `POST /api/dsh-search-tools/search-preview` | run one search with draft config |
| `POST /api/dsh-search-tools/fetch-preview` | run one fetch with draft config |
| `POST /api/dsh-search-tools/cache/clear` | clear the selected adapter cache |
| `POST /api/dsh-search-tools/diagnostics/clear` | clear the in-memory error ring |

Every route uses `connection.requestRejection`; bodies are JSON, bounded to
64 KiB, and secrets are never logged or returned.

## Settings entry

The browser half registers `settings.section` with id `search-tools`, so the
page appears as **Settings → Search Tools** next to General, Models, Plugins.
It registers only while DSH serves the `dsh-search-tools` settings namespace.

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
