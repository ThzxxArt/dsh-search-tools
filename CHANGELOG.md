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
