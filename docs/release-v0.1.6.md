# Release v0.1.6 — wire-http local fetch

## Scope

This release adds the opt-in `wire-http` fetch adapter:

- local Chrome/Firefox TLS + HTTP/2 fingerprinting through Impit;
- loopback egress guard with per-hop public-IP pinning;
- one-request worker isolation and deterministic cleanup;
- local Readability and PDF text extraction;
- no Reader, API key, browser, Docker, or system library;
- default `readable-http` and stable provider ids unchanged.

Out of scope: page JavaScript execution, login/paywall/CAPTCHA bypass, search
adapters, HTTP/3, and automatic fallback between adapters.

## Release gate

Run from a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
pnpm release
```

Required results:

- typecheck clean;
- default tests: 199 passed, 4 `WIRE_LIVE` tests skipped;
- `WIRE_LIVE=1 pnpm exec vitest run tests/wire-live.spec.ts` passes against
  `https://example.com/` and `httpbin.org` (real Impit worker, plain HTTP
  absolute-form, HTTP→HTTPS redirect, and full runtime);
- `lib/index.js` and `lib/wire-worker.js` exist;
- package tarball contains both files and `impit`/`pdfjs-dist` are declared
  runtime dependencies;
- `publint` clean.

## Manual acceptance

1. Install 0.1.6 into a fresh DSH profile and open **Settings → Search Tools →
   Fetch**.
2. Select **Wire HTTP**; confirm the local-only notice, no secret field,
   `html`/`pdf`/`probe`/`readability` capabilities, and default profile
   `chrome`.
3. Preview `https://example.com/`; expect HTTP 200 and a readable body.
4. Preview the local PDF fixture or a public PDF; expect text and a page cap.
5. Try `http://127.0.0.1/` and a private DNS target; expect
   `WIRE_TARGET_BLOCKED` before any worker connection.
6. Switch back to `readable-http` and `jina-reader`; confirm both still work and
   the default remains `readable-http`.
7. Check diagnostics for no `Authorization`, Cookie, API key, or query leakage.

## Known environment boundary

The real Impit path and real PDF extraction are covered by local tests against
`example.com` and a checked-in PDF fixture. A CI runner without outbound access
will skip the four `WIRE_LIVE` tests; this is an environment gap, not a product
fallback. No hosted Reader or external API is used by `wire-http`.

## Post-release

- Tag `v0.1.6` at the release commit; never move a published tag.
- Publish through the tag workflow so npm provenance is available.
- Keep 0.1.5 installable for rollback; adapter configs are additive.
