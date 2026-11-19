# Release v0.1.10 — DSH 0.2.2 authentication compatibility

DSH target: `^0.2.2-rc.5`<br>
Node target: `>=24.9.0`

v0.1.10 is a compatibility release, not a search or fetch feature release. It
keeps the 0.1.9 adapters, provider ids, tool schemas, default engines, and
saved configuration unchanged.

## Why this release

DSH 0.2.2-rc.2 moved browser admission into WebServer's `auth` policy and
removed `Connection.requestRejection`. The settings routes in v0.1.9 still
called `requestRejection` on every request, so on the current host the
authenticated status, adapter, probe, preview, cache, and diagnostics routes
threw `TypeError: connection.requestRejection is not a function`.

The 0.2.2-rc.5 package on npm is older than the current checkout: its typings
still expose `requestRejection` and do not declare `auth`. A one-sided change
would therefore either keep the crash on the current host or remove the
Host/Origin fence on the published host. v0.1.10 keeps both contracts:

- every route declares `auth: 'required'` for current DSH; older hosts ignore
  the extra property;
- `connection.requestRejection` is still called when the host exposes it;
- a host with neither seam does not register the routes at all.

## Changes

- Settings routes now declare `auth: 'required'` and use an optional legacy
  request fence. Route registration is type-compatible with both the published
  rc.5 typings and the current checkout.
- Added route-contract tests for a current host without the legacy method and
  for a legacy host that still has it. The tests assert the `auth` declaration,
  not only the old fake method.
- DSH baseline is `^0.2.2-rc.5`; Cordis is `~4.1.0`; Schemastery is `~3.19.0`.
- Node baseline is `>=24.9.0`. CI and Release verify Node 24.9 and 24 on Ubuntu
  and Windows; the host build target is Node 24.
- Removed the unused `@deepseek-ai/dsh-invariants` dev dependency, which pulled
  an older Cordis copy into the lockfile.
- Rebuilt the browser bundle with the 0.2.2-rc.5 client packages. The bundle
  keeps its explicit style effect; it does not depend on the optional Client
  module `meta` contract.
- Version metadata and default User-Agents report `0.1.10`.

## Verification

- `pnpm release`: passed (typecheck + coverage + build + package + publint).
- Tests: **424 passed / 10 skipped** across 54 files; the two live files are
  skipped unless their environment gates are enabled.
- Coverage: statements **91.93%**, branches **86.33%**, functions **92.45%**,
  lines **95.69%** — all above the 85% gate.
- Live gate: `SEARCH_LIVE=1 WIRE_LIVE=1` — **10/10 passed**, including
  Local Direct DuckDuckGo/Bing/Brave/360 and Wire HTTP/PDF/research paths.
- `pnpm build`: host and client rebuilt; `check:package` found all eight
  required artifacts; `publint` reported no issues.
- The built client requires only `react`, `react/jsx-runtime`, and
  `@deepseek-ai/dsh-client-ui-primitives`.

## Compatibility boundaries

- **Not installed into the running profile.** This verification covers source,
  tests, the built bundle, and the package tarball. It does not claim a fresh
  GUI installation on the current profile.
- **No manual browser click-through.** The settings component tests, live slot
  inspection, build, and package checks pass; a post-publish install smoke test
  still belongs in the release checklist.
- **Older hosts remain supported only through the same build.** The legacy
  fence is retained for 0.2.1-era hosts; the primary verified baseline is
  0.2.2-rc.5.
- **No engine changes.** Brave/360 behavior, Local Direct worker isolation,
  SearXNG, Readability, Wire HTTP, Jina Reader, and research semantics are
  unchanged.

## Upgrade notes

1. Upgrade DSH to `0.2.2-rc.5` or a compatible 0.2.2 build.
2. Use Node.js 24.9 or newer.
3. Install `dsh-search-tools@0.1.10`; no configuration migration is required.
4. Reopen Settings → Search Tools and run one search/fetch probe. If an older
   page still shows the previous client bundle, refresh the page so the new
   browser artifact is loaded.

## Release status

Source version is `0.1.10`. The tag-triggered release workflow re-runs the
verification matrix, publishes the package to npm when absent, and attaches the
registry tarball to this GitHub Release.
