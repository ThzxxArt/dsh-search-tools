# dsh-search-tools v0.1.5 实施计划：Jina Reader 激进抓取后端

> 状态：实施完成（2026-10-23；仓库门禁 + 真实 DSH GUI fake Reader 通过；npm 0.1.5 已发布，GitHub Release 由 `v0.1.5` tag 生成）
>
> 基线：`8d37066`（0.1.4 发布后 main，2026-10-23）
>
> 目标：新增 `jina-reader` fetch adapter，让 DSH 的 `web_fetch` / `web_research` 可使用浏览器渲染、PDF/Office、iframe/Shadow DOM、选择器与自托管 Reader；默认仍为 `readable-http`，稳定 provider id 不变。
>
> 非目标：不做本地 Playwright/Chromium，不做 composite fallback，不接 Firecrawl，不新增搜索 adapter，不绕过登录/付费墙/验证码，不改变 DSH 的权限/批准模型。

## 1. Goal

安装 0.1.5 后，用户可以在「设置 → 搜索工具 → 抓取」选择 `Jina Reader`，配置 endpoint/API key/浏览器引擎/选择器/隐私项，并用同一个 `web_fetch` / `web_research` 获取由 Reader 渲染后的 Markdown/HTML。非法 endpoint、私有目标、缺失凭据、限流、超时、超大响应都必须返回可区分的稳定错误码；默认 `readable-http` 行为保持兼容。

## 2. Architecture And Tech Stack

- 沿用 `FetchAdapter` / `FetchDispatcher` / `ctx.searchTools`，不新增 registry、不新增 provider id。
- 新增 `src/fetch/adapters/jina-reader/`，adapter 自己负责 endpoint 规范化、目标公网校验、请求、响应映射、probe。
- Reader 请求使用 `AdapterContext.fetch`，不经过 DSH `HttpFetchProvider`；目标 URL 在发出前做 best-effort 公网 DNS 校验。
- `ipaddr.js` 作为直接依赖做地址分类；`JINA_API_KEY` 只通过 `ctx.getCredentials()` / 环境变量解析，不写入 YAML。
- 设置页继续由 manifest 驱动，新增通用 `manifest.notice` 与 `browser`/`pdf` capability；不为 Jina 写页面专用组件。
- 保持 Host/Client 分层：target/DNS 代码只在 host；schema/manifest 可在 client bundle。

## 3. Baseline / Authority Refs

- `src/core/types.ts:138-169` capability 与 manifest。
- `src/core/types.ts:193-198` FetchAdapterRuntime。
- `src/core/dispatchers.ts:157-241` FetchDispatcher 生命周期与校验。
- `src/fetch/adapters/readable-http/{adapter,manifest,provider,schema}.ts` 现有模式。
- `src/client/components/AdapterForm.tsx:89-140` manifest 驱动渲染入口。
- `src/client/settings-utils.ts:31-35` 内置 validator 硬编码。
- `src/host/routes.ts:99-150` probe/preview 固定 20s/30s；fetch probe 需要与 Jina 默认 25s 对齐。
- `src/client/locales.ts` 双语 UI 字符串。
- `README.md:432-441`、`README.en.md` 现有抓取安全承诺必须随新 adapter 修正。
- `docs/architecture.md`、`docs/design-v0.1.0.md` 扩展点与安全边界。

## 4. Compatibility Boundary

- `fetch.adapter` 默认仍是 `readable-http`；现有 YAML 不需要迁移。
- `FetchSection.adapters` 是开放字典；只新增 `jina-reader` 默认对象。
- 稳定 provider id `dsh-search-tools-fetch` 不变；`web_fetch` schema 不变。
- 新增 `manifest.notice?` 与 capability 值 `browser`/`pdf` 是向后兼容的可选字段/联合扩展；外部 adapter 不填不受影响。
- 不删除旧 adapter、不改已有字段语义、不改变 DSH SSRF 对 `readable-http` 的保护。
- `JINA_API_KEY` 是新增凭据 ref；不会出现在配置快照或日志中。

## 5. TDD Route

- Mode: `auto`
- Decision: `strict`
- Authority: 新增外部服务 adapter、网络/安全边界、host 超时、UI 契约，属于 contract/security 变更；计划批准与用户「完整实施」不单独构成 strict，但 auto 规则对这类风险选择 strict。
- Test posture: 每个行为先写 focused failing test；先 RED，再实现；最后 `pnpm release` 全量回归。
- Verification: `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm pack:check`、fake Jina 合同测试、真实 GUI（本地 mock Jina）、live 401 可解释性、真实 Jina 成功路径如无 key 则明确记录为未覆盖网络证据。

## 6. Change Necessity

- User-visible need: 现有 `readable-http` 不执行 JS、不能读 PDF/Office、没有选择器/iframe/Shadow DOM，无法满足“更激进更强”的抓取。
- No-change / docs-config option: 不能；没有第二个 fetch adapter 时配置项无处落地，`web_fetch` 仍只有静态 HTTP。
- Why code change: 需要新 adapter 的请求/响应/安全/UI/host 超时链路，只有 manifest 或文档不会产生抓取能力。
- Minimum change boundary: 新 adapter 目录 + `index.ts` 注册 + `types.ts` 两个可选扩展 + `AdapterForm` notice + `settings-utils` validator + `routes.ts` fetch 超时 + defaults/版本/文档/测试。
- Decision: code-change.

## 7. Ripple Signal Triage

- Canonical owner: `FetchDispatcher` 仍是 fetch provider 唯一 owner；`SearchToolsService` 仍是 adapter registry 唯一 owner。
- Consumers: `web_fetch`、`web_research`、设置页 `/adapters` `/probe` `/fetch-preview`、`/status` credentials。
- Contract: `FetchResult` 形状不变；Jina Markdown 映射为 `body.kind='text'`，HTML 模式为 `'html'`。
- Fallback: 不新增自动回退；Jina 失败返回错误，由调用方重试/切换 adapter。避免隐藏远程故障。
- Retirement: 不删除 `readable-http`；它是默认和本地安全 HTTP 路径。Jina 是显式 opt-in。
- Risk: 目标 URL 交给 Reader；hosted Jina 有数据出境/缓存，自托管才本地。manifest notice + README + SECURITY 明确。

## 8. Complexity Budget

- Artifact class: new adapter (5 files) + shared type/UI/routes/defaults wiring.
- Target files: 5 new, ~9 modified, 1 new dependency (`ipaddr.js`), tests 5-6 new/modified.
- Current pressure: `types.ts` small and cohesive; `AdapterForm` already manifest-driven; `routes.ts` medium.
- Projected pressure: adapter-local logic keeps Jina out of dispatcher; no new owner; `settings-utils` validator map is a small refactor.
- Budget result: within-budget.
- Planned governance: keep target validation in adapter; no new fallback; no page-specific component.

## 9. Tasks

### Task 1 — Contract and schema (RED → GREEN)

Files:
- `src/core/types.ts`
- `src/fetch/adapters/jina-reader/schema.ts`
- `src/fetch/adapters/jina-reader/manifest.ts`
- `tests/jina-reader.spec.ts`

Steps:
1. Add failing schema/manifest tests: endpoint normalization/validation, loopback HTTP allowed, remote HTTP rejected, numeric/select/selector validation, defaults, notice, capabilities, `JINA_API_KEY` secret ref.
2. Extend `AdapterCapability` with `browser`/`pdf`; add optional `AdapterManifest.notice?: LocalizedText`.
3. Implement `normalizeJinaReaderConfig` / `validateJinaReaderConfig` with stable issue codes and no secret fields.
4. Implement manifest groups/fields/notice/secretRefs.
5. Verify focused tests and typecheck.

Acceptance: invalid remote `http://` endpoint is blocked; loopback `http://127.0.0.1:3000` allowed; selector newline rejected; defaults `timeoutMs=25000`, `engine=auto`, `responseMode=markdown`; manifest exposes browser/pdf/probe.

### Task 2 — Public-target and endpoint safety (RED → GREEN)

Files:
- `src/fetch/adapters/jina-reader/target.ts`
- `tests/jina-reader.spec.ts`

Steps:
1. Add failing tests with an injected resolver: public target passes; private/loopback/link-local literal and resolved address fail; empty resolution fails; credentials in URL fail; `ftp:` fails; abort fails.
2. Implement `resolveJinaTarget(raw, signal, resolver)` using `node:dns/promises` + `ipaddr.js`, IPv4-mapped/IPv4-compatible and common NAT64 checks.
3. Keep DNS rebinding residual explicit in comments and docs: Jina resolves independently; this is best-effort, not a pin.
4. Verify focused tests.

Acceptance: no Jina request is made for a private target; error code `JINA_TARGET_BLOCKED`; public target returns normalized URL.

### Task 3 — Reader runtime (RED → GREEN)

Files:
- `src/fetch/adapters/jina-reader/provider.ts`
- `src/fetch/adapters/jina-reader/adapter.ts`
- `tests/jina-reader.spec.ts`

Steps:
1. Add failing tests with a fake `AdapterContext.fetch`: capture POST endpoint/body/headers; key present/absent; engine/responseMode/selectors/iframe/shadow/no-cache/robots/proxy/locale/user-agent; JSON `data.content` (markdown), `data.html`, and `data.text` mapping; `data.warning` target 404 mapping; 401/403/429/5xx; timeout/abort; `maxBodyChars` truncation; `maxResponseBytes`; probe.
2. Implement runtime:
   - resolve config; check `enabled`.
   - resolve `JINA_API_KEY` from credentials/env; optional Bearer.
   - assert public target before request.
   - POST form `url=<target>` to normalized endpoint; `Accept: application/json`; client UA; timeout via `AbortSignal.any`; `redirect: 'error'`.
   - stream response with byte cap; parse JSON; map warning status; clip body; `truncated`.
   - map failures to stable codes; no key/secret in messages.
   - probe reuses fetch.
3. Implement adapter factory.
4. Verify focused tests.

Acceptance: one fake request can prove every header/body mapping; 401 maps `JINA_AUTH`; 429 maps `JINA_RATE_LIMIT` with bounded retry hint; a Reader-supplied `data.warning` target 404 returns `statusCode=404`; HTML/text modes read their own fields; content > `maxBodyChars` sets `truncated`; wrong JSON/missing mode field maps `JINA_BAD_RESPONSE`; private target never calls fetch.

### Task 4 — Registration and defaults (RED → GREEN)

Files:
- `src/index.ts`
- `src/shared/defaults.ts`
- `package.json` / lockfile
- `tests/jina-reader.spec.ts`

Steps:
1. Add failing registration/default test.
2. Register `jinaReaderAdapter` via `ctx.effect`.
3. Add `jina-reader` config to `DEFAULT_FETCH_SECTION`; re-export type.
4. Add `ipaddr.js` dependency and update lockfile.
5. Verify adapter list/status includes Jina; default remains readable-http.

Acceptance: `ctx.searchTools.getFetchAdapter('jina-reader')` exists; `/adapters` contains it; `DEFAULT_STORED_CONFIG.fetch.adapter === 'readable-http'`.

### Task 5 — Settings page (RED → GREEN)

Files:
- `src/client/settings-utils.ts`
- `src/client/components/AdapterForm.tsx`
- `tests/settings-page.spec.tsx`
- `tests/helpers/primitives.tsx` only if needed

Steps:
1. Add failing tests: Jina manifest appears; notice visible; switching to Jina loads defaults; invalid endpoint blocks save; API key writes through credentials as `JINA_API_KEY`; capability tags show.
2. Replace hardcoded built-in validator branches with a small built-in validator map (searxng/readable-http/jina-reader).
3. Render `manifest.notice` at the top of `AdapterForm` with `Notice` warning/info icon; no page-specific Jina branch.
4. Verify tests.

Acceptance: notice is programmatically visible; selecting Jina uses manifest defaults; invalid draft disables Save; secret never enters form mutation.

### Task 6 — Host route timeout (RED → GREEN)

Files:
- `src/host/routes.ts`
- `tests/host-routes.spec.ts`
- `tests/fetch-timeouts.spec.ts`

Steps:
1. Add failing helper tests: default preview 30s; Jina 25s → 30s; 60s → 65s; 180s → 185s; fetch probe 30s base; cap 190s; malformed config fallback.
2. Add failing fetch-preview test that captures a timeout-bearing signal? Use exported `fetchRouteTimeoutMs` helper for direct proof and route test for wiring.
3. Implement helper and use for fetch probe/preview; leave search route at 20s/30s.
4. Verify tests.

Acceptance: Jina 60s draft preview no longer dies at 30s; `web_fetch` 30s tool limit remains documented and unchanged.

### Task 7 — Version and docs

Files:
- `package.json`
- `src/host/routes.ts` VERSION
- `src/search/adapters/searxng/schema.ts`
- `src/fetch/adapters/readable-http/schema.ts`
- `CHANGELOG.md`
- `README.md`
- `README.en.md`
- `SECURITY.md`
- `docs/architecture.md`
- `docs/design-v0.1.0.md`
- `docs/release-v0.1.5.md`
- `docs/m0-verification.md`
- tests version expectations

Steps:
1. Update version/UA to `0.1.5`.
2. Document Jina config, self-hosting, API key, data egress/cache, 30s DSH tool limit, errors, default unchanged.
3. Fix all statements that “抓取全部复用 DSH 安全 HTTP/不执行 JS” to be adapter-scoped.
4. Add 0.1.5 release checklist and verification placeholder/actual evidence.
5. Update architecture/design appendix.

Acceptance: `rg` finds no unqualified “no JS/安全 HTTP” claim; README default example still readable-http; Jina documented as opt-in.

### Task 8 — Real GUI and release gate

Steps:
1. Build/pack local 0.1.5.
2. Launch a local fake Jina Reader endpoint; use real DSH GUI profile to select Jina, configure endpoint/key, run fetch preview/probe; verify request body/headers and result rendering.
3. Test invalid private target and invalid endpoint in GUI.
4. Test 700/560px no horizontal overflow and no console errors.
5. Run `pnpm release`; record counts, build, pack, publint.
6. Record live `r.jina.ai` anonymous 401 as external evidence; if no API key/self-hosted Reader is available, record the hosted success path as an explicit uncovered environment gap, not a pass.

Acceptance: fake Jina succeeds end-to-end through real DSH; code gate green; no unhandled chain.

## 10. Verification

- `pnpm typecheck`
- `pnpm test` (all existing + new)
- `pnpm build`
- `pnpm pack:check`
- `pnpm release`
- `git diff --check`
- real DSH GUI with fake Jina endpoint
- live `r.jina.ai` 401 mapping (anonymous) and, if credentials/self-host available, real 200
- `rg` claim audit for old global “no JS/DSH safe HTTP” language

## 11. Risks

- Hosted Jina sends target URL off-machine; accepted by user's A choice. Self-hosted endpoint keeps local.
- Jina-side DNS rebinding and redirect/browser navigation cannot be pinned; local DNS guard is best-effort and documented. Self-hosted Reader egress must be restricted.
- `X-Timeout` is a Reader wait budget, not a hard deadline; the local AbortController is the hard deadline and `X-Timeout` is sent one second shorter.
- `web_fetch` tool timeout is 30s by default; Jina 25s default fits, 60s/180s requires raising DSH `tool-web.fetchTimeoutMs`.
- Jina API semantics can drift; contract tests pin our mapping, live 401 proves reachability only.
- No real Jina key in this environment; hosted success path remains unverified unless a key/self-host is supplied. Self-hosted/fake Reader covers protocol and GUI.

## 12. Retirement / Compatibility

- No old path retired. `readable-http` remains default.
- No compatibility fallback added; failure is explicit.
- `jina-reader` can be removed later by deleting adapter + defaults + docs; stable provider id unaffected.

## 13. Task Order

1. Contract/schema
2. Target safety
3. Runtime/adapter
4. Registration/defaults/dependency
5. Settings page
6. Host timeout
7. Version/docs
8. GUI/release gate
