# Security Policy

## Supported versions

v0.1.x is the current preview line. DSH itself is preview software; treat this
plugin as preview too. 0.1.6 adds the opt-in local `wire-http` path; the default
`readable-http` path and its DSH SSRF boundary are unchanged.

## Reporting

Please open a private security advisory on GitHub rather than a public issue.

## Design notes

- Configuration is written by DSH's settings/config-editor into the profile
  `cordis.patch.yml` (mode 0600) and never contains bearer/basic/Jina secrets.
- Secrets are referenced as `SEARXNG_TOKEN`, `SEARXNG_BASIC_AUTH`, and
  `JINA_API_KEY`; they are resolved per request from DSH credentials or the
  process environment and never rendered back into the page.
- The settings routes require DSH's browser authentication and Host/Origin fence.
- `readable-http` reuses `@deepseek-ai/dsh-web-fetch-http`, including its
  address-pinned SSRF policy.
- `wire-http` is a local browser-grade HTTP path, not a browser. It starts a
  loopback HTTP proxy on `127.0.0.1:0`; for every CONNECT/HTTP hop it resolves
  DNS, rejects any non-public answer, and connects to a validated IP without
  re-resolving the hostname. TLS/HTTP2 is performed by `impit` in a one-request
  worker. The worker is terminated in `finally`, including abort and timeout.
  It sends no cookies, Authorization, or login state, and it does not execute
  page JavaScript; SPA content requires `jina-reader` or a future opt-in browser.
  The agent cannot choose a private target, a non-80/443 port, or a redirect to
  a private address: all are rejected by the guard.
- `wire-http` PDF extraction uses `pdfjs-dist` locally with `isEvalSupported:
  false`, no PDF JavaScript execution, a page cap, a byte cap, and a decoded
  character cap. A scanned PDF without a text layer fails with
  `WIRE_PDF_UNREADABLE` rather than a silent empty success.
- `wire-http` does not authenticate to target sites, bypass paywalls, or solve
  CAPTCHAs. Its TLS/HTTP fingerprint is protocol fidelity, not an access-control
  bypass.
- `jina-reader` is **not** the same boundary. It validates the target URL and
  every resolved address before sending (including IPv4-mapped,
  IPv4-compatible, and common NAT64 forms), but the Reader service resolves the
  target again and may follow redirects or browser navigations; this is
  best-effort, not connection-level pinning. A hosted Reader sends the target
  URL off-machine and may cache it. Use a self-hosted Reader and restrict its
  egress when the page must stay local or private services must stay
  unreachable.
- `jina-reader` does not authenticate to target sites, bypass paywalls, or solve
  CAPTCHAs. It must not be treated as an anonymity or access-control proxy.
- Diagnostics redact URL query strings and never include credentials.
- The Reader endpoint must be HTTPS for remote hosts; plain HTTP is accepted
  only for loopback. Embedded credentials/query/hash in endpoints are rejected.
