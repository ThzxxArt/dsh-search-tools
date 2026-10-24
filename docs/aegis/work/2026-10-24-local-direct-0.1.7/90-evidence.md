# 0.1.7 Local Direct search — Evidence

Date: 2026-10-24 (Asia/Shanghai)

## Automated

- `pnpm release`: exit 0.
  - typecheck passed;
  - **240 passed / 8 skipped** (35 test files; 2 live files skipped by default);
  - host/client/types build passed;
  - `pnpm pack --dry-run` passed;
  - publint: no issues.
- `SEARCH_LIVE=1 pnpm vitest run tests/local-direct-live.spec.ts`: **3/3 passed**
  (real Impit worker, both engines, runtime fusion/probe, three-page
  `web_research`).
- `WIRE_LIVE=1 pnpm vitest run tests/wire-live.spec.ts`: **5/5 passed** after the
  shared-worker refactor.

## GUI (DSH 0.2.1-rc.2, profile `wiretest`, port 3082)

- Local Direct selected; engine checkboxes visible; no instance field.
- **Test engines** returned `DuckDuckGo` + `Bing` in ~1050ms.
- Real search test returned 10 sources in ~913ms.
- Save: header changed to “Search backend configured”; Overview showed
  **Search sources 2 / 2 sources**.
- Reload: Local Direct remained selected and configured.
- Takeover switch ran a passing real search and set the provider; disable
  restored the default provider.
- No page errors or console errors.
- Screenshots: `/tmp/local-direct-probe.png`, `/tmp/local-direct-query.png`,
  `/tmp/local-direct-overview-saved.png`, `/tmp/local-direct-reload.png`,
  `/tmp/local-direct-takeover.png`.

## Package

- Tarball `/tmp/dsh-search-tools-0.1.7.tgz` includes
  `lib/local-direct-worker.js` and `lib/wire-worker.js`.
- Installed into the `wiretest` profile as `dsh-search-tools@0.1.7`; GUI above
  ran from that install.
