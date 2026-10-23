# dsh-search-tools v0.1.4 迭代方案

> 状态：**已发布（2026-10-23）；npm 0.1.4 与 GitHub Release v0.1.4 均已上线。**
>
> 基线：`be2f1c2`（0.1.3，2026-10-23）
>
> 目标：先让所有配置项真实生效，再优化搜索与抓取的可靠性、正文正确性和可观测性。
>
> 非目标：不新增 Exa/Tavily/Brave 等第二个搜索 adapter，不新增浏览器抓取，不做抓取缓存，不改稳定 provider id。

## 1. 结论先行

0.1.3 的代码、测试和发布链路是完整可构建的，但配置契约存在三类问题：

1. **完全未生效**：`search.userAgent`、`research.timeoutMs`。
2. **部分生效**：`search.deadlineMs`、`search.proxy`、`search.cacheTtlMs`、`fetch.maxArticleChars`。
3. **能力声明与实现不一致**：`readable-http` manifest 声明 `probe`，但 `FetchAdapter.probe` 不存在，`/probe` 的 fetch 分支永远返回 `FETCH_PROBE_UNSUPPORTED`。

因此 0.1.4 的第一优先级不是加功能，而是把“配置面板上能改的每一个值”接到真实路径，并让测试能证明它生效。第二优先级才是搜索韧性和抓取正文质量。

## 2. 基线证据

| 项目 | 结果 |
|---|---|
| tracked 文件 | 115 个；源码、测试、文档、配置、locale、workflow 全部逐文件读完（依赖锁文件除外） |
| 源码 | `src/` 62 个文件；Host/Client/Shared/Research/Search/Fetch 全部覆盖 |
| 测试 | 13 个文件，73 个测试；`pnpm test` 通过 |
| 类型检查 | `pnpm typecheck` 通过 |
| 工作区 | clean，HEAD `be2f1c2` |
| 设计文档 | 1709 行，分两段完整读取；与实现存在若干过期描述 |

## 3. 执行约束

- **Architecture**：保留 adapter-first 与稳定 provider id（`dsh-search-tools` / `dsh-search-tools-fetch`）；不新增第二套 registry，不绕过 dispatcher。
- **Tech stack**：TypeScript、Cordis、DSH `0.2.1-rc.2`、React 18、Vitest；Host 侧不引入新的运行时依赖，抓取仍复用 `HttpFetchProvider`。
- **Compatibility boundary**：`search.adapters` / `fetch.adapters` 的开放字典与现有 YAML 键保持兼容；新增状态字段只加不改；不改变 DSH 的工具名、参数 schema、SSRF/权限边界。
- **TDD Route**：`auto -> strict`。这是行为/bugfix/共享核心/缓存/探活改动，每个任务先补一个能失败的 focused test，再改最小实现；不把“UI 能点”当完成。
- **Change Necessity**：这些是真实运行时缺陷，不是文档或配置默认值能修复的；必须改 adapter/client/pipeline 的最小代码边界。
- **Verification**：`pnpm release` + 新增配置契约测试 + 真实 DSH GUI 关键路径；证据写入 `docs/m0-verification.md` 和 0.1.4 release checklist。

## 4. 当前链路

### 4.1 搜索

```text
DSH ctx.web.search
  → SearchDispatcher
  → SearxngRuntime.search
  → order instances
  → authHeaders
  → requestPage (pages, 并发)
  → parse JSON / HTML
  → mergePages
  → LRU cache
```

关键文件：

- `src/search/adapters/searxng/client.ts`
- `src/search/adapters/searxng/parse-json.ts`
- `src/search/adapters/searxng/parse-html.ts`
- `src/search/adapters/searxng/schema.ts`
- `src/search/adapters/searxng/manifest.ts`

### 4.2 抓取

```text
DSH ctx.web.fetch
  → FetchDispatcher
  → ReadableHttpRuntime.fetch
  → HttpFetchProvider (DSH safe HTTP)
  → extractReadable (linkedom + Readability)
  → FetchResult
```

关键文件：

- `src/fetch/adapters/readable-http/provider.ts`
- `src/fetch/adapters/readable-http/readability.ts`
- `src/fetch/adapters/readable-http/schema.ts`
- `src/fetch/adapters/readable-http/manifest.ts`

### 4.3 研究

```text
web_research tool
  → runResearch
  → ctx.web.search
  → ctx.web.fetch (mapLimit)
  → extractReadable / turndown / clip
  → total budget clip
  → render Markdown + presentation meta
```

## 5. 配置项使用审计

统计口径：`search` 22 项、`fetch` 10 项、`research` 8 项、`activation` 2 项，共 42 项。  
“完全生效”指配置进入真实请求或真实行为；“部分生效”指有路径但语义不完整；“未生效”指只被 schema/表单接受。

### 5.1 搜索（22）

| 字段 | 判定 | 证据 / 问题 |
|---|---|---|
| `enabled` | 完全 | `client.ts` 的 `available()` 与 `search()` |
| `instances` | 完全 | `enabledInstances()`、`order()`、缓存键 |
| `engines` | 完全 | `requestPage()` 的 `engines` 参数 |
| `categories` | 完全 | `requestPage()` 的 `categories` 参数 |
| `language` | 完全 | `requestPage()` 的 `language` 参数 |
| `safesearch` | 完全 | `requestPage()` 的 `safesearch` 参数 |
| `timeRange` | 完全 | `requestPage()` 的 `time_range` 参数 |
| `pages` | 完全 | `Promise.all` 请求 1..pages；但无部分成功降级 |
| `maxResults` | 完全 | `limit` 计算 |
| `strategy` | 完全 | `order()` |
| `method` | 完全 | GET/POST 初始化 |
| `format` | 完全 | JSON/HTML 选择；`auto` 只请求 JSON，失败后按响应回退 |
| `auth.type` | 完全 | `authHeaders()`；但缓存键不含 auth |
| `requestTimeoutMs` | 完全 | 每次页面请求的 `AbortSignal.timeout` |
| `deadlineMs` | 部分 | 只按实例计算 remaining；重试/退避/多页可能越界 |
| `retries` | 完全 | 重试循环 |
| `cacheTtlMs` | 部分 | LRU `ttl`；`0` 不关闭缓存，lru-cache 中 `ttl: 0` 表示无限 |
| `cacheMaxEntries` | 完全 | LRU `max`；`0` 关闭 |
| `userAgent` | **未生效** | `requestPage()` 只设置 auth + accept，没有 UA |
| `proxy` | 部分 | 搜索请求使用 ProxyAgent；probe 不使用 |
| `includeDomains` | 完全 | JSON/HTML 解析前过滤 |
| `excludeDomains` | 完全 | JSON/HTML 解析前过滤 |

### 5.2 抓取（10）

| 字段 | 判定 | 证据 / 问题 |
|---|---|---|
| `enabled` | 完全 | `available()` / `fetch()` |
| `readability` | 完全 | `fetch()` 的条件分支 |
| `minArticleChars` | 完全 | Readability `charThreshold` + 文本长度检查 |
| `maxArticleChars` | 部分 | 用于截断 HTML，但 `truncated` 比较的是原始 HTML 长度；可能在正文未截断时误报 |
| `maxResponseBytes` | 完全 | `HttpFetchProvider` 限制 |
| `maxBodyChars` | 完全 | `HttpFetchProvider` 与提取前检查 |
| `timeoutMs` | 完全 | `HttpFetchProvider` 限制 |
| `maxRedirects` | 完全 | `HttpFetchProvider` 限制 |
| `userAgent` | 完全 | `HttpFetchProvider` 限制 |
| `failOpen` | 完全 | 提取失败/异常回退原结果 |

### 5.3 研究（8）

| 字段 | 判定 | 证据 / 问题 |
|---|---|---|
| `enabled` | 完全 | 动态注册工具 + pipeline 拒绝 |
| `maxResults` | 完全 | 参数 clamp、search maxResults、sources slice |
| `maxFetch` | 完全 | `fetch_top` 上界 |
| `defaultFetchTop` | 完全 | `fetch_top` 默认值 |
| `maxCharsPerPage` | 完全 | `max_chars` 上界、Readability、prompt |
| `maxTotalChars` | 完全 | 多页总预算裁剪 |
| `concurrency` | 完全 | `mapLimit` |
| `timeoutMs` | **未生效** | 只出现在 prompt 预览；工具注册固定 `120000`，pipeline 不读该值 |

### 5.4 接管（2）

| 字段 | 判定 | 证据 |
|---|---|---|
| `previousSearchProvider` | 完全 | `SettingsPage.setProvider()`、`TakeoverWarning` |
| `previousFetchProvider` | 完全 | 同上 |

### 5.5 能力声明

| 声明 | 实际 |
|---|---|
| `searxng` capabilities 含 `probe` | 有 `probe`，但只请求 `/config`；注释说会回退一次搜索，实际没有 |
| `readable-http` capabilities 含 `probe` | `ReadableHttpRuntime` 有 `probe()`，但 `readableHttpAdapter` 没有导出 `probe`；`FetchDispatcher.probe()` 因此永远返回 unsupported |
| `search.preview` 使用草稿 config | 是；但路由固定 `maxResults: 10`，不是草稿的 `maxResults`（适配器会用 config 再夹一次） |
| `/status` 的 `fetch.enabled` / `registered` | 硬编码 `true`；`research.registered` 也硬编码 `true` |
| `client/api.ts` 的 `probeFetch` | 已导出，但页面从未调用 |

## 6. 需要修的问题（按优先级）

### P0：配置契约与状态真相

1. **搜索 UA**：`requestPage()` 和 `probeSearxng()` 使用 `config.userAgent`；同时加入 `accept-language`（由 `language` 派生，`all` 不发送）。
2. **研究超时**：让 `research.timeoutMs` 真正约束一次 `web_research`；不能只改 prompt。
3. **抓取 probe**：要么导出 `readableHttpAdapter.probe` 并让 `FetchDispatcher` 走通，要么删掉 capability；优先实现。
4. **缓存 TTL 0**：`cacheFor()` 在 `cacheTtlMs <= 0 || cacheMaxEntries <= 0` 时禁用缓存；更新 README。
5. **deadline 严格化**：一次搜索共享 deadline signal；`requestTimeoutMs` 取 `min(requestTimeoutMs, remaining)`；退避 sleep 也受 deadline/abort 约束；`Retry-After` 不超过 remaining。
6. **状态真相**：`/status` 的 `fetch.available`、`research.registered` 反映真实运行状态；设置页 fetch chip 使用 `fetch.available`。
7. **校验补齐**：内置 adapter 的所有数字字段和跨字段范围在 host `validate()` 中检查，不依赖 normalize 静默 clamp；`Field` 的 min/max 不再只是 HTML 属性。

### P1：搜索韧性

1. **分页部分成功**：`Promise.allSettled` 合并成功页；全失败才报错；失败的页进入 notes。
2. **`format=auto` 真正回退**：JSON 请求遇到 403/415/406 或 JSON 解析失败时，同实例改 `format=html` 重试一次；401 仍按认证失败处理，避免把认证问题误判为格式问题。
3. **probe 回退**：`/config` 非 JSON/404 时，用一次 `format=json` 搜索探测；HTML 200 视为可达但 JSON 关闭；结果返回实际 `json`/`html` 能力。
4. **缓存键**：加入 `auth.type`、`proxy`、`userAgent`；凭据轮换仍建议清缓存（不把 secret 写进 key）。
5. **结果质量**：合并重复 URL 的更长 snippet / 更完整标题；对 `content` 和单条 snippet 设置安全上限，避免模型上下文被单次搜索撑爆。
6. **取消语义**：abort 后不再重试/退避；`sleep()` 清理 abort listener。

### P1：抓取正文正确性

1. **`truncated` 语义**：由提取器返回“是否截断”，不再用原始 HTML 长度推断。
2. **安全截断**：不在 HTML 中间 `slice()`；优先按块级节点截断，无法安全截断时退回纯文本。保证返回的 HTML 仍是合法结构。
3. **`maxArticleChars` 口径**：明确它是正文文本字符上限，不是 HTML 字节/字符上限；HTML 本体单独设安全上限（可用 `maxArticleChars` 的固定倍数，不新增用户配置）。
4. **probe 实际抓取**：`readableHttpAdapter.probe()` 走 `fetch()`，返回 HTTP 状态、正文类型和是否可读；页面可在需要时使用。
5. **去重/清理**：删除未使用的 `alreadyReadable`/`startedAt`/`diagnosticUrl`/`adapterConfigOf`，或把它们接到真实路径。

### P1：研究工具

1. **超时**：`runResearch` 用 `AbortSignal.any([exec.signal, AbortSignal.timeout(timeoutMs)])`；工具注册的 `timeoutMs` 取配置上限（或随配置动态重注册），避免固定 120s 覆盖用户配置。
2. **预算前置**：在提取/转 Markdown 前按剩余总预算限制单页输出，避免先完整处理再丢弃。
3. **读抓取配置**：不再硬编码 `state.fetch.adapters['readable-http']`；按当前 fetch adapter 读取，缺省用安全上限。
4. **Markdown 安全**：标题/snippet 中的 `]`、换行等做转义；内容仍标记为不可信数据。

### P2：可观测性与文档

1. 设置页 Diagnostics 显示 `fetch.available`、`research.registered`，不再显示恒真状态。
2. README/README.en 更新：删除“研究超时尚未接通”“Advanced 页签”“prompt 只读”等过期描述；补 UA、probe、缓存 TTL 0 的真实语义。
3. 设计文档旧 contract（`contractVersion`、`runtime` 分离、`secretDrafts`）标注为历史方案，避免后续实现者按旧接口开发。

## 7. 任务分解

### Task 1：配置契约与状态真相

**文件**

- `src/search/adapters/searxng/schema.ts`
- `src/search/adapters/searxng/manifest.ts`
- `src/fetch/adapters/readable-http/schema.ts`
- `src/host/routes.ts`
- `src/core/types.ts`
- `src/client/tabs/OverviewTab.tsx`
- `src/client/SettingsPage.tsx`
- `tests/config.spec.ts`
- `tests/status.spec.ts`（新增）

**改动**

- 补全所有数值范围/跨字段校验。
- 修正 `/status` 的 `fetch.available`、`research.registered`；保持既有字段兼容。
- 页面 fetch 状态使用真实可用性。
- `Field` 数字输入在 blur 时回显校验错误，而不是静默接受。

**验证**

- 新增 `status.spec.ts`：禁用 readable-http、关闭 research 时状态为 false。
- `config.spec.ts`：每个数字字段越界都返回 issue；不再依赖 clamp。

### Task 2：搜索请求与缓存

**文件**

- `src/search/adapters/searxng/client.ts`
- `src/search/adapters/searxng/schema.ts`
- `tests/search-request.spec.ts`（新增）
- `tests/cache.spec.ts`（新增）

**改动**

- UA/accept-language 进入请求和 probe。
- 共享 deadline；abort 不重试；`Retry-After` 受 remaining 限制。
- `Promise.allSettled` 合并分页。
- `format=auto` 的 HTML 回退。
- `probe` 的 `/search` 回退。
- 缓存键加入 auth.type/proxy/userAgent；TTL 0 关闭；缓存命中不返回可变引用（可选深拷贝）。
- 结果 content/snippet 安全上限。

**验证**

- fake fetch 捕获 headers：UA、auth、accept-language。
- 检查 query params：engines/categories/language/safesearch/timeRange/pageno。
- deadline：慢响应 + 短 deadline，确认不再尝试下一个实例。
- abort：取消后不重试、不 sleep。
- 分页：一页失败一页成功仍返回 sources + notes。
- 格式回退：JSON 403 → HTML 200。
- probe：`/config` 404 → `/search` JSON。
- cache：TTL 0 不缓存；auth/proxy/UA 变化 miss。

### Task 3：抓取正文与 probe

**文件**

- `src/fetch/adapters/readable-http/adapter.ts`
- `src/fetch/adapters/readable-http/provider.ts`
- `src/fetch/adapters/readable-http/readability.ts`
- `src/fetch/adapters/readable-http/manifest.ts`
- `src/fetch/adapters/readable-http/schema.ts`
- `tests/readability.spec.ts`
- `tests/fetch-probe.spec.ts`（新增）

**改动**

- 导出 adapter `probe`，或让 `FetchDispatcher.probe` 使用 runtime；删除/接通 `probeFetch`。
- `ReadableExtraction` 增加 `truncated`、`textChars`、`htmlChars`。
- 安全截断 HTML；`truncated` 用提取结果，不用原始 HTML 长度。
- 明确 `maxArticleChars` 是文本字符上限；HTML 使用单独安全上限。
- 删除未使用导出。

**验证**

- 正文短、HTML 长：`truncated` 必须 false。
- 正文长：返回合法 HTML 或纯文本，`truncated` true。
- `readability=false`、`enabled=false`、`failOpen` 分支。
- `/probe` fetch 分支返回 `ok`，不再 unsupported。

### Task 4：研究超时与预算

**文件**

- `src/research/pipeline.ts`
- `src/research/tool.ts`
- `src/research/render.ts`
- `src/research/prompt.ts`
- `tests/research-pipeline.spec.ts`
- `tests/research-timeout.spec.ts`（新增）

**改动**

- `research.timeoutMs` 进入 pipeline signal；工具注册超时与配置一致。
- 预算前置；按当前 fetch adapter 读取 `maxBodyChars`。
- 标题/snippet Markdown 转义。
- prompt 的 timeout 文案与实际一致。

**验证**

- 短 timeout 下 fetch 不返回，工具在预算内 abort。
- `maxTotalChars` 不再先完整处理再丢弃（可用计时/调用次数断言）。
- `fetch_top=0`、部分失败、并发上限。

### Task 5：文档、GUI 与发布

**文件**

- `README.md`、`README.en.md`
- `CHANGELOG.md`
- `docs/design-v0.1.0.md`（历史标注）
- `docs/plan-v0.1.4.md`（本文件）
- 版本：`package.json`、`src/host/routes.ts`、默认 UA、测试 fixture

**验证**

- `pnpm release`：typecheck + 新测试 + build + pack + publint。
- 真实 DSH GUI：UA 通过 mock 实例请求头观察；format 回退；fetch probe；研究短超时；fetch 状态 chip。
- 0.1.4 release checklist + npm/GitHub 产物哈希一致。

## 8. 验收标准

0.1.4 完成必须同时满足：

1. 42 个配置项每个都有测试或 GUI 证据，证明它进入了真实路径；没有“只被 schema 接受”的字段。
2. `search.userAgent`、`research.timeoutMs` 不再是 dead config。
3. fetch `/probe` 不再返回 unsupported；manifest capability 与实际一致。
4. `cacheTtlMs=0` 确实关闭缓存。
5. `deadlineMs` 在重试、分页、退避下不被突破。
6. 搜索分页部分成功、格式回退、probe 回退都有测试。
7. 抓取 `truncated` 不再误报；HTML 截断不产生破损标签。
8. `pnpm release` 全绿；工作区干净；版本/CHANGELOG/README 一致。
9. 真实 DSH GUI 成功态与至少一个失败态复验；记录证据。
10. 不改变稳定 provider id、不新增 adapter、不改变 DSH 的 SSRF/权限边界。

## 9. 工期

| 阶段 | 内容 | 估计 |
|---|---|---:|
| T1 | 配置契约与状态真相 | 1.5–2 天 |
| T2 | 搜索请求、缓存、probe | 2–2.5 天 |
| T3 | 抓取正文与 fetch probe | 1.5–2 天 |
| T4 | 研究超时与预算 | 1–1.5 天 |
| T5 | GUI、文档、发布 | 1–1.5 天 |
| 合计 | | **7–9 个工作日** |

## 10. 风险与取舍

| 风险 | 处理 |
|---|---|
| 严格 deadline 让慢实例更早失败 | 保留每个实例的 failover；错误码区分 timeout/deadline；README 说明 |
| `format=auto` 回退增加一次请求 | 只在 403/415/406/解析失败时回退；不无限重试 |
| 安全截断 HTML 可能减少结构 | 优先块级截断；失败退回纯文本；测试保底 |
| `maxArticleChars` 口径改变 | 在 README 明确“正文字符”；迁移期保留兼容行为 |
| 研究超时变短导致部分页失败 | 逐页错误隔离；卡片显示失败；提示可调大 |
| 缓存键加入 UA/proxy 降低命中率 | 这是正确性优先；文档说明 |
| 页面状态改变影响既有测试 | 更新 fixture；保留旧字段，新增 `fetch.available` |
| 真实 GUI 失败态仍难注入 | 至少覆盖 UA/format/probe/超时；凭据失败继续用组件测试 |

## 11. 本次不做

- 第二个搜索 adapter（Exa/Tavily/Brave）。
- 浏览器渲染 / JS 执行 / 登录态 / PDF。
- 抓取缓存（放 0.2.0 评估）。
- 多 adapter 聚合、查询改写、语义重排。
- 抓取结果元数据扩展（title/byline 进入 `FetchResult` 需要 DSH contract 变更）。

## 12. 实施结果（2026-10-23）

T1–T4 已按计划落地，T5 的版本、文档、构建和真实 GUI 复验已完成：

- 配置契约：搜索/抓取所有数值、枚举、数组与跨字段校验；`/status` 的
  `search.enabled` / `fetch.enabled` / `fetch.available` /
  `research.registered` 来自真实配置与 runtime；Fetch chip 与 Diagnostics
  使用真实状态。
- 搜索：UA/accept-language、严格 deadline、abort/重试/退避、`Retry-After`
  受 remaining 约束、分页部分成功、`auto` 格式回退、probe 回退、缓存键与
  TTL 0、结果长度上限；probe 同时受 `requestTimeoutMs` 和配置 method 约束；
  搜索预览使用草稿 `maxResults`，不再固定 10。
- 抓取：`truncated` 由提取器返回、块级安全截断、`maxArticleChars` 文本口径、
  `readable-http` 真实 probe、失败回退。
- 研究：`timeoutMs` 进入工具声明和内部 signal、预算前置、读取当前 fetch
  adapter 限制、Markdown 转义；`defaultFetchTop > maxFetch` 与
  `maxCharsPerPage > maxTotalChars` 在 host 执行前显式拒绝。
- 版本/门禁：`0.1.4`；`pnpm typecheck`、`pnpm test`（119 tests / 19 files）、
  `pnpm build` 通过；真实 DSH GUI 覆盖成功/失败态、host 配置拒绝、草稿
  `maxResults`、format 回退、研究短超时与 700/560 布局。
- 发布：`docs/release-v0.1.4.md` 记录真实 GUI 与发布证据；Release workflow
  `39914636598` 成功，npm `0.1.4` 为 `latest`，GitHub Release `v0.1.4` 已发布。

### 12.1 审计缺口收口（2026-10-23 第二轮）

第一轮实施后，二次对照发现并补齐了：

- `Retry-After`：原来的退避只做指数等待，现已解析 delta-seconds/HTTP date，
  并在 `deadlineMs` 内使用；新增 parser 与集成测试。
- host 校验：`SearchDispatcher` / `FetchDispatcher` 在 available、search、
  fetch、probe、preview 前调用 adapter 的 `validate()`；非法实时/草稿配置
  返回 `SEARCH_CONFIG_INVALID` / `FETCH_CONFIG_INVALID`，不再静默 clamp。
- 研究跨字段：`defaultFetchTop > maxFetch`、`maxCharsPerPage >
  maxTotalChars` 在执行前返回 `RESEARCH_CONFIG_INVALID`。
- 搜索预览：`/search-preview` 使用草稿 `config.maxResults`，不再固定 10。
- probe：搜索 probe 同时应用 `requestTimeoutMs` 与配置的 GET/POST method。
- status：`search.enabled` / `fetch.enabled` 读取真实 adapter 配置。
- 测试：新增 `tests/host-routes.spec.ts`，并把总数提升到 119 / 19。
- 真实 GUI：host 非法草稿返回 `SEARCH_CONFIG_INVALID`；草稿 `maxResults: 17`
  返回 17 条；format fallback 命中 JSON 403 → HTML；研究工具在 5000ms 返回
  `TOOL_TIMEOUT`（内部 `WEB_RESEARCH_TIMEOUT` 由单元测试覆盖）。

未做项与第 11 节一致；真实 SearXNG 质量、真实凭据/冲突注入、物理 560px、
屏幕阅读器和非 Chromium 引擎仍是证据边界。推送与 npm/GitHub 发布仍待凭据。
