# 0.1.6 wire-http post-audit closure

This record closes the gaps found after the first 0.1.6 verification pass. It
does not rewrite the earlier evidence; it records the corrected behavior and
fresh commands.

## Code and contract corrections

- URL fragments are rejected twice: in `WireHttpRuntime.fetch()` before any
  native code starts (an HTTPS fragment never reaches a CONNECT line), and in
  the absolute-form egress parser. Both paths have regression tests.
- All known NAT64 forms are rejected, including public-embedded
  `64:ff9b::/96` and local-use `64:ff9b:1::/48`. Network-specific NAT64
  prefixes remain an explicit residual boundary; README, CHANGELOG, and the
  plan no longer claim they are enumerable.
- The timeout plan text now matches the implementation: the default is 25s,
  below DSH's 30s tool budget, and the schema permits 180s only when the DSH
  tool timeout is raised.

## Fresh evidence (2026-10-24)

- `pnpm typecheck` — clean.
- `pnpm test` — **203 passed / 5 skipped** across 28 passed files plus the
  skipped live file.
- `WIRE_LIVE=1 pnpm exec vitest run tests/wire-live.spec.ts` — **5/5 passed**,
  including a three-page `web_research` over wire-http.
- `tests/pdf.spec.ts` — a generated real three-page PDF proves
  `pagesRead=2`, `totalPages=3`, and `truncated=true` at a two-page cap.
- `tests/wire-native.spec.ts` — the Impit native binding loads on the current
  Linux x64 platform.
- Real Agnes model tool loop: `agnes-3.0-flash` emitted a `web_fetch` tool call
  for `https://example.com/`; wire-http returned HTTP 200 with readable text;
  the tool result was returned to the model, which answered with the page title
  **Example Domain**. `agnes-2.5-flash` also answered its direct smoke prompt.
  The API key was passed through the environment only.

## Environment boundary

- The DSH headless integration with the supplied Agnes key was attempted with
  an Anthropic Messages provider. The gateway's streaming response did not
  produce a terminal Anthropic stop event, so DSH reported `TRANSPORT:
  Anthropic stream ended without a stop reason`; the direct Messages tool loop
  above is the model evidence, not a claim that DSH's headless provider path was
  validated.
- Fresh DSH GUI verification on 0.2.1-rc.2 with the rebuilt `wiretest` profile:
  Settings → Search Tools → Fetch shows Wire HTTP selected and Configured;
  the authenticated `fetch-preview` route returned HTTP 200 with 244 readable
  characters for `https://example.com/`, rejected `http://127.0.0.1/` with
  `WIRE_TARGET_BLOCKED` in 0 ms, and rejected
  `https://example.com/#section` with `WIRE_INVALID_TARGET` in 0 ms. No page or
  console errors. Screenshot: `/tmp/wiretest-audit-wire-http.png`.
