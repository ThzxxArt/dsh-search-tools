# Security Policy

## Supported versions

v0.1.x is the current preview line. DSH itself is preview software; treat this
plugin as preview too. 0.1.5 adds an opt-in external Reader path; the default
`readable-http` path keeps the 0.1.4 behavior.

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
