# v0.1.3 release checklist

Date: 2026-10-23  
Package: `dsh-search-tools@0.1.3`  
npm: https://www.npmjs.com/package/dsh-search-tools  
DSH target: `0.2.1-rc.2` (`>=0.2.1-rc.2 <0.3.0`)  
Node target: `^22.19.0 || >=24.0.0`

Status: **gap-closing release.** Search, fetch, research, takeover, and
credential semantics are unchanged.

## What changed

- Search is split into Connection and Search behavior sub-tabs, with a compact
  current-backend summary and a Change backend action. The two sub-views measure
  772px / 928px at 564px content and 842px / 1,194px at 416px, excluding the
  global hero/tabs/action bar.
- Fetch results use a reader card with `CodeBlock`, Copy content, and
  Hide/Show content.
- Save conflicts render a distinct warning notice. Credential failures render
  as field-level errors with `aria-invalid` and clear when the user edits.
- The page is split into five tab components plus AdapterPicker, TestConsole,
  ResearchBudget, ResearchPrompt, SettingRows, Feedback, and settings-utils.
  `SettingsPage.tsx` is 691 lines instead of 1,421.
- The page reserves 104px bottom padding for the 54px/83px sticky action bar.
- The settings test file has 30 tests; the four new cases cover the fetch reader,
  credential field error, conflict notice, and unavailable/read-only states, and
  the existing tab test now also covers Home/End navigation. The package has 73
  tests in 13 files.
- Demo-data screenshots are in `docs/assets/` and linked from both READMEs.
- Version metadata, status, and default User-Agents report `0.1.3`.

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
| `pnpm test` | 73 tests / 13 files |
| `pnpm build` | host, client, and declarations emitted |
| `pnpm pack --dry-run` | tarball includes READMEs and the new client chunks |
| `pnpm check:publint` | no issues after the documented browser-factory exemption |
| `npm publish --dry-run` | npm accepts the payload |

## Real GUI acceptance

Use a real DSH settings modal, not a standalone React harness.

- 1440px viewport / 564px content, Light and Dark:
  - hero chips do not clip;
  - five top tabs remain one row;
  - Search Connection and Search behavior sub-tabs each keep their content
    under 1,000px;
  - Fetch reader shows content, Copy content, and Hide content;
  - the action bar has an opaque surface and 104px of page bottom padding.
- 700px viewport / 416px content, Light and Dark:
  - five tabs remain one row;
  - Search sub-views stay under 1,400px;
  - instance card, tags, and reader stay within the card;
  - action-bar actions wrap without overflow.
- 560px controlled content width:
  - Search sub-views remain inside the 1,000px target;
  - no horizontal overflow.
- Keyboard:
  - adapter cards, tabs, fields, disclosure summaries, instance actions, and
    action-bar buttons have visible focus;
  - Arrow/Home/End navigation works across the five tabs;
  - Enter/Space opens the advanced disclosure.
- State checks:
  - invalid instance and invalid credential states show red field-level errors;
  - conflict, read-only, unavailable, and loading notices are distinguishable;
  - search/fetch test success and failure remain visible in the console.
- Verify Chinese and English UI copy at the same widths.

Actual results and any remaining gaps are recorded in `docs/m0-verification.md`.

## Publish path

```sh
git tag -a v0.1.3 -m "dsh-search-tools v0.1.3"
git push origin main --follow-tags
```

The tag runs `.github/workflows/release.yml`, which repeats the release gate,
publishes with provenance using `NPM_TOKEN`, downloads the published registry
tarball, and attaches that exact file to the GitHub release.

## Post-publish smoke test

1. `npm view dsh-search-tools@0.1.3 version dist.tarball` returns the release.
2. Install in a fresh DSH profile and open **Settings → Search Tools**.
3. Confirm **Diagnostics** reports version `0.1.3`.
4. Run a search test, open a Fetch reader, and make one `web_research` call.
5. Confirm the README screenshots load from `docs/assets/`.

## Rollback

If the UI is broken, deprecate `0.1.3` and publish a fixed `0.1.4`. Do not
unpublish a version that users may already depend on.
