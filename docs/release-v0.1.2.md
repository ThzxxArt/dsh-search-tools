# v0.1.2 release checklist

Date: 2026-10-23  
Package: `dsh-search-tools@0.1.2`  
npm: https://www.npmjs.com/package/dsh-search-tools  
DSH target: `0.2.1-rc.2` (`>=0.2.1-rc.2 <0.3.0`)  
Node target: `^22.19.0 || >=24.0.0`

Status: **Published 2026-10-23.** UI/UX release. Search, fetch, research,
takeover, and credential behavior are unchanged.

## What changed

- The settings surface now uses the DSH light/dark design tokens
  (`--dsw-alias-*`), including the settings card material, semantic error and
  hint colors, focus rings, and the code font.
- New page shell: hero status summary, equal-width segmented tabs, section
  cards, sticky action bar, and a single-column layout at 416px content width.
- Adapter manifests may declare optional `groups`, and fields may declare
  `group`, `advanced`, and `unit`. Manifests without groups still render one
  configuration block.
- SearXNG now renders Connection, Search behavior, and collapsed Advanced
  groups. Readability HTTP renders Extraction and Safety limits.
- Instances are cards with per-instance status, testing, reordering, and
  removal; the Add instance action is a dashed row.
- Research now has Research scope, Content budget, Execution, and a
  model-facing prompt card with a copy action.
- The former Advanced tab is now Diagnostics: runtime facts, configuration path,
  cache action, and a recent-error timeline.
- Error summary, loading, unavailable, and read-only notices use semantic tones.

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
| `pnpm test` | 69 tests / 13 files |
| `pnpm build` | host, client, and declarations emitted |
| `pnpm pack --dry-run` | tarball includes `README.md`, `README.en.md`, and the compatibility `README.zh.md` |
| `pnpm check:publint` | no issues after the documented browser-factory exemption |
| `npm publish --dry-run` | npm accepts the payload |

## Real GUI acceptance

Use a real DSH settings modal, not a standalone React harness.

- 1440px viewport / 564px content width, Light and Dark:
  - hero chips do not clip;
  - five tabs remain one row;
  - Search, Fetch, Research, and Diagnostics render without horizontal overflow;
  - the sticky action bar has an opaque surface and does not hide the final
    actions when scrolled to the end.
- 700px viewport / 416px content width, Light and Dark:
  - tabs remain one row;
  - fields, tags, instance card, and prompt code block stay within the card;
  - the action bar wraps its buttons rather than overflowing.
- Keyboard:
  - focus is visible on adapter cards, tabs, fields, disclosure summaries,
    instance actions, and the action bar;
  - arrow/Home/End navigation works across the five tabs;
  - the advanced disclosure opens with Enter/Space.
- State checks:
  - invalid instance and invalid credential states show a red field-level
    error and are distinguishable from hints;
  - search/fetch test success and failure are visible in the test result;
  - read-only, loading, unavailable, and conflict notices remain readable.
- Verify Chinese and English UI copy at the same widths.

Actual results and any remaining gaps are recorded in `docs/m0-verification.md`.

## Publish path

```sh
git tag -a v0.1.2 -m "dsh-search-tools v0.1.2"
git push origin main --follow-tags
```

The tag runs `.github/workflows/release.yml`, which repeats the release gate,
publishes with provenance using `NPM_TOKEN`, downloads the published registry
tarball, and attaches that exact file to the GitHub release. The release asset
therefore matches the npm artifact byte for byte.

## Post-publish smoke test

1. `npm view dsh-search-tools@0.1.2 version dist.tarball` returns the release.
2. Install in a fresh DSH profile and open **Settings → Search Tools**.
3. Confirm **Diagnostics** reports version `0.1.2`.
4. Confirm the 416px settings pane keeps the five tabs on one row.
5. Run a search test, a fetch preview, and one `web_research` call.

## Rollback

If the UI is broken, deprecate `0.1.2` and publish a fixed `0.1.3`. Do not
unpublish a version that users may already depend on.
