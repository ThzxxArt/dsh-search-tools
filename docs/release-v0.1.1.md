# v0.1.1 release checklist

Date: 2026-10-22  
Package: `dsh-search-tools@0.1.1`  
npm: https://www.npmjs.com/package/dsh-search-tools  
DSH target: `0.2.1-rc.2` (`>=0.2.1-rc.2 <0.3.0`)  
Node target: `^22.19.0 || >=24.0.0`

Status: **documentation and metadata release.**

## What changed

- `README.md` is the complete Simplified Chinese guide.
- `README.en.md` is the complete English guide.
- `README.zh.md` is kept only as a compatibility pointer.
- The npm package includes `README.md` and `README.en.md`; `README.zh.md` remains
  a compatibility pointer and may be auto-included by npm's README handling.
- Version metadata, the settings status endpoint, and the default User-Agents
  report `0.1.1`.
- No runtime feature changes from `0.1.0`.

## Verification

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
npm publish --dry-run
```

Expected:

| Check | Expected |
|---|---|
| `pnpm typecheck` | no errors |
| `pnpm test` | 65 tests / 13 files |
| `pnpm build` | host, client, and declarations emitted |
| `pnpm pack --dry-run` | tarball includes `README.md`, `README.en.md`, and the small `README.zh.md` pointer (npm auto-includes `README*`) |
| `pnpm check:publint` | no issues after the documented browser-factory exemption |
| `npm publish --dry-run` | npm accepts the payload |

Functional evidence from 0.1.0 remains in `docs/m0-verification.md`. This release
does not change the search, fetch, research, settings, or security behavior.

## Publish path

```sh
git tag -a v0.1.1 -m "dsh-search-tools v0.1.1"
git push origin main --follow-tags
```

The tag runs `.github/workflows/release.yml`, which repeats the release gate,
publishes with provenance using `NPM_TOKEN`, and attaches the tarball to the
GitHub release.

## Post-publish smoke test

1. `npm view dsh-search-tools@0.1.1 version dist.tarball` returns the release.
2. Confirm the npm package page shows the Chinese README and links to
   `README.en.md`.
3. Install in a fresh DSH profile through **Plugins → Add plugin**, enable it,
   and open **Settings → Search Tools**.
4. Confirm **Advanced** reports version `0.1.1`.
5. Run a search test and one `web_research` call to confirm no regression.

## Rollback

This is a documentation release; rollback is usually unnecessary. If the package
is broken, deprecate `0.1.1` and publish a fixed `0.1.2`. Do not unpublish a
version that users may already depend on.
