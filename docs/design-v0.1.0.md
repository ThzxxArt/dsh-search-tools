# dsh-search-tools v0.1.0 设计与实施方案（Adapter-first v3）

> 状态：**v3 方案已确认，工程骨架已开工（2026-10-22）**
>
> 实现说明：当前仓库已搭好 Host/Client 骨架、adapter registry、稳定 dispatcher、SearXNG/Readability adapter、设置路由和 `web_research` 工具。真实 DSH GUI 冒烟、脚本模型与真实模型的 `web_research` 回放、卡片渲染、设置页内联测试/诊断/键盘操作和激活提示/空状态视觉验收已完成；真实模型也分别调用了内置 `web_search` 与 `web_fetch`，搜索走真实 SearXNG 实例。0.1.2 完成设置页 UI/UX 修订，0.1.3 补齐审计缺口（Search 子页、Fetch reader、字段级错误、五个 tab 组件、操作条留白），0.1.4 完成配置契约、搜索 deadline/回退、抓取截断/probe 和研究超时/预算修复；0.1.5 新增可选的 Jina Reader 抓取 adapter、通用 manifest notice、browser/pdf capability 和 host 动态超时；详见附录 E/F/G/H。架构速查见 [architecture.md](architecture.md)。
>
> 目标仓库：`https://github.com/ThzxxArt/dsh-search-tools`
>
> 包名：`dsh-search-tools`（npm 上暂未发现同名包；发布前再确认一次）
>
> 基线：本机 DSH checkout `0.2.1-rc.2`，官方文档对应 0.2.x；Node `^22.19.0 || >=24.0.0`
>
> 许可证：MIT
>
> 修订日期：2026-10-22
>
> **v3 核心变化**：从“SearXNG 专用插件”改成“**搜索/抓取适配器框架 + SearXNG 第一个适配器**”。核心只认识 adapter 接口；加 Exa、Tavily、Brave、Jina Reader、浏览器抓取时，不改 `web.searchProvider`、不改设置页骨架、不改 dispatcher，只新增一个 adapter 模块或 npm 包。

---

## 0. 结论先行

爸爸的担心是对的：如果 v0.1.0 把 `instances`、`engines`、`auth` 直接写进插件 Config 和页面，加第二个后端时就要改 schema、改表单、改 provider 注册，甚至改 `web.searchProvider`。这不是“以后再说”的问题，是第一天就会锁死架构的问题。

所以 v0.1.0 采用 **adapter-first**：

```text
DSH ctx.web
   │
   ▼
稳定 provider：dsh-search-tools（搜索）
   │  只做三件事：选 adapter、转发调用、报告可用性
   ▼
adapter registry：ctx.searchTools
   ├── searxng          ← v0.1.0 内置
   ├── exa              ← 未来内置或独立包
   ├── tavily           ← 未来
   ├── brave            ← 未来
   └── 外部 adapter 包  ← 通过 ctx.searchTools.registerSearchAdapter()
```

抓取同理：

```text
DSH ctx.web
   │
   ▼
稳定 provider：dsh-search-tools-fetch
   │
   ▼
fetch adapter registry
   ├── readable-http     ← v0.1.0 内置
   ├── jina-reader       ← 0.1.5 内置
   └── browser           ← 未来（仍不拥有浏览器，调用 browser-use）
```

关键收益：

- **provider id 稳定**：`web.searchProvider` 永远是 `dsh-search-tools`，加后端不影响 DSH 配置和接管状态。
- **设置页骨架稳定**：页面由 adapter manifest 驱动，新增后端只提供字段描述，不改 React 页面。
- **配置结构稳定**：`search.adapters.<id>` 是开放字典；新增后端不会破坏旧 YAML。
- **运行时解耦**：每个 adapter 自己处理认证、请求、解析、缓存、探测；核心 dispatcher 不关心 SearXNG 细节。
- **外部可扩展**：第三方包可以注册 adapter，不需要改核心代码；核心只检查 contract version。
- **v0.1.0 仍只交付 SearXNG**：架构留好，但不为了“未来”先做一堆空 adapter。

---

## 1. 为什么不是“多写几个 provider 就完了”

DSH 的 `ctx.web` 本身就能注册多个 provider：

```ts
ctx.web.registerSearchProvider(new SearxngProvider())
ctx.web.registerSearchProvider(new ExaProvider())
```

这解决了“执行”，但解决不了“产品”：

| 问题 | 多 provider 直接注册 | Adapter-first |
|---|---|---|
| 用户怎么选后端 | 每个 provider 自己一套设置页/配置 | 一个页面，provider picker |
| `web.searchProvider` 写什么 | 每个后端一个 id，切换要改 DSH 配置 | 永远写 `dsh-search-tools` |
| 加后端要改什么 | 新包 + 新设置页 + 新接管逻辑 | 新 adapter 模块/包 |
| 统一测试/诊断 | 每个包各做一套 | 核心统一 probe/status/cache |
| 外部扩展 | 只能各做各的插件 | `ctx.searchTools.registerSearchAdapter()` |
| 未来多后端聚合 | 需要另写编排 | 可以加一个 composite adapter |

所以：**执行仍然走 DSH `ctx.web`，但产品层增加一个 adapter registry。** 这不是重复造 provider 注册表，而是把“配置、UI、测试、选择”从执行 seam 里分出来。

一个 adapter 可以同时是独立的 DSH 插件：它想用统一设置页，就注册 `ctx.searchTools`；它想完全自主，就直接注册 `ctx.web`，只是不会出现在我们的页面里。两条路都合法，核心不垄断 provider 注册。

---

## 2. 架构

### 2.1 三层

```text
┌──────────────────────────────────────────────────────────────────┐
│ 产品层：设置 → 搜索工具                                            │
│  - provider picker（SearXNG / Exa / …）                           │
│  - manifest 驱动的通用表单                                         │
│  - 统一测试、诊断、接管                                            │
└──────────────────────────────┬───────────────────────────────────┘
                               │ configForms / routes
┌──────────────────────────────▼───────────────────────────────────┐
│ 核心层：dsh-search-tools                                          │
│  - SearchDispatcher（id: dsh-search-tools）                       │
│  - FetchDispatcher（id: dsh-search-tools-fetch）                  │
│  - SearchToolsRegistry（ctx.searchTools）                         │
│  - 配置 schema / YAML / 凭据引用 / 诊断                            │
└──────────────────────────────┬───────────────────────────────────┘
                               │ adapter contract
┌──────────────────────────────▼───────────────────────────────────┐
│ 适配器层                                                          │
│  searxng adapter（v0.1.0）                                        │
│  readable-http adapter（v0.1.0）                                  │
│  jina-reader adapter（v0.1.5）                                    │
│  未来：exa / tavily / brave / browser / …                         │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 稳定 provider id

| 能力 | 注册到 `ctx.web` 的 id | 用户配置里写什么 |
|---|---|---|
| 搜索 | `dsh-search-tools` | `web.searchProvider: dsh-search-tools` |
| 抓取 | `dsh-search-tools-fetch` | `web.fetchProvider: dsh-search-tools-fetch` |

adapter 选择在插件自己的配置里：

```yaml
search:
  adapter: searxng
fetch:
  adapter: readable-http
```

这样：

- 加 Exa 只是把 `search.adapter` 改成 `exa`；`web.searchProvider` 不变。
- 接管/恢复逻辑不需要知道具体后端。
- 停用核心插件时，只有一个悬空 id 要处理，不会出现一堆 provider id。
- `web_research` 通过 `ctx.web` 自动跟随当前 adapter，不需要改工具。

### 2.3 Adapter contract

核心导出一组纯类型和 helper：

```ts
export const ADAPTER_CONTRACT_VERSION = 1

export type FieldKind =
  | 'text' | 'url' | 'textarea'
  | 'number' | 'boolean' | 'select' | 'tags' | 'list'

export interface FieldDescriptor {
  kind: FieldKind
  key: string
  label: string
  hint?: string
  placeholder?: string
  required?: boolean
  min?: number
  max?: number
  step?: number
  options?: Array<{ value: string; label: string }>
  /** list 的子字段 */
  itemFields?: FieldDescriptor[]
  /** 条件显示：点路径 + 期望值 */
  visibleWhen?: { field: string; equals?: unknown; in?: readonly unknown[] }
  /** 分组 id；对应 manifest.groups */
  group?: string
}

export interface SecretRefDescriptor {
  key: string
  ref: string
  label: string
  hint?: string
  group?: string
  visibleWhen?: { field: string; equals?: unknown; in?: readonly unknown[] }
}

export interface AdapterCapabilities {
  auth: Array<'none' | 'bearer' | 'basic' | 'api-key'>
  engines?: boolean
  categories?: boolean
  language?: boolean
  safesearch?: boolean
  timeRange?: boolean
  pagination?: boolean
  domains?: boolean
  proxy?: boolean
}

export interface AdapterManifest {
  contractVersion: 1
  id: string
  label: string
  description: string
  order?: number
  groups?: Array<{ id: string; label: string; description?: string }>
  fields: FieldDescriptor[]
  secretRefs?: SecretRefDescriptor[]
  defaults: Record<string, unknown>
  capabilities: AdapterCapabilities
}

export interface AdapterValidation {
  errors: Array<{ path: string; message: string }>
}

export interface ProbeResult {
  ok: boolean
  code?: string
  message?: string
  latencyMs?: number
  details?: Record<string, unknown>
  /** key = 字段 key，例如 engines/categories */
  suggestions?: Record<string, string[]>
}

export interface AdapterContext {
  readonly logger: { debug(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
  readonly resolveSecret: (ref: string) => Promise<string | undefined>
}

export interface SearchAdapter {
  readonly manifest: AdapterManifest
  validate(config: unknown): AdapterValidation
  create(ctx: AdapterContext, getConfig: () => unknown): WebSearchProvider
  probe?(ctx: AdapterContext, config: unknown, signal: AbortSignal): Promise<ProbeResult>
}

export interface FetchAdapter {
  readonly manifest: AdapterManifest
  validate(config: unknown): AdapterValidation
  create(ctx: AdapterContext, getConfig: () => unknown): WebFetchProvider
  probe?(ctx: AdapterContext, config: unknown, signal: AbortSignal): Promise<ProbeResult>
}

/** 可选：dispatcher 暴露缓存统计/清理；不支持就不显示。 */
export interface AdapterCache {
  stats?(): { size: number; hits: number; misses: number }
  clear?(): void
}
```

约束：

- **manifest 必须可 JSON 序列化**：不能放函数、类实例、Symbol。UI 通过 Host route 读取 manifest。
- **secret 不进 config**：`secretRefs` 声明凭据引用；config 里只出现 `auth.type` 之类的选择。
- **`validate` 必须纯函数**：不读网络、不读环境；只返回错误列表。Host 保存/探测前调用。
- **`create` 返回的 provider 读 `getConfig()`**：不要捕获初始化时的 config 快照；页面保存后要立即生效。
- **`probe` 用传入的 config + `resolveSecret`**：测试草稿不落盘。
- **adapter 不直接注册 `ctx.web`**：由核心 dispatcher 统一注册；否则会绕过 provider id 稳定性。
- **contract version 不匹配**：核心拒绝注册并记录错误，不影响其他 adapter。

### 2.4 注册表服务

核心提供 `ctx.searchTools`：

```ts
export class SearchToolsRegistry extends Service {
  constructor(ctx: Context) { super(ctx, 'searchTools') }

  registerSearchAdapter(adapter: SearchAdapter): () => void
  registerFetchAdapter(adapter: FetchAdapter): () => void

  listSearchAdapters(): readonly AdapterManifest[]
  listFetchAdapters(): readonly AdapterManifest[]

  getSearchAdapter(id: string): SearchAdapter | undefined
  getFetchAdapter(id: string): FetchAdapter | undefined
}
```

行为：

- 校验 `contractVersion === 1`。
- 校验 `id` 非空、唯一；重复注册抛错。
- 返回 disposer，调用方用 `ctx.effect` 管理生命周期。
- 内置 adapter 在核心 `apply` 里注册；外部 adapter 包在自身 `apply` 里注册。
- 注册/注销发出 `searchTools/changed` 事件（可选），用于页面刷新和状态更新。
- 不缓存 adapter 的 config；config 由核心按 namespace 读取。

外部 adapter 包示例：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { SearchAdapter } from 'dsh-search-tools'

export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.searchTools.registerSearchAdapter(exaAdapter), 'exa adapter')
}
```

`exaAdapter` 自己实现 `manifest`、`validate`、`create`、`probe`；核心设置页会自动出现 Exa 选项和字段。

### 2.5 外部 adapter 如何被发现

Host 提供：

```text
GET /api/dsh-search-tools/adapters
```

返回：

```json
{
  "contractVersion": 1,
  "search": [
    {
      "id": "searxng",
      "label": "SearXNG",
      "description": "...",
      "fields": [],
      "secretRefs": [],
      "defaults": {},
      "capabilities": {}
    }
  ],
  "fetch": []
}
```

- 只返回 manifest，不返回函数/实例。
- 页面打开时拉取；提供“刷新适配器”按钮。
- 外部 adapter 安装并启用后，刷新即可看到。
- 未安装但 YAML 里仍有 `adapters.<id>` 的配置，页面在“高级”里显示“未安装的适配器配置”，可删除。
- 页面不加载外部 adapter 的客户端代码；所有字段由 manifest 描述，渲染逻辑在核心页。

### 2.6 配置模型

> **历史方案说明（0.1.4）：** 本节及 3.5 节出现的 `search.runtime` / `fetch.runtime`、
> `secretDrafts`、`contractVersion` 是 v0.1.0 早期设计，不是当前实现契约。0.1.x 实际
> 使用 `search.adapters.<id>` / `fetch.adapters.<id>` 的开放字典，密钥只写 DSH
> credentials，探测/预览也不接受草稿 secret。新增 adapter 时请以
> `src/core/types.ts` 的 `AdapterManifest` / `SearchAdapter` / `FetchAdapter` 和
> `src/search/adapters/searxng/*` 为准；本节的 runtime 分层不再作为实现依据。

```ts
import type { Volatile } from '@deepseek-ai/cordis'

export interface SearchRuntime {
  requestTimeoutMs: number
  deadlineMs: number
  retries: number
  cacheTtlMs: number
  cacheMaxEntries: number
  userAgent: string
  proxy: string
}

export interface SearchSection {
  enabled: boolean
  adapter: string
  maxResults: number
  runtime: SearchRuntime
  /** 开放字典：key = adapter id，value = adapter 自己的配置 */
  adapters: Record<string, Record<string, unknown>>
}

export interface FetchRuntime {
  timeoutMs: number
  maxResponseBytes: number
  maxBodyChars: number
  maxRedirects: number
  userAgent: string
}

export interface FetchSection {
  enabled: boolean
  adapter: string
  runtime: FetchRuntime
  adapters: Record<string, Record<string, unknown>>
}

export interface ResearchConfig {
  enabled: boolean
  maxResults: number
  maxFetch: number
  defaultFetchTop: number
  maxCharsPerPage: number
  maxTotalChars: number
  concurrency: number
  timeoutMs: number
}

export interface ActivationConfig {
  previousSearchProvider: string
  previousFetchProvider: string
}

export interface StoredConfig {
  search: SearchSection
  fetch: FetchSection
  research: ResearchConfig
  activation: ActivationConfig
}

/** Host 插件实际收到的类型：每个 section 都是 Volatile 引用。 */
export interface Config {
  search: Volatile<SearchSection>
  fetch: Volatile<FetchSection>
  research: Volatile<ResearchConfig>
  activation: Volatile<ActivationConfig>
}
```

为什么把 `runtime` 和 `adapters` 分开：

- 超时、重试、缓存、UA、代理是所有后端共有的，放 `runtime`，页面只写一份。
- 实例、API key、引擎、语言、时间范围是后端特有的，放 `adapters.<id>`。
- 新增后端不需要改 `runtime`，也不影响其他后端配置。
- 切回旧后端时，旧配置还在，不会丢。

### 2.7 UI 由 manifest 驱动

设置页不写死 SearXNG 字段。它做三件事：

1. 拉取 `/adapters`，渲染 provider picker。
2. 根据 `manifest.groups` + `manifest.fields` 渲染通用表单。
3. 根据 `manifest.secretRefs` 渲染密码框，写入 DSH credentials。

新增一个 adapter 只需要：

```ts
manifest: {
  id: 'exa',
  label: 'Exa',
  groups: [{ id: 'main', label: '连接' }],
  fields: [
    { kind: 'url', key: 'baseURL', label: 'API 地址', group: 'main' },
    { kind: 'select', key: 'searchType', label: '搜索类型', options: [...] },
  ],
  secretRefs: [{ key: 'apiKey', ref: 'EXA_API_KEY', label: 'Exa API Key', group: 'main' }],
  defaults: { baseURL: 'https://api.exa.ai', searchType: 'auto' },
  capabilities: { auth: ['api-key'] },
}
```

设置页不需要改一行 React。

**文案限制**：manifest 的 `label` / `description` / `groups[].label` / `options[].label` 都是展示字符串。内置 adapter 由核心中英文字典按 `adapter.<id>.<key>` 解析；外部 adapter 在 v0.1.0 按 manifest 原文显示，不承诺 adapter 级 i18n。后续可以在 manifest 加 `i18n` 字段，不破坏 v1。

### 2.8 失败、版本与兼容

| 情况 | 行为 |
|---|---|
| adapter contract 版本不匹配 | 注册失败，记录错误；页面标记“不兼容” |
| adapter id 重复 | 注册失败，记录错误；内置优先 |
| adapter 未安装但配置存在 | 页面显示“未安装配置”；搜索报 `ADAPTER_NOT_INSTALLED` |
| adapter 配置校验失败 | `available()` 返回 false；状态/测试显示字段错误 |
| adapter 抛异常 | dispatcher 转成 `WebError`，code 前缀 `ADAPTER_`，保留 cause |
| adapter 卡住 | dispatcher 传 `signal`；核心不额外包一层无界等待 |
| manifest 不可序列化 | 注册时校验，失败并记录 |
| 多个核心实例 | 不支持；`ctx.searchTools` 服务唯一 |

---

## 3. 配置与 YAML

### 3.1 存储位置

唯一真源：当前 profile 的 `cordis.patch.yml`，由 DSH `settings` + `config-editor` 原子写，保留注释，权限 `0600`。

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

页面是唯一编辑器；用户不需要打开这个文件。密钥不进这里。

### 3.2 YAML 示例

```yaml
- id: dsh-search-tools
  name: dsh-search-tools
  config:
    search:
      enabled: true
      adapter: searxng
      maxResults: 10
      runtime:
        requestTimeoutMs: 12000
        deadlineMs: 45000
        retries: 1
        cacheTtlMs: 300000
        cacheMaxEntries: 200
        userAgent: dsh-search-tools/0.1.0 (+https://github.com/ThzxxArt/dsh-search-tools)
        proxy: ''
      adapters:
        searxng:
          instances:
            - url: https://searxng.example.com
              enabled: true
              label: Home
            - url: http://127.0.0.1:8888
              enabled: true
              label: Local
          auth:
            type: bearer
          engines: [google, bing]
          categories: [general]
          language: zh-CN
          safesearch: 1
          timeRange: year
          pages: 1
          strategy: ordered
          method: GET
          format: auto
          includeDomains: []
          excludeDomains: []
    fetch:
      enabled: true
      adapter: readable-http
      runtime:
        timeoutMs: 20000
        maxResponseBytes: 5000000
        maxBodyChars: 2000000
        maxRedirects: 5
        userAgent: dsh-search-tools/0.1.0 (+https://github.com/ThzxxArt/dsh-search-tools)
      adapters:
        readable-http:
          readability: true
          minArticleChars: 200
          maxArticleChars: 200000
          failOpen: true
    research:
      enabled: true
      maxResults: 8
      maxFetch: 8
      defaultFetchTop: 3
      maxCharsPerPage: 12000
      maxTotalChars: 40000
      concurrency: 3
      timeoutMs: 120000
    activation:
      previousSearchProvider: deepseek-official
      previousFetchProvider: http
```

未来加 Exa：

```yaml
search:
  adapter: exa
  adapters:
    searxng: { ... }   # 保留，切回时不丢
    exa:
      baseURL: https://api.exa.ai
      searchType: auto
      numResults: 10
```

### 3.3 Schema

```ts
const SearchRuntimeSchema = z.object({
  requestTimeoutMs: z.number().step(1).min(1000).max(120000).default(12000),
  deadlineMs: z.number().step(1).min(1000).max(300000).default(45000),
  retries: z.number().step(1).min(0).max(5).default(1),
  cacheTtlMs: z.number().step(1).min(0).max(86_400_000).default(300000),
  cacheMaxEntries: z.number().step(1).min(0).max(10_000).default(200),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  proxy: z.string().default(''),
})

const FetchRuntimeSchema = z.object({
  timeoutMs: z.number().step(1).min(1000).max(120000).default(20000),
  maxResponseBytes: z.number().step(1).min(1024).max(50_000_000).default(5_000_000),
  maxBodyChars: z.number().step(1).min(1024).max(20_000_000).default(2_000_000),
  maxRedirects: z.number().step(1).min(0).max(10).default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})

export const Config = z.object({
  search: z.object({
    enabled: z.boolean().default(true),
    adapter: z.string().default('searxng'),
    maxResults: z.number().step(1).min(1).max(20).default(10),
    runtime: SearchRuntimeSchema,
    adapters: z.dict(z.any()).default({}),
  }).volatile(),
  fetch: z.object({
    enabled: z.boolean().default(true),
    adapter: z.string().default('readable-http'),
    runtime: FetchRuntimeSchema,
    adapters: z.dict(z.any()).default({}),
  }).volatile(),
  research: z.object({
    enabled: z.boolean().default(true),
    maxResults: z.number().step(1).min(1).max(20).default(8),
    maxFetch: z.number().step(1).min(1).max(10).default(8),
    defaultFetchTop: z.number().step(1).min(0).max(10).default(3),
    maxCharsPerPage: z.number().step(1).min(1000).max(200_000).default(12000),
    maxTotalChars: z.number().step(1).min(1000).max(500_000).default(40000),
    concurrency: z.number().step(1).min(1).max(8).default(3),
    timeoutMs: z.number().step(1).min(5000).max(600_000).default(120000),
  }).volatile(),
  activation: z.object({
    previousSearchProvider: z.string().default(''),
    previousFetchProvider: z.string().default(''),
  }).volatile(),
})
```

说明：

- `adapters` 是 `z.dict(z.any())`，因为外部 adapter 的字段在核心编译期未知。
- 页面用 manifest 做字段级校验；Host 用 adapter 的 `validate()` 做保存/探测前校验。
- `Config` 的 section 整体 `.volatile()`，所以页面可编辑任意字段，保存后热生效。
- `adapters` 里不允许放 secret；secret 走 credentials。

### 3.4 默认值

| 字段 | 默认 | 理由 |
|---|---|---|
| `search.enabled` | `true` | 装了就用；没 adapter 时不可用但不影响加载 |
| `search.adapter` | `'searxng'` | v0.1.0 唯一的搜索 adapter |
| `search.maxResults` | `10` | 内置工具默认 8，留余量 |
| `search.runtime.requestTimeoutMs` | `12000` | 单次 |
| `search.runtime.deadlineMs` | `45000` | 总预算 |
| `search.runtime.retries` | `1` | 每个实例额外一次 |
| `search.runtime.cacheTtlMs` | `300000` | 5 分钟 |
| `search.runtime.cacheMaxEntries` | `200` | 单进程 |
| `search.runtime.proxy` | `''` | 直连 |
| `fetch.enabled` | `true` | 注册 fetch dispatcher |
| `fetch.adapter` | `'readable-http'` | v0.1.0 唯一的 fetch adapter |
| `fetch.runtime.timeoutMs` | `20000` | 给内置 30s 留余量 |
| `fetch.runtime.maxResponseBytes` | `5000000` | 与内置一致 |
| `fetch.runtime.maxBodyChars` | `2000000` | Readability 需要完整 HTML |
| `research.enabled` | `true` | 完整功能 |
| `research.maxResults` | `8` | 与内置搜索一致 |
| `research.defaultFetchTop` | `3` | 默认 3 页 |
| `research.maxCharsPerPage` | `12000` | 单页上限 |
| `research.maxTotalChars` | `40000` | 总上限 |
| `research.concurrency` | `3` | 尊重站点 |
| `research.timeoutMs` | `120000` | 搜索 + 抓取 |

SearXNG adapter 自己的默认值：

| 字段 | 默认 |
|---|---|
| `instances` | `[]` |
| `auth.type` | `'none'` |
| `engines` | `[]` |
| `categories` | `['general']` |
| `language` | `'all'` |
| `safesearch` | `1` |
| `timeRange` | `''` |
| `pages` | `1` |
| `strategy` | `'ordered'` |
| `method` | `'GET'` |
| `format` | `'auto'` |
| `includeDomains` / `excludeDomains` | `[]` |

### 3.5 密钥

| adapter | 引用 | 内容 |
|---|---|---|
| `searxng` | `SEARXNG_TOKEN` | Bearer token |
| `searxng` | `SEARXNG_BASIC_AUTH` | `username:password`（按第一个冒号分割） |
| 未来 Exa | `EXA_API_KEY` | API key |
| 未来 Tavily | `TAVILY_API_KEY` | API key |

- adapter manifest 声明 `secretRefs`；页面渲染密码框，写入 `remote.credentials.set`。
- Host 侧 `resolveSecret(ref)` 优先 `ctx.credentials.resolve(ref)`，没有 credentials 服务时回退 `process.env[ref]`。
- YAML 里只出现 `auth.type`，没有 token/password。
- 页面只显示 `已配置 / 未配置 / 来源 / 是否可写`，不回显值。
- 测试时允许把草稿 secret 放进请求体，仅用于本次测试，不落盘、不日志。
- 非 loopback 的 `http:` 页面显示“不要在此输入 token”；远程部署必须 HTTPS。

### 3.6 校验、diff、冲突

**校验分两层：**

1. 核心：`enabled`、`adapter` 存在、`runtime` 数值范围、`adapters` 是对象、`research` 跨字段。
2. adapter：`manifest.fields` 的 required/范围/枚举 + adapter 自己的 `validate()`（例如 URL、重复实例、auth 类型）。
3. 页面把两层错误映射到字段路径，阻止保存；Host 在 probe/搜索前再校验一次。

**保存：**

```ts
const ops: SettingsPathOp[] = []
for (const section of ['search', 'fetch', 'research', 'activation'] as const) {
  if (deepEqual(draft[section], base[section])) {
    ops.push({ op: 'unset', path: [section] })
  } else if (!deepEqual(draft[section], current[section])) {
    ops.push({ op: 'set', path: [section], value: mergeSection(current[section], draft[section]) })
  }
}
await form.mutate(ops, revision)
```

- 与 base 相同 → unset，回到默认/部署值。
- 与 current 相同 → 不发操作。
- 保留未知字段：`mergeSection` 把 draft 覆盖到 current 上，避免升级后丢掉未来 adapter 的配置。
- 一次 `mutate` 原子提交；revision 不匹配整批拒绝。
- 冲突时保留草稿，提示“配置已在别处修改”；用户重新加载后再保存。
- 不做“强制覆盖”。

---

## 4. 搜索适配器框架

### 4.1 SearchDispatcher

```ts
export class SearchDispatcher implements WebSearchProvider {
  readonly id = 'dsh-search-tools'
  private providers = new Map<string, WebSearchProvider>()

  available(): boolean {
    const cfg = this.readConfig()
    if (!cfg.search.enabled) return false
    const adapter = this.registry.getSearchAdapter(cfg.search.adapter)
    if (adapter === undefined) return false
    const validation = adapter.validate(this.adapterConfig(cfg))
    if (validation.errors.length > 0) return false
    return this.providerFor(adapter).available()
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const cfg = this.readConfig()
    const adapter = this.registry.getSearchAdapter(cfg.search.adapter)
    if (adapter === undefined) throw new WebError(`search adapter "${cfg.search.adapter}" is not installed`, 'ADAPTER_NOT_INSTALLED')
    const validation = adapter.validate(this.adapterConfig(cfg))
    if (validation.errors.length > 0) {
      throw new WebError(`search adapter "${adapter.manifest.id}" is misconfigured: ${validation.errors[0]!.message}`, 'ADAPTER_CONFIG_INVALID')
    }
    return this.providerFor(adapter).search(request, signal)
  }
}
```

- `providerFor(adapter)` 缓存每个 adapter 的 provider 实例，避免每次搜索重建缓存；缓存 key 用 adapter 对象（或 `id + 注册代际`），adapter 重新注册/HMR 后重建 provider，不能继续跑旧代码。
- 传 `create(ctx, () => this.adapterConfig(this.readConfig()))`，provider 每次操作读当前 config。
- adapter id 切换时旧 provider 保留在 map 里，切回时复用；dispose 时一起清理。
- `available()` 不发起网络请求，只做本地校验。
- 错误 code 前缀 `ADAPTER_`，保留 cause；页面映射成中文。

### 4.2 抓取 dispatcher

`FetchDispatcher` 同理：

- id：`dsh-search-tools-fetch`。
- `available()`：`fetch.enabled && adapter 存在 && validate 通过 && provider.available()`。
- `fetch()`：委派给 adapter provider。
- 抓取 adapter 的 `WebFetchProvider` 复用 `HttpFetchProvider` 等安全实现。

### 4.3 生命周期

```text
核心 apply
  → 创建 registry
  → 注册内置 searxng / readable-http
  → 创建 dispatcher，注册到 ctx.web
  → 监听 loader/volatile-update：
       - adapter id 变了：providerFor 新 adapter
       - config 变了：provider 的 getConfig() 自动读到新值
       - research.enabled 变了：注册/注销 web_research
  → 注册 settings page / routes
  → dispose：dispose provider、disposer、routes
```

- adapter 的 provider 实例由 dispatcher 持有；adapter 包卸载时 registry 移除，dispatcher 的 `available()` 变 false。
- 外部 adapter 注册/注销发出 `searchTools/changed`；dispatcher 不需要重建，`available()` 每次读 registry。
- in-flight 请求继续用旧 provider；新请求走新 adapter。这是可接受的切换语义。

### 4.4 探测与缓存

**统一 probe 路由**：

```text
POST /api/dsh-search-tools/probe
{ "kind": "search", "adapterId": "searxng", "config": {...}, "secretDrafts": {...} }
```

- 核心找到 adapter，合并 defaults，调用 `adapter.probe`。
- 没有 `probe` 的 adapter 返回 `{ ok: true, details: { skipped: true } }`，页面显示“该适配器不支持连接测试”。
- probe 结果 `suggestions` 用于填充 tags 字段（例如 engines/categories）。
- 不写缓存、不写配置、不记录 secret。

**缓存**：

- 缓存归 adapter 所有（例如 SearXNG 的 LRU）。
- adapter provider 可选实现 `stats()` / `clear()`；dispatcher 转发给 `/status` 和 `/cache/clear`。
- 核心不做跨 adapter 的统一缓存，避免语义混乱。

### 4.5 SearXNG adapter

#### manifest 字段

| group | fields | 类型 |
|---|---|---|
| 实例 | `instances` | list：`url`(url)、`label`(text)、`enabled`(boolean) |
| 认证 | `auth.type` | select：none/bearer/basic |
| 行为 | `engines` | tags，probe suggestions |
| 行为 | `categories` | tags，probe suggestions |
| 行为 | `language` | text/select |
| 行为 | `safesearch` | select 0/1/2 |
| 行为 | `timeRange` | select ''/day/week/month/year |
| 行为 | `pages` | number 1–3 |
| 行为 | `strategy` | select ordered/round-robin |
| 行为 | `method` | select GET/POST |
| 行为 | `format` | select auto/json/html |
| 过滤 | `includeDomains` | tags |
| 过滤 | `excludeDomains` | tags |

secretRefs：

- `SEARXNG_TOKEN`，visibleWhen `auth.type in ['bearer']`
- `SEARXNG_BASIC_AUTH`，visibleWhen `auth.type in ['basic']`

capabilities：

```ts
{
  auth: ['none', 'bearer', 'basic'],
  engines: true, categories: true, language: true,
  safesearch: true, timeRange: true, pagination: true, domains: true, proxy: true,
}
```

#### 请求

```text
GET  <instance>/search?q=...&format=json&categories=general&language=zh-CN&safesearch=1&time_range=year&pageno=1
POST <instance>/search   （method=POST，body application/x-www-form-urlencoded）
```

- `q`：原始查询。
- `format`：`auto` 先 JSON；`json` 只 JSON；`html` 直接 HTML。
- `categories` / `engines`：数组逗号拼接；空数组省略。
- `language`：`all` 或具体语言。
- `safesearch`：0/1/2。
- `time_range`：仅非空发送。
- `pageno`：`pages` >1 时循环 1..pages，合并去重。
- 不发送 `fetch_count` / `fetch_mode`。

#### 认证

- bearer：`Authorization: Bearer <token>`。
- basic：`Authorization: Basic base64(user:pass)`。
- `redirect: 'error'`，避免 token 被跨源重定向带走。
- 错误消息只出现 host，不出现 token/query。

#### JSON 解析

映射 `url/title/content/publishedDate/published_date` → `WebSearchSource`；`answers[]` 与 `infoboxes[].content` 合并成 `content`；`engine/score` 不输出。

去重：

- `normalize-url`：去 `utm_*`/`gclid`、fragment、默认端口，统一协议/主机大小写。
- 重复 URL 保留第一条，合并更长 snippet / 更完整 `publishedAt`。
- 过滤非 http(s)、空 URL、`javascript:`、`mailto:`。
- `includeDomains` / `excludeDomains` 后缀匹配；`example.com` 匹配 `www.example.com`，不匹配 `notexample.com`。

#### HTML 回退

`format=auto` 时：

1. 请求 JSON；成功则用 JSON。
2. 响应 HTML / JSON 解析失败 / 404 → cheerio 解析 HTML。
3. 401/403 不降级（认证问题）。
4. HTML 解析不到结果 → 该实例失败，尝试下一个。
5. 所有实例失败才抛 `SEARXNG_BAD_RESPONSE`。

选择器：

```ts
const resultSelectors = ['article.result', '#urls .result', '.result']
const titleSelectors = ['h3 a', 'a.url_header', 'h3']
const snippetSelectors = ['.content', 'p.content', '.result-content']
const urlSelectors = ['a.url_header[href]', 'h3 a[href]', 'a[href]']
```

新增主题先加 fixture 再改选择器。

#### 多实例、重试、预算

```text
for instance in order:
  for attempt in 0..retries:
    try request(instance, attempt)
    if 2xx and parse ok: return
    if 401/403: record auth failure; break to next instance
    if 429/5xx/network: backoff; retry; then next instance
  next instance
throw last error
```

- `strategy=ordered` / `round-robin`。
- 总预算 `deadlineMs` 用 `AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)])`。
- 单次 `requestTimeoutMs`。
- 只对 429/5xx/连接错误/超时重试。
- 429/503 读 `Retry-After`，不超过剩余预算。
- 退避 `min(500ms * 2^attempt + jitter, 5000ms)`。
- 所有实例失败时，错误包含每个 host + 最后错误类别，不含 token。

#### 缓存

- LRU：`max = cacheMaxEntries`，`ttl = cacheTtlMs`。
- key：query + maxResults + engines + categories + language + safesearch + timeRange + pages + strategy + instances + method + format + include/exclude。
- 只缓存成功结果（包括空结果）。
- 提供 `stats()` / `clear()` 给核心路由。

#### probe

1. `GET <instance>/config`，带认证，超时 8s，`redirect:'error'`。
2. 2xx JSON：解析 version/engines/categories，返回 suggestions。
3. 非 JSON/404：用 `/search?q=test&format=json` 探测 JSON；HTML 200 视为可达但 JSON 关闭。
4. 401/403 → `SEARXNG_AUTH`；超时/网络 → `SEARXNG_ALL_FAILED`。
5. 不回显 token；错误只带 host。

---

## 5. 抓取适配器框架

### 5.1 FetchDispatcher

与搜索 dispatcher 同构：

- id：`dsh-search-tools-fetch`。
- 选择 `fetch.adapter`。
- `available()` 本地校验。
- `fetch()` 委派给 adapter provider。
- 缓存/统计可选。

### 5.2 `readable-http` adapter

manifest：

| group | fields | 类型 |
|---|---|---|
| Readability | `readability` | boolean |
| Readability | `minArticleChars` | number 0–100000 |
| Readability | `maxArticleChars` | number 1000–5000000 |
| Readability | `failOpen` | boolean |

runtime 由核心提供：`timeoutMs`、`maxResponseBytes`、`maxBodyChars`、`maxRedirects`、`userAgent`。

实现：

```ts
const inner = new HttpFetchProvider({
  maxResponseBytes: runtime.maxResponseBytes,
  maxBodyChars: runtime.maxBodyChars,
  timeoutMs: runtime.timeoutMs,
  maxRedirects: runtime.maxRedirects,
  userAgent: runtime.userAgent,
})
```

流水线：

```text
inner.fetch(url)
  → 非 2xx：原样返回
  → text：原样返回
  → html 且 readability=true：
       html.length > maxBodyChars？→ 原样返回
       JSDOM(html, { url })
       new Readability(document, { charThreshold: minArticleChars }).parse()
       textContent.length >= minArticleChars？
         → body = { kind:'html', content: article.content }（截到 maxArticleChars）
         → 内容为空但 text 够长 → { kind:'text', content: textContent }
       否则 → failOpen ? 原样 : 抛 WEB_FETCH_UNREADABLE
  → 任何异常 → failOpen ? 原样 : 抛 WEB_FETCH_UNREADABLE
```

- 返回干净 HTML，让内置 `web_fetch` 的 turndown 保留结构。
- 加 `data-dsh-readable="1"` 标记，`web_research` 跳过二次提取。
- `linkedom` 懒加载；失败则原样透传并 warn 一次。**不要用 jsdom**：它的 `tr46` 依赖会调用 `createRequire(...).resolve.paths`，被 DSH 的 profile resolution hook 打断；linkedom 足够 Readability 使用，且安装体积小得多。
- 内网地址由 `HttpFetchProvider` 的 SSRF 防护拒绝。

### 5.3 未来 fetch adapter（0.1.5 已实现 jina-reader）

同一个 contract：

- `jina-reader`：API key + endpoint，返回 Markdown；0.1.5 已实现，详见附录 H。
- `browser`：调用 DSH `browser-use`，不拥有浏览器；只作为可选 adapter。
- `direct-http`：不做 Readability，只透传。
- `pdf`：单独包，不混进核心。

新增 fetch adapter 不需要改 `web.fetchProvider`，只改 `fetch.adapter`。

---

## 6. `web_research` 工具与卡片

### 6.1 工具参数

| 参数 | 默认 | 范围 |
|---|---|---|
| `query` | 必填 | 非空 |
| `max_results` | `research.maxResults` | 1–max |
| `fetch_top` | `research.defaultFetchTop` | 0–maxFetch |
| `max_chars` | `research.maxCharsPerPage` | 1000–max |

不提供 `time_range`：`ctx.web.search` 请求形状没有这个字段；时间过滤在 adapter 配置或 query 里。

### 6.2 流水线

```ts
if (!config.research.enabled) throw new WebError('web_research is disabled', 'WEB_RESEARCH_DISABLED')
const search = await ctx.web.search({ query, maxResults }, signal)
const selected = search.sources.slice(0, fetchTop)
const fetched = await mapLimit(selected, config.research.concurrency, async (source) => {
  try {
    const res = await ctx.web.fetch({ url: source.url }, signal)
    if (res.statusCode < 200 || res.statusCode >= 300) return { ...source, content: '', error: `HTTP ${res.statusCode}`, truncated: false }
    const readable = res.body.kind === 'html'
      ? await extractReadable(res.body.content, res.url, options, { skipIfMarked: true })
      : { html: null, text: res.body.content }
    const markdown = readable.html ? turndown(readable.html) : readable.text
    const clipped = clip(markdown, maxChars)
    return { url: source.url, title: readable.title ?? source.title, content: clipped.text, truncated: res.truncated || clipped.truncated }
  } catch (error) {
    return { url: source.url, title: source.title, content: '', error: messageOf(error), truncated: false }
  }
})
```

- 单条失败不影响其他。
- 总字符预算按顺序裁剪。
- 取消转发 `exec.signal`。
- 动态启停：`loader/volatile-update` 时注册/注销工具。

### 6.3 输出与卡片

输出包含 `query`、`sources`、`fetched`、`truncated`；`presentationMeta` 只放紧凑数据（来源数、抓取成功/失败、域名、字符数），卡片从持久 meta 回放。

卡片：

- 运行中：query + “搜索中…”。
- 完成：来源数、抓取成功/失败、域名 chips。
- 展开：来源列表、抓取页面、失败原因。
- 外部内容提示徽章。
- 坏 meta 回退到一行 generic 展示。

---

## 7. 设置页

### 7.1 入口

在设置弹框新增独立菜单：

```ts
ctx.slots.inject('settings.section', () =>
  ctx.slots.register({
    name: 'settings.section',
    id: 'search-tools',
    order: 16,
    label: () => t('nav'),
    locale: NS,
  }, SettingsPage))
```

- 菜单显示“搜索工具”。
- 页面收到 owner 的 `close` 回调，可放“完成”按钮。
- `settings.section` 没有 icon 字段，未知 id 回退通用齿轮；功能不受影响。
- 插件详情页保留状态、接管警告和“去设置”；不保留第二份可编辑表单。

### 7.2 Provider picker + 通用渲染器

页面顶部：

```text
搜索后端
[ SearXNG ] [ Exa ] [ Tavily ] [ + 安装适配器 ]
  已安装 / 已配置 / 未配置
```

- 列表来自 `/adapters` + 内置 registry。
- 选中 adapter 写入 draft `search.adapter`。
- 切换时保留其他 adapter 的配置。
- 未安装但 YAML 有配置的 adapter 显示“未安装配置”，可删除。
- “刷新适配器”按钮重新拉取 manifest。

通用渲染器：

- 按 `manifest.groups` 分组。
- 按 `manifest.fields` 渲染 `text/url/textarea/number/boolean/select/tags/list`。
- 密码类输入只来自 `manifest.secretRefs`，不来自普通 `fields`；普通字段不允许承载密钥。
- `visibleWhen` 条件显示。
- `tags` 支持 probe suggestions。
- `list` 支持添加/删除/上移/下移；SearXNG 实例用它。
- `secretRefs` 渲染密码框 + 凭据状态 + 保存/清除。
- 未知字段类型显示错误，提示升级插件。

### 7.3 页签

| 页签 | 内容 |
|---|---|
| 概览 | 当前 adapter、可用状态、接管开关、快速搜索/抓取测试、最近错误 |
| 搜索 | provider picker、adapter 字段、通用 runtime（超时/重试/缓存/UA/代理）、测试 |
| 抓取 | fetch provider picker、adapter 字段、通用 runtime、抓取预览 |
| 研究 | 研究上限、并发、超时、工具提示词预览 |
| 高级 | 缓存、诊断、YAML 路径、未安装 adapter 配置、恢复默认、接管警告 |

### 7.4 测试与接管

- 实例/连接测试：`POST /probe`，body 带 `kind`、`adapterId`、草稿 config、secret drafts。
- 搜索测试：`POST /search-preview`，返回通用 sources。
- 抓取预览：`POST /fetch-preview`，返回 Markdown 预览。
- 接管：
  - 搜索开关：测试通过后写 `web.searchProvider = 'dsh-search-tools'`。
  - 抓取开关：写 `web.fetchProvider = 'dsh-search-tools-fetch'`。
  - 记录 previous provider 到 `activation`。
  - 关闭时恢复 previous；空值则 unset。
- 详情页 `plugins.detail.section` 显示接管警告 + “关闭接管”。
- `plugins.bundle.activation` 启用后引导“去设置 → 搜索工具”。

### 7.5 状态与可访问性

- 顶部状态：当前 adapter、实例/连接状态、缓存、最近错误。
- 空状态：没有 adapter 配置时引导“选择 SearXNG → 添加实例 → 测试”。
- 加载：骨架屏。
- 只读：settings 被覆盖/不可写时禁用保存。
- 冲突：保留草稿 + 重新加载。
- 所有输入有 label；错误 `aria-invalid` + `role=status`；支持 `Cmd/Ctrl+S`。
- 只用 `--dsw-*` token；深浅色、800px 窄屏手工验收。

---

## 8. Host routes

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/dsh-search-tools/status` | 当前 adapter、可用性、配置路径、缓存、凭据、最近错误 |
| `GET` | `/api/dsh-search-tools/adapters` | 搜索/抓取 manifest 列表 |
| `POST` | `/api/dsh-search-tools/probe` | 用草稿 config/secret 探测 adapter |
| `POST` | `/api/dsh-search-tools/search-preview` | 用草稿 config 跑一次搜索 |
| `POST` | `/api/dsh-search-tools/fetch-preview` | 用草稿 config 抓一个 URL |
| `POST` | `/api/dsh-search-tools/cache/clear` | 清空当前 adapter 缓存 |

认证与边界：

- `ctx.inject(['webServer', 'connection'], ...)` 才注册；CLI profile 不受影响。
- 每个 handler 先 `connection.requestRejection(req)`。
- 方法/`application/json`/64 KiB 限制；错误统一 `{ code, message }`。
- 不记录请求体；日志只记 adapter id、code、host、耗时。
- `secretDrafts` 只允许所选 adapter 的 `manifest.secretRefs` 声明的 ref；其他 ref 一律拒绝，避免测试接口变成任意凭据读取口。
- 非 loopback 的 HTTP 页面显示 token 警告；远程必须 HTTPS。
- `probe` 允许用户显式配置的内网 SearXNG；`readable-http` 的 `fetch-preview` 受 DSH SSRF 防护，内网会被拒；`jina-reader` 只做公网目标预检，实际由 Reader 抓取，不能视为连接级 SSRF 防护。
- 页面 fetch 用 `new URL('api/...', document.baseURI)`，兼容 `--public-url`。

---

## 9. 工程结构、构建与发布

### 9.1 目录

```text
dsh-search-tools/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.client.json
├── tsdown.config.ts
├── vitest.config.ts
├── cordis.patch.yml
├── icon.svg
├── locale/{en,zh}.json
├── LICENSE
├── README.md
├── README.zh.md
├── CHANGELOG.md
├── SECURITY.md
├── THIRD_PARTY_NOTICES.md
├── tsdown.client.config.ts
├── src/
│   ├── index.ts                 # Host apply
│   ├── config/
│   │   ├── schema.ts
│   │   ├── defaults.ts
│   │   └── config.ts            # snapshot/validate
│   ├── adapters/
│   │   ├── types.ts             # contract
│   │   ├── registry.ts          # ctx.searchTools
│   │   ├── searxng/
│   │   │   ├── adapter.ts
│   │   │   ├── manifest.ts
│   │   │   ├── client.ts
│   │   │   ├── parse-json.ts
│   │   │   ├── parse-html.ts
│   │   │   └── probe.ts
│   │   └── readable-http/
│   │       ├── adapter.ts
│   │       ├── manifest.ts
│   │       └── readability.ts
│   ├── providers/
│   │   ├── search-dispatcher.ts
│   │   └── fetch-dispatcher.ts
│   ├── research/
│   │   ├── tool.ts
│   │   ├── pipeline.ts
│   │   └── render.ts
│   ├── host/
│   │   ├── routes.ts
│   │   ├── diagnostics.ts
│   │   └── status.ts
│   ├── shared/
│   │   ├── validate.ts
│   │   ├── diff.ts
│   │   ├── form.ts              # manifest 表单纯逻辑
│   │   ├── url.ts
│   │   ├── limit.ts
│   │   └── errors.ts
│   └── client/
│       ├── index.tsx            # settings.section / tool card
│       ├── SettingsPage.tsx
│       ├── ProviderPicker.tsx
│       ├── ManifestForm.tsx
│       ├── ResearchCard.tsx
│       ├── api.ts
│       ├── locales.ts
│       └── styles.ts
├── tests/
│   ├── fixtures/
│   ├── config.spec.ts
│   ├── registry.spec.ts
│   ├── dispatcher.spec.ts
│   ├── searxng-adapter.spec.ts
│   ├── fetch-adapter.spec.ts
│   ├── research-tool.spec.ts
│   ├── routes.spec.ts
│   └── client/
│       ├── settings-page.spec.tsx
│       ├── manifest-form.spec.tsx
│       └── research-card.spec.tsx
└── .github/workflows/{ci,release}.yml
```

### 9.2 `package.json`

```json
{
  "name": "dsh-search-tools",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": [
    "lib",
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
    "README.md",
    "README.zh.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md"
  ],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-plugin-manager",
        "@deepseek-ai/dsh-client-ui-tool",
        "@deepseek-ai/dsh-api-remotes"
      ]
    }
  },
  "engines": {
    "dsh": ">=0.2.0 <0.3.0",
    "node": "^22.19.0 || >=24.0.0"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1-rc.1",
    "@deepseek-ai/dsh-credentials": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-tools": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-web": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-web-fetch-http": "^0.0.1-rc.1",
    "@deepseek-ai/schemastery": "^3.18.5"
  },
  "dependencies": {
    "@joplin/turndown-plugin-gfm": "^1.0.67",
    "@mozilla/readability": "^0.6.0",
    "cheerio": "^1.1.2",
    "linkedom": "^0.18.13",
    "lru-cache": "^11.2.2",
    "normalize-url": "^8.1.0",
    "turndown": "^7.2.0",
    "undici": "^7.16.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1-rc.1",
    "@deepseek-ai/dsh-api-remotes": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-client-locale": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-client-ui-plugin-manager": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-client-ui-settings": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-client-ui-slots": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-client-ui-tool": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-credentials": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-tools": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-web": "^0.0.1-rc.1",
    "@deepseek-ai/dsh-web-fetch-http": "^0.0.1-rc.1",
    "@deepseek-ai/schemastery": "^3.18.5",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^22.15.0",
    "@types/react": "^18.3.0",
    "@types/turndown": "^5.0.6",
    "@vitest/coverage-v8": "^4.1.11",
    "publint": "^0.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsdown": "^0.22.2",
    "typescript": "^6.0.3",
    "vitest": "^4.1.11"
  }
}
```

说明：

- 客户端类型包只做 devDependency，运行时由 DSH 平台模块表提供。
- 外部 adapter 包用 `peerDependencies: { "dsh-search-tools": "^0.1.0" }`，并注入 `searchTools`。
- `engines.dsh` 限定 `<0.3.0`；DSH preview API 变化时先跑适配层测试。
- **实现骨架的版本口径**：npm `latest` 仍是旧的 `0.0.1-rc.1`，真正的 0.2.1 包挂在 `next`（`0.2.1-rc.2`）。实际 `package.json` 用 `0.2.1-rc.2`，并以它为准；`@deepseek-ai/dsh-invariants` 没有 0.2.1-rc.2，使用 `0.2.0-rc.2`。

### 9.3 构建

- Host：tsdown ESM → `lib/index.js`；`tsc` → `lib/types`。
- Client：`tsdown.client.config.ts` 复刻 lazy-CJS factory：
  - `format: 'cjs'`，`platform: 'browser'`
  - external：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-slots`
  - banner：`window.__ModuleLoader__.load({ id: "dsh-search-tools", factory: (require) => {`
  - intro：`var module = { exports: {} }; var exports = module.exports;`
  - footer：`return module.exports; } });`
- CSS 用 `styles.ts` 字符串注入，避免 CSS Modules 构建链。
- 构建后 Node smoke test：捕获 factory，执行，确认导出 `apply`。

### 9.4 `cordis.patch.yml`

```yaml
- insert:
    - id: dsh-search-tools
      name: dsh-search-tools
      config:
        search:
          enabled: true
          adapter: searxng
          adapters:
            searxng:
              instances: []
        fetch:
          enabled: true
          adapter: readable-http
          adapters: {}
        research:
          enabled: true
          defaultFetchTop: 3
```

- `id` 必须是 `dsh-search-tools`（设置页命名空间）。
- `name` 必须是裸包名（客户端半侧挂载）。
- 开发 overlay 也必须用同一个 `id`，否则 `settings.section` 找不到配置命名空间。
- 不覆盖 `web` 行；接管由页面写入。

### 9.5 安装与卸载

**用户主路径（无 CLI）**：

1. 侧栏「插件」→「添加插件」。
2. 输入 `dsh-search-tools`。
3. 安装 → 启用。
4. 引导“去设置 → 搜索工具”。
5. 配置 → 测试 → 接管。

**卸载**：

- 先在设置页关闭搜索/抓取接管。
- 再卸载。
- 如果忘记关闭，内置搜索会报 `WEB_PROVIDER_CONFIGURED_MISSING`；重新安装并关闭接管，或手工把 `web.searchProvider` 恢复为 `deepseek-official`。
- 页面和详情页显示接管警告；不做 dispose 时自动写设置（避免 HMR 递归）。

---

## 10. 测试与验收

### 10.1 单元测试

| 模块 | 用例 |
|---|---|
| `registry` | 注册/注销；重复 id；contract version 不匹配；manifest 可序列化；disposer 清理 |
| `config` | 默认值；`adapters` 字典；section volatile；snapshot |
| `validate/diff` | 字段校验；与 base 相同 unset；未知字段保留；冲突 |
| `dispatcher` | adapter 选择；未安装；配置无效；available；缓存实例复用；信号转发 |
| `manifest-form` | 每种字段类型；visibleWhen；tags suggestions；list 增删排序；未知字段类型 |
| `searxng-adapter` | JSON/HTML；auth；failover；round-robin；分页；过滤；缓存；probe |
| `fetch-adapter` | Readability/回退；标记；SSRF 由 inner 覆盖；failOpen；Jina 公网目标守卫/协议映射/状态与超时 |
| `research` | 部分失败；并发；字符预算；动态启停 |
| `routes` | 认证；方法；content-type；body 限制；adapters/status/probe/search/fetch |
| `apply` | 注册 dispatcher；外部 adapter 注册；dispose |

### 10.2 客户端测试

- `SettingsPage`：空状态；provider picker；切换 adapter 保留旧配置；保存 ops；冲突；只读。
- `ManifestForm`：所有字段类型；条件字段；list；tags；未知类型。
- `ResearchCard`：运行/完成/错误/坏 meta。
- 可访问性：label、aria、键盘保存、状态播报。

### 10.3 扩展性专项测试（Release Gate）

必须证明“加 adapter 不用改核心页面”：

1. 在测试中注册一个 `fixture` search adapter：
   - manifest 一个 `text` 字段；
   - `create` 返回固定 sources；
   - `probe` 返回固定 suggestions。
2. 设置页的 provider picker 出现 `fixture`，字段自动渲染。
3. 选择 `fixture`、保存、通过 `/search-preview` 得到固定结果。
4. 不改 `SettingsPage.tsx` / `config.ts` / `search-dispatcher.ts`。
5. 重复注册同一 id 报错；contract version=2 被拒。
6. 外部 adapter 通过 `ctx.searchTools.registerSearchAdapter()` 注册后，`/adapters` 能看到。

### 10.4 手工验收

1. 干净 profile 安装 tarball；插件页显示。
2. 设置弹框出现“搜索工具”菜单；打开页面。
3. 选择 SearXNG；添加本地 mock 实例；测试；保存。
4. 搜索测试/抓取预览成功。
5. 接管内置 `web_search`/`web_fetch`；对话验证。
6. `web_research` 返回 sources + 正文；卡片正常。
7. YAML 中存在 `adapters.searxng`；`grep` 不到 token。
8. 刷新/重启后配置保留。
9. 切换到一个测试 fixture adapter（开发构建）；页面字段变化，核心页面未改。
10. 关闭接管恢复默认；卸载警告可见。

---

## 11. 里程碑

| 阶段 | 内容 | 工期 |
|---|---|---|
| **M0** | 客户端半侧 + 设置 section + registry + fixture adapter + YAML 保存 + adapters/status route | 3 天 |
| M1 | 核心 Config/registry/dispatcher/生命周期 | 3 天 |
| M2 | SearXNG adapter（manifest + client + probe + tests） | 3 天 |
| M3 | fetch adapter 框架 + readable-http | 2 天 |
| M4 | `web_research` + 卡片 | 3 天 |
| M5 | Host routes（probe/search/fetch/status/adapters/cache） | 2 天 |
| M6 | 设置页：provider picker + 通用表单 + 五页签 + 测试/接管/诊断 | 6 天 |
| M7 | 打包/CI/README/Release | 3 天 |
| **合计** | | **约 25 人日 / 5–6 周** |

M0 是硬门槛：

- 真实 DSH GUI 里设置弹框出现“搜索工具”。
- 页面出现 fixture adapter。
- 改一个字段保存到 YAML。
- `/adapters` 和 `/status` 认证通过。
- 任何一项失败，就停下来重估，不退回“只做 SearXNG 硬编码”的方案。

---

## 12. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 过度抽象 | 核心代码复杂、开发慢 | contract 只有 4 个成员；v0.1.0 只实现一个内置 adapter；fixture 测试证明够用 |
| 通用表单表达力不足 | 某些后端要自定义 UI | v1 字段 DSL 覆盖常见；复杂 OAuth/交互后续用 adapter action 或独立设置页 |
| 外部 adapter 质量参差 | 核心被拖垮 | contract version、manifest 校验、错误隔离、页面标记来源 |
| adapter 配置保存时无 Host schema 校验 | 手改 YAML 可写坏 | 页面校验 + adapter `validate` + `available()` 拒绝；状态页显示 |
| provider id 稳定但 adapter 切换失败 | 内置搜索报错 | 页面测试门槛；`available()` 变 false；错误可读 |
| 停用/卸载后 `web.searchProvider` 悬空 | 内置搜索报错 | 详情页警告 + 关闭接管；README；不自动 dispose 写入 |
| 第三方 adapter 包与核心版本不匹配 | 注册失败 | contract version + peer semver；日志/页面提示 |
| DSH preview API 变化 | 页面/配置失效 | `engines.dsh` + 适配层 + CI 固定基线 |
| `linkedom` 解析差异 | 个别页面提取不完整 | 懒加载；2MB 上限；可关 Readability；fixture 回归 |
| SearXNG 主题变化 | HTML 回退失效 | fixture + 多选择器 |
| 配置被 home patch 覆盖 | 页面只读 | 显示 Host 原话；不假装成功 |

---

## 13. 版本路线

### v0.1.0

- Adapter contract v1 + registry + search/fetch dispatcher。
- SearXNG adapter + readable-http adapter。
- `web_research` + 卡片。
- 设置弹框独立页 + provider picker + manifest 通用表单。
- 测试、接管、诊断、YAML、credentials、npm/tarball、MIT。

### v0.1.x

- 新 SearXNG 主题 fixture。
- Windows 实测修复。
- adapter manifest 字段补充（不破坏 v1）。
- 页面文案/性能打磨。

### v0.2.0（候选）

- 第二个内置 adapter（Exa 或 Tavily），验证扩展成本。
- adapter actions（OAuth/device flow）。
- 多 adapter 聚合（composite adapter）。
- 抓取缓存。
- 按 adapter 的独立设置页 escape hatch。

### v0.3.0（候选）

- 浏览器 fetch adapter（调用 `browser-use`）。
- 每 adapter 指标/延迟/成功率。
- 独立 `dsh-search-tools-adapters` 生态包。

### 1.0.0

- DSH 稳定后冻结 adapter contract v1；在此之前 contract 可能加字段，但不破坏现有 adapter。

---

## 14. 需要爸爸拍板

| # | 决策 | 建议 |
|---|---|---|
| 1 | 是否采用 adapter-first 架构？ | **是**；否则加第二个后端要改 schema/UI |
| 2 | provider id 用稳定 dispatcher id，还是每个 adapter 一个 id？ | **稳定 id**：`dsh-search-tools` / `dsh-search-tools-fetch` |
| 3 | 设置页是否由 manifest 驱动？ | **是**；加 adapter 不改页面 |
| 4 | 外部 adapter contract 是否在 0.1.0 发布？ | **发布 v1，标记实验性**；先服务内置和 fixture |
| 5 | 抓取是否也用 adapter 框架？ | **是**；readable-http 是第一个 |
| 6 | v0.1.0 是否只交付 SearXNG？ | **是**；架构留好，不先做空 adapter |
| 7 | 设置弹框独立菜单「搜索工具」？ | **是**；插件详情页只做状态/警告 |
| 8 | YAML 仍用 profile `cordis.patch.yml`？ | **是**；页面是唯一编辑器，密钥走 credentials |

---

## 附录 A：外部 adapter 示例

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { SearchAdapter, WebSearchProvider } from 'dsh-search-tools'

const exaAdapter: SearchAdapter = {
  manifest: {
    contractVersion: 1,
    id: 'exa',
    label: 'Exa',
    description: 'Exa neural/keyword search',
    order: 20,
    groups: [{ id: 'main', label: '连接' }],
    fields: [
      { kind: 'url', key: 'baseURL', label: 'API 地址', group: 'main' },
      { kind: 'select', key: 'searchType', label: '搜索类型', group: 'main', options: [
        { value: 'auto', label: '自动' },
        { value: 'keyword', label: '关键词' },
        { value: 'neural', label: '语义' },
      ] },
    ],
    secretRefs: [
      { key: 'apiKey', ref: 'EXA_API_KEY', label: 'Exa API Key', group: 'main' },
    ],
    defaults: { baseURL: 'https://api.exa.ai', searchType: 'auto' },
    capabilities: { auth: ['api-key'] },
  },
  validate(config) {
    const value = config as { baseURL?: string }
    return value.baseURL?.startsWith('http')
      ? { errors: [] }
      : { errors: [{ path: 'baseURL', message: 'baseURL must be an http(s) URL' }] }
  },
  create(ctx, getConfig): WebSearchProvider {
    return {
      id: 'exa',
      available: () => true,
      async search(request, signal) {
        const config = getConfig() as { baseURL: string }
        const key = await ctx.resolveSecret('EXA_API_KEY')
        if (!key) throw new Error('EXA_API_KEY is not configured')
        // fetch Exa, map to WebSearchResult
        return { sources: [], truncated: false }
      },
    }
  },
  async probe(ctx, config) {
    const key = await ctx.resolveSecret('EXA_API_KEY')
    return { ok: key !== undefined, message: key ? 'configured' : 'missing EXA_API_KEY' }
  },
}

export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.searchTools.registerSearchAdapter(exaAdapter), 'exa adapter')
}
```

---

## 附录 B：为什么外部 adapter 不需要客户端代码

- 设置页不加载 adapter 的 React 组件。
- adapter 只提供 JSON 可序列化的 manifest。
- 页面用通用字段渲染器绘制表单；字段值写入 `search.adapters.<id>`。
- 密码字段通过 `secretRefs` 声明，页面写入 DSH credentials。
- 如果某个 adapter 需要完全自定义 UI，v0.1.0 不支持；它可以在未来发布自己的 `settings.section`，但那就不是“统一设置页”的一部分。

---

## 附录 C：关键参考

- `packages/web/web/src/index.ts` — `ctx.web` provider 注册与选择
- `packages/web/web/src/types.ts` — provider/request/result 类型
- `packages/web/web-fetch-http/src/provider.ts` — 安全 HTTP 抓取
- `packages/settings/settings/src/index.ts` — Config 表单/YAML 持久化
- `packages/boot/config-editor/src/index.ts` — 原子写/冲突
- `packages/client/ui-settings/src/client/config-form.ts` — `ctx.configForms`
- `packages/client/ui-settings-general/src/client/index.ts` — `settings.section`
- `packages/client/ui-plugin-manager/src/client/slot-contract.ts` — `plugins.bundle.config`
- `packages/client/ui-tool/src/client/contract/slots.ts` — `tool.call.toolview`
- `~/.dsh/profiles/web/node_modules/dsh-context` — 第三方客户端页面实例
- [SearXNG search API](https://docs.searxng.org/dev/search_api.html)

---

## 附录 D：v2 → v3 差异

| 项 | v2 | v3 |
|---|---|---|
| 搜索后端 | 写死 SearXNG Config | `search.adapter` + `adapters` 字典 |
| provider id | `searxng` | `dsh-search-tools`（稳定） |
| 页面字段 | 手写 SearXNG 表单 | manifest 驱动的通用表单 |
| 加后端 | 改 schema/UI/接管 | 新增 adapter 模块/包 |
| 外部扩展 | 无 | `ctx.searchTools.registerSearchAdapter()` |
| 抓取 | 手写 readable-http | fetch adapter 框架 + readable-http |
| 测试 | SearXNG 单测 | + fixture adapter 扩展性测试 |
| 工期 | 约 24 人日 | 约 25 人日（架构替代部分手写表单） |

---

## 附录 E：0.1.2 UI/UX 修订

0.1.2 只改设置页的呈现和信息架构，不改 provider id、配置结构、接管、凭据、搜索/抓取/研究语义。

### E.1 设计系统修复

旧页面引用的 10 个 `--dsw-*` 名称在 DSH 0.2.1-rc.2 中不存在，导致提示与错误同色、adapter 卡无焦点环、prompt 预览不是等宽字体。0.1.2 改用：

- 文本：`--dsw-alias-label-primary/secondary/tertiary`
- 表面：`--dsw-alias-settings-card-fill` / `--dsw-alias-bg-layer-3`
- 描边：`--dsw-alias-border-l2/l4`
- 语义：`--dsw-alias-state-error-primary` / `warn` / `success` / `business`
- 代码：`--ds-font-family-code`
- 焦点：`--dsw-focus-ring-width` / `--dsw-focus-ring-color`

所有组件共用 `dshst-page` 的本地语义变量，禁止再直接写已失效的 token。

### E.2 信息架构

- 顶部 hero 显示搜索、抓取、研究三个状态；不再在标题旁重复一个状态 tag。
- 五个等宽 tab：Overview / Search / Fetch / Research / Diagnostics。
- Search 分为 Connection、Search behavior、Advanced（默认折叠）；实例改为 sub-card。
- Fetch 分为 Extraction、Safety limits；测试预览保留在同一页。
- Research 分为 Research scope、Content budget（含预算条）、Execution、Model-facing prompt。
- 原 Advanced 改为 Diagnostics；只放运行时事实、配置路径、错误和清理动作。
- 底部操作条 sticky，并用不透明表面避免长表单内容透出；页面底部留出滚动余量。

### E.3 响应式与无障碍

- 页面是 CSS container；520px 以上字段两列，416px 单列，实例字段在 520px 以上才两列。
- 416px 下五个 tab 仍是一行，action bar 按钮换行而不是溢出。
- `:focus-visible` 覆盖 adapter 卡、tab、字段、summary、实例按钮和 action bar 按钮。
- 错误/hint 使用不同语义 token；错误有 `role="alert"` 与 `aria-invalid`。
- 测试和实例操作有可区分的 accessible name；开关同时显示 On/Off 文本。

### E.4 Manifest 扩展

`groups`、`field.group`、`field.advanced`、`field.unit`、`secret.group` 都是可选展示元数据。无 groups 的外部 adapter 仍按一个 Configuration 块渲染；未知 group 回退到第一个组；`advanced` 字段自动进入折叠区。校验和存储结构完全不变。

---

## 附录 F：0.1.3 缺口补齐

0.1.3 只补 0.1.2 审计中的缺口，不新增搜索/抓取能力。

### F.1 Search 高度

Search 内部分为 Connection / Search behavior 两个子页；当前后端在全量 picker 之外提供紧凑摘要和 Change backend。面板高度（不含全局 hero/tabs/actionbar）：

| 内容宽度 | Connection | Search behavior | 目标 |
|---|---:|---:|---:|
| 564px | 772px | 928px | ≤ 1,000px |
| 416px | 842px | 1,194px | ≤ 1,400px |
| 560px 受控宽度 | 772px | 928px | ≤ 1,000px |

### F.2 Fetch reader

Fetch 结果使用 DSH `CodeBlock`，支持 Copy content、Hide content / Show content；每次新 preview 自动展开并重置复制状态。`readable-http` 的原始正文和 reader 来自 DSH SSRF 防护的抓取结果；`jina-reader` 的目标页由 Reader 服务抓取，只经过公网目标预检，不享有同一连接级保证，自托管时必须限制 Reader 出口。

### F.3 状态与拆分

- 冲突：表单拒绝保存时同时显示独立 warning notice 和 actionbar 状态。
- 凭据：写入/清除失败显示字段级 `role="alert"` 错误和 `aria-invalid`，用户重新输入时清除。
- 组件：`SettingsPage.tsx` 保留状态与编排，五个 tab、AdapterPicker、TestConsole、ResearchBudget、ResearchPrompt、SettingRows、Feedback 分别拆文件；主文件 691 行。
- 操作条：页面底部预留 104px，覆盖 564px 下 54px、416px 下 83px 的 actionbar。

### F.4 证据

560px 使用受控容器宽度；失败/只读/冲突/凭据错误由组件测试覆盖，真实 GUI 覆盖成功态、reader、焦点和 564/416 布局。未把受控 560px 当作物理设备验证。

---

## 附录 G：0.1.4 配置契约与搜索/抓取正确性

0.1.4 不新增 adapter，只修正已有链路与配置契约；稳定 provider id、SSRF 边界和
manifest 驱动的设置页结构保持不变。

### G.1 配置契约

- 搜索：`userAgent` 进入真实请求与 probe；`language` 派生 `accept-language`，
  `all` 不发送；`deadlineMs` 用共享 signal 覆盖实例、重试、分页与退避；
  `cacheTtlMs=0` 和 `cacheMaxEntries=0` 都关闭缓存；缓存键加入 `auth.type`、
  `proxy`、`userAgent`；`proxy` 同时用于 probe。
- 抓取：所有数值/布尔/UA 字段在宿主 `validate()` 中校验；`maxArticleChars`
  是正文文本上限，并限制 `maxArticleChars <= maxBodyChars`；`readable-http`
  导出真实 probe。
- 研究：`timeoutMs` 同时进入工具声明超时和内部 signal；抓取预算在请求/提取前
  预留；当前 fetch adapter 的 `maxBodyChars`/`minArticleChars` 被读取；Markdown
  标题/摘要/链接做转义。
- 状态：`/status` 的 `fetch.available` 和 `research.registered` 来自真实 runtime；
  Fetch chip 和 Diagnostics 使用这两个字段。

### G.2 搜索韧性

- 分页 `Promise.allSettled`：成功页合并，失败页进 `notes`，全失败才抛错。
- `format=auto`：JSON 403/415/406 或解析失败时同实例回退 HTML；401 保持认证错误。
- probe：`/config` 404 或非 JSON 时用一次 `/search` JSON 探测；HTML-only 200
  报告 `json=false, html=true`。
- 结果：单条标题/摘要和整段答案有安全上限；重复 URL 保留更长的标题/摘要。

### G.3 抓取正文

`ReadableExtraction` 返回 `truncated`、`textChars`、`htmlChars`；`truncated` 由
提取器按文本语义决定。HTML 截断优先按块级节点，无法安全截断时返回纯文本，
保证不产生半截标签。`maxArticleChars` 与 `maxBodyChars` 的跨字段关系由
`validateReadableHttpConfig` 拒绝保存。

### G.4 研究预算与超时

`runResearch` 在并发 worker 启动时先预留每页最坏预算，预算为 0 的页面不再
发起抓取；`timeoutMs` 到点会 abort 搜索/抓取并返回 `WEB_RESEARCH_TIMEOUT`。
`research.timeoutMs` 变化时，`index.ts` 会重新注册 `web_research`，使声明超时
与配置一致。

### G.5 测试边界

新增宿主契约测试覆盖 UA/参数、部分分页、格式/probe 回退、deadline/abort、
缓存 TTL/键、fetch transport limits/probe、fail-open/closed、研究超时/预算/
并发、Markdown 转义和状态真相。真实 DSH GUI 复验了 0.1.4 版本、五 tab、
fetch 可用性、research 注册、fetch probe、数字校验失败态、prompt 复制、
搜索请求头和 700/560 布局；物理设备、屏幕阅读器与非 Chromium 引擎仍未覆盖。

---

## 附录 H：0.1.5 Jina Reader 激进抓取后端

0.1.5 新增第二个 fetch adapter，但**不改变**默认 `readable-http`、稳定 provider
id `dsh-search-tools-fetch`、`web_fetch` 参数 schema 或 DSH 权限模型。Jina 是
显式 opt-in：用户在抓取页选择后才生效。

### H.1 为什么是 Jina

`readable-http` 不执行 JS，不能读 PDF/Office，没有选择器/iframe/Shadow DOM。
Jina Reader 用 `X-Engine: browser` 在服务端渲染，返回 Markdown/HTML，并支持
`X-Target-Selector`、`X-Wait-For-Selector`、`X-Remove-Selector`、iframe、
Shadow DOM、`X-No-Cache`、`X-Proxy` 和自托管。它不登录、不绕过付费墙、不破解
验证码；这些仍是明确非目标。

### H.2 契约

- 新 adapter：`src/fetch/adapters/jina-reader/`（adapter、manifest、provider、
  schema、target）。
- `AdapterManifest.notice?` 是通用数据边界提示；`browser`/`pdf` 是新 capability。
- `FetchResult` 形状不变：Markdown/text → `body.kind='text'`；HTML 模式 →
  `body.kind='html'`。`web_research` 无需改 pipeline。
- `JINA_API_KEY` 只走 DSH credentials/env，不进入 YAML；`endpoint`、`engine`、
  `responseMode`、超时、大小上限、选择器、隐私开关全部进入真实请求。
- 公共目标守卫：拒绝 URL 内凭据、非 http(s)、loopback/private/link-local 字面量，
  以及 DNS 答案含非公网地址的主机；常见 IPv4-mapped/IPv4-compatible/NAT64 也处理。
- 错误码：`JINA_INVALID_TARGET`、`JINA_TARGET_BLOCKED`、
  `JINA_TARGET_UNRESOLVED`、`JINA_AUTH`、`JINA_RATE_LIMIT`、`JINA_HTTP`、
  `JINA_NETWORK`、`JINA_TIMEOUT`、`JINA_BAD_RESPONSE`、
  `JINA_RESPONSE_TOO_LARGE`。
- host `fetch-preview`/fetch `probe` 的 signal 按草稿 `timeoutMs` 放大：基线
  30s/30s，加 5s，封顶 190s；`web_fetch` 的 30s 工具超时仍是 DSH 侧限制。

### H.3 安全边界

托管 Jina 会把目标 URL 发给 Reader 服务并可能缓存；只有自托管 Reader 能把
页面留在本地。目标守卫是 best-effort：Reader 会重新解析 DNS，并可能跟随目标
页重定向/浏览器导航，本插件无法像 `HttpFetchProvider` 一样 pin 连接；自托管
Reader 的出口必须单独限制。Jina 的 manifest `notice`、README、SECURITY 和
设置页 warning 都明确这一点；默认仍是 `readable-http`。

### H.4 测试边界

Jina 合同测试使用 fake Reader 验证：请求方法/body/全部头、API key 读取与
隔离、目标 404、401/429/5xx、超时/abort、正文截断、响应字节上限、坏 JSON、
probe、公网目标守卫、设置页 notice/校验/密钥写入、默认值、host 超时。
真实 DSH GUI 使用本地 fake Reader 验证端到端；托管 `r.jina.ai` 的匿名 401
只证明可达性与错误映射，真实 key/自托管成功路径需在具备条件的 profile 复验。
