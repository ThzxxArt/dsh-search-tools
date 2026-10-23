# 0.1.6 wire-http local browser-grade fetch adapter - Intent

## TaskIntentDraft

- Requested outcome: Implement and verify the complete 0.1.6 wire-http fetch adapter with PDF extraction, public-target pinning, worker isolation, settings UI integration, tests, and docs; no partial features or dangling links.
- Goal: Implement and verify the complete 0.1.6 wire-http fetch adapter with PDF extraction, public-target pinning, worker isolation, settings UI integration, tests, and docs; no partial features or dangling links.
- Success evidence:
- none
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- Browser JavaScript rendering; login/paywall/CAPTCHA bypass; search adapter; HTTP/3.
- Scope: 0.1.6 wire-http adapter end to end: shared public-target guard, loopback egress proxy, worker transport, schema/manifest/provider, PDF text, settings validator, docs/notices, tests and release gate. Default adapter and stable provider ids remain unchanged.
- Change kinds:
- feature
- Risk hints:
- high

## BaselineReadSetHint

- src/core/types.ts
- src/core/host-types.ts
- src/core/dispatchers.ts
- src/fetch/adapters/jina-reader/provider.ts
- src/shared/defaults.ts
- src/client/settings-utils.ts

## BaselineUsageDraft

- Required baseline refs:
- src/core/types.ts
- src/core/host-types.ts
- src/core/dispatchers.ts
- src/fetch/adapters/jina-reader/provider.ts
- src/shared/defaults.ts
- src/client/settings-utils.ts
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- src/core/types.ts
- src/core/host-types.ts
- src/core/dispatchers.ts
- src/fetch/adapters/jina-reader/provider.ts
- src/shared/defaults.ts
- src/client/settings-utils.ts
- Advisory decision: needs-baseline-readback

## ImpactStatementDraft

- Compatibility boundary: Stable provider id dsh-search-tools-fetch, FetchResult html|text union, existing readable-http and jina-reader behavior.
- Affected layers:
- fetch adapter, security boundary, worker runtime, settings UI, package/build
- Owners:
- FetchDispatcher + new wire-http adapter
- Invariants:
- No silent fallback; default readable-http unchanged; no Page JS execution claim; public-target pinning at every hop.
- Non-goals:
- Browser JavaScript rendering; login/paywall/CAPTCHA bypass; search adapter; HTTP/3.

These records are Method Pack drafts / hints, not authoritative runtime decisions.
