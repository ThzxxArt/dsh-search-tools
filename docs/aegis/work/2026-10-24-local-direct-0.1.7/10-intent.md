# 0.1.7 Local Direct search — Intent

- Requested outcome: implement the complete 0.1.7 A-plan: a zero-deployment,
  local search adapter that queries DuckDuckGo and Bing directly and fuses
  results locally, with no service, key, Reader, browser, or aggregator.
- Scope: local-direct schema/manifest/engines/parsers/fusion/worker/provider,
  shared one-shot worker lifecycle, checkboxes field, source-count status,
  instance-less probe UI, tests, fixtures, documentation, release gate.
- Non-goals: offline/local-index search, browser rendering, Google/Brave
  scraping, custom engine endpoints, pagination, third-party search APIs,
  automatic fallback, query rewriting, LLM reranking.
- Boundary: queries leave the machine to the enabled public engines; parsing,
  fusion, ranking, and caching stay local. No JS, cookies, Authorization, or
  redirect following.
