# Security Policy

## Supported versions

v0.1.x is the current preview line. DSH itself is preview software; treat this
plugin as preview too.

## Reporting

Please open a private security advisory on GitHub rather than a public issue.

## Design notes

- Configuration is written by DSH's settings/config-editor into the profile
  `cordis.patch.yml` (mode 0600) and never contains bearer/basic secrets.
- Secrets are referenced as `SEARXNG_TOKEN` / `SEARXNG_BASIC_AUTH` and resolved
  per request from DSH credentials or the process environment.
- The settings routes require DSH's browser authentication and Host/Origin fence.
- Fetching reuses `@deepseek-ai/dsh-web-fetch-http`, including its SSRF policy.
- Diagnostics redact URL query strings and never include credentials.
