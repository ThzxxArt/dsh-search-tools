# v0.1.5 release checklist

Date: 2026-10-23<br>
Package: `dsh-search-tools@0.1.5`<br>
npm: https://www.npmjs.com/package/dsh-search-tools/v/0.1.5<br>
GitHub Release: https://github.com/ThzxxArt/dsh-search-tools/releases/tag/v0.1.5<br>
DSH target: `0.2.1-rc.2` (`>=0.2.1-rc.2 <0.3.0`)<br>
Node target: `^22.19.0 || >=24.0.0`<br>
Status: **published 2026-10-23.** npm `0.1.5` is the `latest` dist-tag; the
GitHub Release is published from the `v0.1.5` tag. The npm publish used the
operator token and has no provenance; the tag workflow skipped npm because the
version already exists.

## What changed

- New opt-in `jina-reader` fetch adapter:
  - POSTs `url=<target>` to a Jina Reader-compatible endpoint;
  - supports `auto`/`browser`/`curl` engines, Markdown (`data.content`),
    HTML (`data.html`), and text (`data.text`) output,
    CSS wait/extract/remove selectors, iframe, Shadow DOM, no-cache,
    robots.txt, image/link retention, locale, target User-Agent, Reader proxy,
    and hosted or self-hosted endpoints;
  - stores `JINA_API_KEY` in DSH credentials only;
  - rejects non-HTTP(S), credential-bearing, private/loopback/link-local,
    IPv4-compatible transition, and non-public-DNS targets before sending;
  - maps 401/403 → `JINA_AUTH`, 429 → `JINA_RATE_LIMIT`, 5xx → `JINA_HTTP`,
    timeout → `JINA_TIMEOUT`, bad JSON → `JINA_BAD_RESPONSE`, and envelope
    overflow → `JINA_RESPONSE_TOO_LARGE`; Retry-After hints are capped at one
    hour.
- Generic `manifest.notice` and `browser`/`pdf` capabilities; the notice is
  rendered by the existing `AdapterForm`.
- Fetch preview/probe route signals now follow the draft `timeoutMs`
  (30s/30s base, +5s, 190s cap), so a 60s Jina draft is not cut at 30s.
- `X-Timeout` is sent one second below the local `timeoutMs` because it is a
  Reader wait budget, not a hard deadline; the local AbortController enforces
  the actual deadline.
- `responseMode=html` reads `data.html` and `responseMode=text` reads
  `data.text`; Markdown reads `data.content`. HTML/text request
  the selected mode only. Target status comes from `data.warning`, then the
  official `data.httpStatus`, then the optional `data.statusCode`; a warning or
  `httpStatus` wins over a misleading compatibility field, and only
  all-three-missing is unrecoverable.
- Target redirects/navigations are a residual Reader-side risk; self-hosted
  Reader egress must be restricted.
- Default fetch adapter remains `readable-http`; stable provider ids unchanged.
- Version/User-Agent `0.1.5`; `ipaddr.js` direct dependency.

## Code gate

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
```

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` | 163 tests / 22 files, pass |
| `pnpm build` | host, client, declarations pass |
| `pnpm pack --dry-run` | package includes Jina adapter declarations and READMEs |
| `pnpm check:publint` | no issues |
| `git diff --check` | pass |
| Version | `0.1.5` in package, routes, default UAs |

## Real GUI evidence

Real DSH `0.2.1-rc.2`, profile `m0web`, local 0.1.5 tarball, Chromium 140 via
Playwright, fake Reader at `127.0.0.1:8898` (synthetic content).

| Check | Actual |
|---|---|
| Adapter cards | `Readability HTTP` and `Jina Reader`; Jina has `browser`, `pdf`, `probe` and the data-boundary notice |
| Fetch success | `Test passed`, HTTP 200, text, 113 chars, synthetic reader card |
| Request shape | `POST /`; correct `accept`, content-type, UA, `x-engine: browser`, `x-respond-with: markdown`, `x-timeout: 59` (local timeout 60000 minus one second), `x-no-cache: true`, `x-robots-txt`, and `url=...` body |
| Response modes | GUI switched HTML/text/Markdown; all three `Test passed`; provider tests verify `data.html`/`data.text`/`data.content`, warning/httpStatus/statusCode precedence, and missing-field errors |
| Request modes | Markdown sent `x-respond-with: markdown`; HTML/text sent `html`/`text` with no content companion |
| Non-2xx target | GUI `https://example.com/missing` showed `Test failed` with `HTTP 404` |
| Real DSH tool | Scripted mock LLM called the real `web_fetch`; the UI rendered `Fetch https://example.com/` and completed with `DONE` |
| Key write/read | `JINA_API_KEY` wrote via credentials; fake saw `authorization: Bearer test-jina-key`; clearing returned to `Not configured` |
| Config persistence | Changed Reader timeout to 61000 and saved; after full page reload it read back 61000 |
| Adapter switch | Switched to `Readability HTTP`, saved, reloaded (selected); switched back to `Jina Reader`, saved, reloaded (selected + notice) |
| Private target | GUI shows `resolves to a non-public address`; no request |
| Invalid endpoint | `aria-invalid=true`; Save disabled |
| 31s success | Slow fake path returns in 31,200ms with 60s draft; old 30s route would fail |
| Live Jina | anonymous `https://r.jina.ai/` returns HTTP 401 in 588ms, mapped to `JINA_AUTH` |
| Responsive | 700/700 and 560/560 scroll/client widths; no console/page errors |
| Version | Diagnostics `0.1.5`; `Fetch: available`, `Research: registered` |

Screenshot: [settings-fetch-jina.png](assets/settings-fetch-jina.png).

## Not covered

- Hosted Jina HTTP 200 with a real API key.
- A real self-hosted Jina Reader container.
- Reader-side redirect/browser-navigation hops to private destinations; the
  pre-flight guard cannot pin them, so self-hosted Reader egress must be
  restricted.
- Real SearXNG engine quality, physical 560px device, screen reader, and
  non-Chromium browsers.
- npm provenance: this manual token publish has no provenance; the tag workflow
  skips npm because `0.1.5` already exists.

## Actual publication (2026-10-23)

- `pnpm release` passed before publication: 163 tests / 22 files, typecheck,
  build, pack, and publint.
- `npm publish --access public` published `dsh-search-tools@0.1.5`; the registry
  read model reports it as the `latest` dist-tag.
- The publish used the operator npm token and has no provenance.
- GitHub Release
  [v0.1.5](https://github.com/ThzxxArt/dsh-search-tools/releases/tag/v0.1.5)
  is published (not draft/prerelease) with
  `dsh-search-tools-0.1.5.tgz`.
- Release workflow
  [39959869420](https://github.com/ThzxxArt/dsh-search-tools/actions/runs/39959869420)
  completed successfully; its `publish` job succeeded. The npm guard skipped
  the already-published version, then downloaded the registry tarball and
  attached it to the release.
- The registry and GitHub tarballs are both 279,183 bytes and hash to
  `aeef97f15448a17dab76c623fb2dea9aa897858ba6ac448b7d4541b9f8f0deed`.
- The published tarball installs into a clean temporary npm prefix:
  `dsh-search-tools@0.1.5`, 73 packages, no install-time error.
- `main` CI run
  [39959868916](https://github.com/ThzxxArt/dsh-search-tools/actions/runs/39959868916)
  completed successfully.

## Publish steps (when credentials are available)

1. Confirm `package.json` is `0.1.5` and the worktree is clean.
2. Run `pnpm release`.
3. Preferred: `git tag -a v0.1.5 -m "dsh-search-tools v0.1.5" && git push origin main --follow-tags`;
   the tag workflow publishes to npm with provenance and attaches the registry
   tarball to the GitHub Release.
4. If publishing manually, run `npm publish --access public`; a local publish
   does not attach provenance.
5. Verify npm `0.1.5` is `latest` and the GitHub Release tarball hash matches npm.
6. In a fresh DSH profile, select `readable-http` and `jina-reader` separately and
   run a fetch test and one `web_research` call.

If the release is broken, deprecate `0.1.5` and publish a fixed `0.1.6`; do not
move the published tag.
