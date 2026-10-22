# v0.1.0 release checklist

Date: 2026-10-22  
Package: `dsh-search-tools@0.1.0`  
DSH target: `0.2.1-rc.2` (`>=0.2.1-rc.2 <0.3.0`)  
Node target: `^22.19.0 || >=24.0.0`

Status: **release candidate; local checks pass, publication pending.**

## What ships

- Host half (`lib/index.js`), browser client (`lib/client.js`), and declarations.
- `cordis.patch.yml`, `locale/{en,zh}.json`, `icon.svg`.
- README (English/Chinese), CHANGELOG, SECURITY, LICENSE, and third-party notices.
- Stable providers `dsh-search-tools` / `dsh-search-tools-fetch`, the built-in
  SearXNG search adapter, Readability HTTP fetch adapter, and `web_research`.
- Settings page, research card, activation hint, and takeover warning.

## Verification

Run from a clean install:

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
```

The release gate covers:

| Check | Expected |
|---|---|
| `pnpm typecheck` | no errors |
| `pnpm test` | 65 tests / 13 files |
| `pnpm build` | host, client, and type declarations emitted |
| `pnpm pack --dry-run` | package contents include `lib`, locale, patch, docs, license, notices |
| `pnpm check:publint` | no issues after the documented browser-factory exemption |
| `npm publish --dry-run` | npm accepts the payload without uploading |

The publint wrapper ignores only `FILE_INVALID_FORMAT` for `lib/client.js`.
DSH loads that file through its browser module loader as a CJS factory; it is not
a Node ESM entry. All other publint diagnostics fail the check. The exemption is
unit-tested in `tests/publint-policy.spec.ts`.

Functional evidence is recorded in `docs/m0-verification.md`, including the real
DSH agent loop, real SearXNG search, real model tool turns, settings visual pass,
and the research card.

## Publication prerequisites

1. The repository URL in `package.json` must resolve to the repository being
   released (`https://github.com/ThzxxArt/dsh-search-tools`).
2. A git remote for that repository must be configured and `main` must be pushed.
3. npm authentication with publish rights for `dsh-search-tools`, or an
   `NPM_TOKEN` repository secret used by `.github/workflows/release.yml`.
4. The version in `package.json` must be `0.1.0` and the tag must be `v0.1.0`.

The release workflow requires `contents: write` and `id-token: write`; it
publishes with provenance and attaches the tarball to a GitHub release.

## Publish path

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
pnpm pack                       # optional local artifact
git tag -a v0.1.0 -m "dsh-search-tools v0.1.0"
git push origin main --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which repeats `pnpm release`,
publishes to npm with provenance, and creates the GitHub release. The workflow
checks the exact package version first and skips the npm step when that version
already exists, so a manual publish followed by a tag push still produces the
GitHub release without a duplicate-version failure. If publishing manually, run
`npm publish --access public` only after the same checks pass. Do not publish from
a dirty worktree.

## Post-publish smoke test

1. `npm view dsh-search-tools@0.1.0 version dist.tarball` returns the release.
2. In a fresh DSH profile, install `dsh-search-tools` through **Plugins → Add
   plugin**, enable it, and open **Settings → Search Tools**.
3. Save a SearXNG instance, run **Test** on Search and Fetch, and confirm a real
   search returns sources.
4. Run one `web_research` call and confirm the card renders sources and fetched
   details.
5. Confirm credentials remain out of `cordis.patch.yml`.

## Rollback

Prefer `npm deprecate dsh-search-tools@0.1.0 "<reason>"` and publish a fixed
patch. Unpublish only if npm policy allows it and no dependent release exists;
the tag and GitHub release should remain for traceability unless the release is
actively harmful.

## Known limitations

- v0.1.0 ships one search adapter (SearXNG) and one fetch adapter (Readability
  HTTP); the adapter contract is the extension point.
- The Research prompt preview is read-only and does not copy to the clipboard.
- Provider selection in the real-model run named the tool under test, so this
  validates tool availability and routing, not autonomous tool selection under an
  ambiguous prompt.
- DSH itself is preview software; the peer range is intentionally pinned to the
  verified `0.2.1-rc.2` line.
