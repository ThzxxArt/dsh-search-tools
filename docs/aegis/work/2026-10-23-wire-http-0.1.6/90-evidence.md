# 0.1.6 wire-http local browser-grade fetch adapter - Evidence


## EvidenceBundleDraft: release

- Artifact key: release-final
- Slice ID: release
- Type: test-report
- Source: /tmp/wire-release-final2.log
- Summary: pnpm release exit 0; 199 passed, 4 live skipped, build includes lib/wire-worker.js, pack/publint pass
- Verifier: pnpm release
- Evidence status: evidence-finalized

## EvidenceBundleDraft: live

- Artifact key: live-wire
- Slice ID: live
- Type: integration-test
- Source: WIRE_LIVE=1 pnpm exec vitest run tests/wire-live.spec.ts
- Summary: Real Impit worker, plain HTTP absolute-form, HTTP→HTTPS redirect, and full runtime fetched example.com through the egress guard; all pass
- Verifier: vitest
- Evidence status: evidence-finalized

## EvidenceBundleDraft: pdf

- Artifact key: pdf-real
- Slice ID: pdf
- Type: test-report
- Source: tests/pdf.spec.ts and tests/wire-provider.spec.ts
- Summary: Real PDF fixture extracts Hello PDF; empty/invalid PDF paths fail explicitly
- Verifier: vitest
- Evidence status: evidence-finalized

## EvidenceBundleDraft: gui

- Artifact key: gui-wire
- Slice ID: gui
- Type: manual-ui
- Source: /tmp/wiretest-wire-fetch.png and /tmp/wiretest-saved.png
- Summary: DSH test profile 0.2.1-rc.2 shows Wire HTTP fields/notice/no secret, example.com preview HTTP 200, private target rejected, save and reload persist wire-http
- Verifier: Playwright
- Evidence status: evidence-finalized
