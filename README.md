# dsh-search-tools

[简体中文](README.md) · [English](https://github.com/ThzxxArt/dsh-search-tools/blob/main/README.en.md)

[![npm](https://img.shields.io/npm/v/dsh-search-tools?label=npm)](https://www.npmjs.com/package/dsh-search-tools)
[![CI](https://github.com/ThzxxArt/dsh-search-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/ThzxxArt/dsh-search-tools/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/ThzxxArt/dsh-search-tools/blob/main/LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供 **adapter-first 的网页搜索与正文抓取**。所有配置都在 DSH Web GUI 的 **设置 → 搜索工具** 完成，不要求用户手改 YAML。

> **当前版本：0.1.1（2026-10-22）。** 这是 0.1.0 之后的文档与元数据修订版：功能面不变，主 README 改为完整中文，新增英文 README。0.1.0 已完成真实 DSH、真实 SearXNG、真实模型工具回合和 Web GUI 验收；构建、测试、打包与 publint 门禁通过。详细证据见 [M0 验收记录](https://github.com/ThzxxArt/dsh-search-tools/blob/main/docs/m0-verification.md)。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [功能一览](#功能一览)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [安装与升级](#安装与升级)
- [快速开始](#快速开始)
- [设置页说明](#设置页说明)
- [配置参考](#配置参考)
  - [配置存放位置](#配置存放位置)
  - [SearXNG 搜索配置](#searxng-搜索配置)
  - [Readability HTTP 抓取配置](#readability-http-抓取配置)
  - [web_research 配置](#web_research-配置)
  - [接管配置](#接管配置)
- [模型工具](#模型工具)
- [安全模型](#安全模型)
- [适配器开发](#适配器开发)
- [本地开发](#本地开发)
- [发布流程](#发布流程)
- [故障排查](#故障排查)
- [已知限制](#已知限制)
- [许可证与第三方组件](#许可证与第三方组件)

---

## 它解决什么问题

DSH 自带 `web_search` 和 `web_fetch`，但默认后端不一定适合每个人：有人已经有自己的 SearXNG，有人需要把搜索请求走代理，有人希望抓取结果直接是干净的正文，而不是整页 HTML。

`dsh-search-tools` 把“搜索/抓取后端”从 DSH 核心中解耦出来：

- 用户可以在 Web 设置页选择后端、填写实例、测试连接；
- 插件向 DSH 注册**稳定 provider id**，切换后端不会改变 DSH 的 `web.searchProvider`；
- 新增后端只需要注册 adapter，设置页按 manifest 自动渲染，不需要改页面代码；
- 额外提供 `web_research`：一次调用完成“搜索 + 抓取前 N 条正文”，适合需要页面内容而非只拿链接的模型回合。

它**不**做这些事：不提供公共搜索 API，不绕过目标站点的登录/付费墙，不执行页面 JavaScript，不做浏览器渲染，也不替代 DSH 的权限与沙箱模型。

## 功能一览

| 能力 | 说明 |
|---|---|
| 稳定的搜索/抓取 provider | `dsh-search-tools`、`dsh-search-tools-fetch` 永不随后端变化 |
| 内置搜索 adapter | SearXNG：多实例、顺序/轮询、故障转移、JSON/HTML、GET/POST、Bearer/Basic、代理、缓存、分页、域名过滤 |
| 内置抓取 adapter | Readability HTTP：复用 DSH 安全 HTTP，Readability 提取正文，失败可回退原文 |
| 研究工具 | `web_research`：搜索、按并发抓取前 N 页、按页/总预算截断、返回来源与正文 |
| Web 设置页 | 概览、搜索、抓取、研究、高级五个页签；内联测试、诊断、缓存清理、键盘保存 |
| 凭据隔离 | 搜索 token 写入 DSH credentials，不落 YAML、不进日志、不出现在诊断文本 |
| 接管与恢复 | 可选让内置 `web_search` / `web_fetch` 使用本插件；关闭时恢复之前的 provider |
| 外部 adapter | 通过 `ctx.searchTools` 注册新后端；设置页自动渲染 manifest 字段 |

## 工作原理

```text
DSH ctx.web
  searchProvider = "dsh-search-tools"         （稳定）
  fetchProvider  = "dsh-search-tools-fetch"   （稳定）
        │
        ▼
  SearchDispatcher / FetchDispatcher
        │ 读取 config.search.adapter / config.fetch.adapter
        ▼
  ctx.searchTools（adapter 注册表）
    ├── searxng         内置搜索 adapter
    ├── readable-http   内置抓取 adapter
    └── 未来由独立包注册的 adapter
```

关键设计：

1. **provider id 稳定，adapter 可换。** 加一个后端不会改 `web.searchProvider`，也不会要求 DSH 重启后重新注册 provider。
2. **配置按 section 开放。** `search.adapters` 和 `fetch.adapters` 是开放字典，adapter 自己拥有默认值与校验逻辑；核心 schema 不需要为每个后端加字段。
3. **manifest 驱动设置页。** Host 路由把 adapter manifest 发给浏览器，页面按 `fields` 通用渲染。新增 adapter 不需要改 React 代码。
4. **配置在调用时解析。** Dispatcher 每次按当前配置选择 adapter；切换后不需要重新注册 provider。

架构细节见 [docs/architecture.md](https://github.com/ThzxxArt/dsh-search-tools/blob/main/docs/architecture.md)。

## 环境要求

| 项目 | 要求 |
|---|---|
| DSH | `>=0.2.1-rc.2 <0.3.0`（当前按 `0.2.1-rc.2` 验证） |
| Node.js | `^22.19.0 || >=24.0.0` |
| 搜索后端 | 一个可访问的 SearXNG 实例；也可暂时保持 DSH 默认搜索 |
| 抓取后端 | 公网 `http(s)` 页面；内网地址会被 DSH 的 SSRF 防护拒绝 |
| 浏览器 | DSH Web GUI（设置页只在 Web 端注册） |

DSH 本身仍是 preview 软件，接口可能变化。插件把 peer 范围锁在已验证的 `0.2.1-rc.2` 线，升级 DSH 前请先看 [CHANGELOG](https://github.com/ThzxxArt/dsh-search-tools/blob/main/CHANGELOG.md)。

## 安装与升级

### 方式一：Web UI（推荐）

1. 打开 DSH Web GUI。
2. 进入 **插件（Plugins）**。
3. 点击 **添加插件（Add plugin）**。
4. 输入包名：

   ```text
   dsh-search-tools
   ```

5. 安装完成后启用这个 bundle。
6. 打开 **设置 → 搜索工具**。

设置页出现，说明 Host 与浏览器两半都已加载。

### 方式二：CLI

```sh
dsh plugin --profile <profile> add dsh-search-tools
```

`<profile>` 换成实际 profile 名。安装后启动该 profile：

```sh
dsh --profile <profile>
```

### 方式三：离线 tarball

从 [GitHub Releases](https://github.com/ThzxxArt/dsh-search-tools/releases) 下载 `dsh-search-tools-0.1.1.tgz`，然后：

```sh
dsh plugin --profile <profile> add ./dsh-search-tools-0.1.1.tgz
```

tarball 与 npm 产物字节一致，适合内网或无法访问 npm 的环境。

### 升级

DSH 插件目前**不支持自动更新**。升级步骤：

1. 先在 **设置 → 搜索工具 → 概览** 关闭搜索/抓取接管（如果已开启）。
2. 在 **插件** 页卸载旧版本。
3. 重新添加 `dsh-search-tools` 或新的 tarball。
4. 重新启用，检查设置页配置是否保留（配置在 profile 的 YAML patch 中，通常不会因重装丢失）。
5. 重新测试搜索与抓取。

CLI 对应：

```sh
dsh plugin --profile <profile> remove dsh-search-tools
dsh plugin --profile <profile> add dsh-search-tools
```

> 不要在接管仍开启时直接卸载。内置 `web_search` 会指向一个不存在的 provider，直到你重装插件或手动恢复 `web.searchProvider`。

### 安装后检查

- **设置 → 搜索工具** 能看到五个页签。
- **高级** 里能看到版本号、配置文件路径、缓存统计。
- 如果模型工具已启用，会话里应能看到 `web_research`。
- 搜索测试通过后，才建议开启搜索接管。

## 快速开始

### 1. 准备 SearXNG

需要一个可访问的 SearXNG 实例。建议确认：

- 实例地址是 `http(s)` 绝对 URL，例如 `https://searx.example.com`；
- 如果使用 JSON API，实例的 `search.formats` 包含 `json`；
- 如果实例只返回 HTML，也可以工作，把 **响应格式** 设为 `html` 或保持 `auto`；
- 如果实例有认证，准备好 Bearer token 或 `username:password`；
- 如果实例对你的网络有限流，准备多个实例或代理。

插件会自动去掉末尾 `/search`、query 和 hash；实例 URL 里不能带用户名/密码。

### 2. 在设置页配置

1. 打开 **设置 → 搜索工具 → 搜索**。
2. 在 **后端** 选择 `SearXNG`。
3. 点击 **添加实例**，填写实例地址；备注名可选。
4. 按需设置引擎、分类、语言、安全搜索、分页、结果数、超时。
5. 如果实例需要认证，在 **认证** 选择 `Bearer` 或 `Basic`，保存对应密钥。
6. 点击 **测试**，确认返回结构化来源。
7. 点击 **保存并应用**。

### 3. 配置抓取（可选）

1. 打开 **抓取** 页签。
2. 保持 **Readability HTTP**。
3. 用默认值先测试一个公网页面，例如 `https://example.com`。
4. 如果目标站点正文抽取效果不好，调整正文上下限、响应上限、超时，或关闭 Readability 使用原始内容。
5. **测试** 通过后保存。

### 4. 开启接管（可选）

在 **概览**：

- **接管内置搜索**：让 DSH 的 `web_search` 使用本插件的搜索 provider。开启前会先用当前配置跑一次搜索测试，失败则不会接管。
- **接管内置抓取**：让 DSH 的 `web_fetch` 使用本插件的抓取 provider。

接管状态会写入 DSH 的 `web.searchProvider` / `web.fetchProvider`。关闭时插件会恢复之前记录的 provider（`activation.previousSearchProvider` / `previousFetchProvider`）。

如果只想用 `web_research`，**不一定要开启接管**。`web_research` 调用的是当前 DSH 的搜索/抓取 provider；不接管时就使用 DSH 默认后端。

### 5. 使用模型工具

模型会话中可以直接使用：

- `web_search`：DSH 内置工具，接管后走本插件；
- `web_fetch`：DSH 内置工具，接管后走本插件；
- `web_research`：本插件注册的研究工具，不依赖接管，但会使用当前 provider。

`web_research` 示例参数：

```json
{
  "query": "DeepSeek Harness release notes",
  "max_results": 8,
  "fetch_top": 3,
  "max_chars": 12000
}
```

返回内容包含 `sources`、`fetched` 和 `truncated`；会话卡片会显示来源数、成功抓取数、抓取详情和截断标记。

## 设置页说明

### 概览（Overview）

- 当前搜索 provider / 抓取 provider；
- 接管状态与快捷开关；
- 搜索后端是否可用、实例数量、缓存条数；
- 快速搜索测试与抓取预览；
- 没有任何实例时的引导卡片。

### 搜索（Search）

- 卡片式 adapter picker：显示 adapter 描述、capabilities、配置状态；
- 实例编辑器：添加、删除、上移、下移、启用/停用、单实例测试；
- 由 manifest 自动渲染的字段；
- 内联测试：显示耗时、来源标题/链接/摘要、`Search notes`（例如 SearXNG 引擎被限流）；
- 校验错误会定位到具体字段，搜索草稿的错误不会阻塞抓取测试。

### 抓取（Fetch）

- 抓取 adapter 选择与字段；
- 输入公网 URL 做一次抓取预览；
- 显示状态码、内容类型、字符数、截断标记和正文预览；
- 内网地址会被 SSRF 防护拒绝，这是预期行为。

### 研究（Research）

- 启用/关闭 `web_research`；
- 默认结果数、最大抓取条数、默认抓取条数、单页/总字符预算、并发、超时；
- **模型看到的工具提示** 预览：描述、参数名、默认值与范围都来自当前草稿；
- 关闭 `web_research` 后，保存后模型将看不到这个工具。

### 高级（Advanced）

- 配置文件路径；
- 缓存条数与命中/未命中统计；
- 清空缓存；
- 最近错误（环形缓冲）；
- 复制诊断信息（已脱敏）与清空错误；
- 当前版本。

### 键盘与状态

- `Cmd/Ctrl+S`：保存并应用当前草稿（仅在配置有效且有未保存更改时）。
- 页签支持 `←` / `→` / `Home` / `End`。
- 保存状态、测试结果、诊断操作都通过 `aria-live` 播报。
- 配置被更高层覆盖时页面只读；配置在别处修改时提示冲突，需重新加载。

## 配置参考

### 配置存放位置

配置通过 DSH 原生 settings 服务写入当前 profile 的 YAML patch：

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

结构大致如下：

```yaml
- id: dsh-search-tools
  name: dsh-search-tools
  config:
    search:
      adapter: searxng
      adapters:
        searxng:
          enabled: true
          instances:
            - url: https://searx.example.com
              enabled: true
              label: primary
          engines: []
          categories: [general]
          language: all
          safesearch: 1
          pages: 1
          maxResults: 10
          strategy: ordered
          method: GET
          format: auto
          auth:
            type: none
          requestTimeoutMs: 12000
          deadlineMs: 45000
          retries: 1
          cacheTtlMs: 300000
          cacheMaxEntries: 200
          userAgent: dsh-search-tools/0.1.1 (+https://github.com/ThzxxArt/dsh-search-tools)
          proxy: ""
          includeDomains: []
          excludeDomains: []
    fetch:
      adapter: readable-http
      adapters:
        readable-http:
          enabled: true
          readability: true
          minArticleChars: 200
          maxArticleChars: 200000
          maxResponseBytes: 5000000
          maxBodyChars: 2000000
          timeoutMs: 20000
          maxRedirects: 5
          userAgent: dsh-search-tools/0.1.1 (+https://github.com/ThzxxArt/dsh-search-tools)
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
      previousSearchProvider: ""
      previousFetchProvider: ""
```

**不要手改这个文件来配置插件。** 设置页会处理校验、section 级 diff、密钥隔离和冲突检测。手改容易写坏 YAML，也可能被更高层 overlay 覆盖。

密钥不进入 YAML。插件通过 DSH credentials 读取：

| 凭据引用 | 用途 | 格式 |
|---|---|---|
| `SEARXNG_TOKEN` | Bearer 认证 | token 原文 |
| `SEARXNG_BASIC_AUTH` | Basic 认证 | `username:password` |

设置页的密钥字段是 write-only：只显示“已配置/未配置”和来源，不回显值。测试使用已保存的密钥；未保存的输入不会发送。

### SearXNG 搜索配置

| 字段 | 默认 | 范围/取值 | 说明 |
|---|---:|---|---|
| `enabled` | `true` | boolean | 关闭后该 adapter 不可用 |
| `instances` | `[]` | 列表 | 实例按顺序尝试；每项有 `url`、`enabled`、`label` |
| `engines` | `[]` | 逗号分隔 | 留空使用实例默认引擎；例如 `google, bing` |
| `categories` | `["general"]` | 逗号分隔 | 留空不发送该参数，使用实例默认；通常 `general` |
| `language` | `all` | 字符串 | 例如 `zh-CN`、`en-US` |
| `safesearch` | `1` | `0` / `1` / `2` | 安全搜索等级 |
| `timeRange` | 空 | `day` / `week` / `month` / `year` | 时间范围 |
| `pages` | `1` | 1–3 | 并发请求的分页数，结果合并去重 |
| `maxResults` | `10` | 1–20 | 每次搜索最多返回条数 |
| `strategy` | `ordered` | `ordered` / `round-robin` | 多实例顺序优先或轮询 |
| `method` | `GET` | `GET` / `POST` | SearXNG 请求方法 |
| `format` | `auto` | `auto` / `json` / `html` | `auto` 先 JSON 后 HTML |
| `auth.type` | `none` | `none` / `bearer` / `basic` | 认证方式 |
| `requestTimeoutMs` | `12000` | 1000–120000 | 单次 HTTP 请求超时 |
| `deadlineMs` | `45000` | 1000–300000 | 整次搜索总预算，不能小于单次超时 |
| `retries` | `1` | 0–5 | 每个实例的重试次数，只重试可重试错误 |
| `cacheTtlMs` | `300000` | 0–86400000 | 搜索结果缓存 TTL；0 关闭 |
| `cacheMaxEntries` | `200` | 0–10000 | 缓存最大条数；0 关闭 |
| `userAgent` | 带版本号 | 非空、无换行 | 请求 UA |
| `proxy` | 空 | `http(s)` URL | 代理；不能包含用户名/密码 |
| `includeDomains` | `[]` | 域名列表 | 只保留匹配域名，支持子域名 |
| `excludeDomains` | `[]` | 域名列表 | 排除匹配域名，支持子域名 |

行为说明：

- **多实例故障转移**：一个实例失败会尝试下一个；全部失败才报错。
- **重试与预算**：单实例重试受 `retries` 和 `deadlineMs` 共同约束；预算耗尽后不再尝试新实例。
- **JSON / HTML**：`auto` 会先看响应是否像 JSON；部分实例会返回 200 的 HTML 挑战页，此时回退 HTML 解析。
- **Search notes**：SearXNG 的 `unresponsive_engines` 会被保留为提示。看到 0 条结果时先看这里，可能是引擎被限流/CAPTCHA，而不是查询真的没有结果。
- **缓存键**：包含查询、实例列表、引擎、分类、语言、安全搜索、时间范围、分页、策略、方法、格式、域名过滤；修改这些会自然失效。
- **域名过滤**：在结果进入 `sources` 前过滤，支持 `example.com` 匹配 `www.example.com`。

### Readability HTTP 抓取配置

| 字段 | 默认 | 范围 | 说明 |
|---|---:|---|---|
| `enabled` | `true` | boolean | 关闭后该抓取 adapter 不可用 |
| `readability` | `true` | boolean | 是否用 Readability 提取正文 |
| `minArticleChars` | `200` | 0–100000 | 低于此长度不视为文章正文 |
| `maxArticleChars` | `200000` | 1000–5000000 | 正文最大字符数，不能小于下限 |
| `maxResponseBytes` | `5000000` | 1024–50000000 | 响应体最大字节数 |
| `maxBodyChars` | `2000000` | 1024–20000000 | 解码后最大字符数，不能小于正文下限 |
| `timeoutMs` | `20000` | 1000–120000 | 抓取超时 |
| `maxRedirects` | `5` | 0–10 | 最大重定向次数 |
| `userAgent` | 带版本号 | 非空、无换行 | 请求 UA |
| `failOpen` | `true` | boolean | 正文提取失败时回退到原始内容 |

抓取层的行为：

- 复用 DSH 的安全 HTTP provider，目标是阻止 SSRF 和访问内网地址；
- 只处理 `http(s)` URL；
- 只解析文本/HTML；PDF、图片、二进制不会变成正文；
- 不执行 JavaScript，因此纯前端渲染页面可能抓不到实际内容；
- Readability 失败且 `failOpen=true` 时返回原始文本/HTML，而不是让整个抓取失败。

### web_research 配置

| 字段 | 默认 | 范围 | 说明 |
|---|---:|---|---|
| `enabled` | `true` | boolean | 关闭后模型看不到该工具 |
| `maxResults` | `8` | 1–20 | 返回来源数上限，也是 `max_results` 的上界 |
| `maxFetch` | `8` | 1–10 | 抓取页数上限，也是 `fetch_top` 的上界 |
| `defaultFetchTop` | `3` | 0–10 | 模型未指定 `fetch_top` 时的默认抓取数；不能大于 `maxFetch` |
| `maxCharsPerPage` | `12000` | 1000–200000 | 单页字符上限，也是 `max_chars` 的上界 |
| `maxTotalChars` | `40000` | 1000–500000 | 所有页面合计字符预算；不能小于单页上限 |
| `concurrency` | `3` | 1–8 | 并发抓取数 |
| `timeoutMs` | `120000` | 5000–600000 | 工具超时预算 |

`web_research` 会把模型参数夹到这些边界内，并按 `maxTotalChars` 在多个页面之间分配剩余预算。某个页面抓取失败不会让整次调用失败；失败页会带 `error` 字段，卡片仍会显示来源和成功抓取数。

> **超时字段说明：** 当前 `timeoutMs` 用于工具提示里的预算展示；实际注册的工具超时固定为 `120000` ms。该差异记录在“已知限制”中。

### 接管配置

接管不是必选项。

| 配置 | 作用 |
|---|---|
| `web.searchProvider = dsh-search-tools` | 内置 `web_search` 使用本插件搜索 provider |
| `web.fetchProvider = dsh-search-tools-fetch` | 内置 `web_fetch` 使用本插件抓取 provider |
| `activation.previousSearchProvider` | 开启接管前记录的搜索 provider，关闭时恢复 |
| `activation.previousFetchProvider` | 开启接管前记录的抓取 provider，关闭时恢复 |

规则：

- 开启搜索接管前，页面会先用已保存配置跑一次搜索测试；失败则不接管。
- 抓取接管的开关不强制先测试；建议先在 **抓取** 页手动测试一个公网页面。
- 关闭接管时，如果之前没有记录 provider，会 unset 对应配置，回到 DSH 默认。
- 停用/卸载 bundle 前先关闭接管；插件在插件详情页会显示接管警告和“关闭接管”入口。

## 模型工具

### 内置 `web_search` / `web_fetch`

这两个是 DSH 自带工具。插件不重新发明它们，只通过稳定 provider 接管底层实现：

- 不开接管：它们继续用 DSH 原来的 provider，本插件不影响；
- 开接管：请求进入本插件的 Dispatcher，再路由到当前 adapter；
- 关闭接管：恢复开启前记录的 provider。

这样模型看到的工具名、参数和权限模型都不变。

### `web_research`

插件注册的模型工具，用于“我要页面内容，而不只是链接”的场景。

参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | string | 是 | 搜索查询 |
| `max_results` | number | 否 | 返回来源数，受配置 `maxResults` 限制 |
| `fetch_top` | number | 否 | 抓取前 N 条；`0` 表示只返回来源 |
| `max_chars` | number | 否 | 单页字符预算，受配置 `maxCharsPerPage` 限制 |

返回结构：

```json
{
  "query": "example",
  "sources": [
    { "url": "https://example.com", "title": "Example", "snippet": "..." }
  ],
  "fetched": [
    {
      "url": "https://example.com",
      "title": "Example",
      "content": " readable markdown ...",
      "truncated": false
    }
  ],
  "truncated": false
}
```

行为：

- 搜索走当前 `ctx.web.search`；抓取走当前 `ctx.web.fetch`；
- 抓取前 `fetch_top` 条结果，按 `concurrency` 并发；
- HTML 页面会尝试 Readability 提取，再转 Markdown；纯文本直接使用；
- 单页按 `max_chars` 截断，多页共享 `maxTotalChars` 预算；
- 单页失败带 `error`，不影响其他页；
- 会话卡片显示来源、成功抓取数、失败数、字符数和截断标记；
- 外部页面内容是**不可信数据**，不是指令。模型和用户都不应执行页面里的“指令”。

## 安全模型

- **设置路由有认证栅栏。** 所有 `/api/dsh-search-tools/*` 路由都经过 DSH 的 `connection.requestRejection`，未认证请求返回 401/403。
- **请求体有上限。** JSON body 限制 64 KiB，非 JSON 返回 415。
- **SSRF 防护。** 抓取复用 DSH 的 `HttpFetchProvider`，内网/保留地址会被拒绝；这不是本插件自己实现的网络层。
- **搜索重定向不跟随。** SearXNG 请求使用 `redirect: 'error'`，认证头不会跟随跨源重定向。
- **凭据不落 YAML。** Bearer/Basic 密钥写入 DSH credentials；YAML 只保存 `auth.type`。诊断文本会脱敏，不包含 token。
- **代理不带凭据。** `proxy` 必须是 `http(s)` URL，且不能包含用户名/密码，避免把代理凭据写进配置。
- **错误信息有限。** 实例主机名可能出现在诊断中，但查询字符串和凭据会被去掉。
- **无遥测。** 插件不向作者或第三方发送使用数据；搜索请求只发往你配置的实例。

> 安全边界仍然取决于 DSH 本身和你的部署。不要把设置页暴露在不可信网络；不要在共享 profile 中把密钥当公共配置。

## 适配器开发

> 外部 adapter contract 在 0.1.x 标记为实验性。接口可能在小版本中调整；依赖它时请锁定 `dsh-search-tools` 版本并做集成测试。

一个 adapter 包大致做三件事：

1. 依赖 `ctx.searchTools` 服务；
2. 提供 manifest（设置页渲染用）和 runtime（实际搜索/抓取）；
3. 用 `ctx.effect` 注册，确保卸载时自动清理。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.searchTools.registerSearchAdapter(myAdapter),
    'my-search-adapter',
  )
}
```

`myAdapter` 的结构：

```ts
const myAdapter = {
  manifest: {
    kind: 'search',
    id: 'my-search',
    label: { en: 'My Search', zh: '我的搜索' },
    description: { en: '...', zh: '...' },
    defaults: { endpoint: 'https://search.example.com' },
    capabilities: ['json', 'probe'],
    fields: [
      { kind: 'text', key: 'endpoint', label: { en: 'Endpoint', zh: '地址' } },
    ],
  },
  validate(rawConfig) {
    return { ok: true, issues: [] }
  },
  create(ctx, getConfig) {
    return {
      available: () => true,
      async search(request, signal) {
        return { sources: [], truncated: false }
      },
    }
  },
}
```

约定：

- 搜索 adapter 的 `id` 必须唯一；`kind` 必须是 `search` 或 `fetch`。
- 配置存在 `config.search.adapters.<id>`（或 `fetch.adapters.<id>`），adapter 自己 normalize/validate。
- `fields` 支持 `text`、`url`、`password`、`number`、`boolean`、`select`、`tags`、`instances`。
- 需要密钥时用 `secretRefs` 声明引用，值走 DSH credentials，不要写进 manifest defaults。
- 新增 adapter 不需要改设置页代码；页面按 manifest 渲染。
- v0.1.x 不支持 adapter 自带完全自定义的设置 UI；如有需要，可以未来注册自己的 `settings.section`，但那就不再是统一页面的一部分。
- 外部 adapter 的本地化目前以 manifest 的 `label` / `description` 原文为准；内置 adapter 由插件字典提供中英文。

`ctx.effect` 返回 disposer；不要在 `apply` 外保存全局注册状态。重复注册同一 id 会被拒绝。

## 本地开发

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm typecheck
pnpm test
pnpm build
pnpm release
```

`pnpm build` 产出：

```text
lib/index.js        Host 半侧
lib/client.js       浏览器 lazy-CJS factory
lib/types/**        TypeScript 声明
```

测试与检查：

| 命令 | 内容 |
|---|---|
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | Vitest：Host 单测、设置页/研究卡片组件测试、pipeline、publint 策略 |
| `pnpm build` | Host、浏览器、类型声明 |
| `pnpm pack:check` | build + `pnpm pack --dry-run` + publint |
| `pnpm release` | typecheck + test + pack:check |

CI 在 Ubuntu/Windows × Node 22/24 上跑 typecheck、test、build、pack dry-run、publint。publint 只忽略 `lib/client.js` 的 `FILE_INVALID_FORMAT`：DSH 把它当浏览器 CJS 工厂加载，不是 Node ESM 入口；其他诊断仍然失败。

### 项目结构

```text
src/core/                 adapter 类型、注册表、稳定 dispatcher、诊断
src/search/adapters/      SearXNG adapter（manifest/schema/client/parser）
src/fetch/adapters/       Readability HTTP adapter
src/research/             web_research pipeline、prompt、render、tool
src/host/                 认证的设置路由
src/client/               设置 → 搜索工具 + 研究卡片
src/shared/               config、校验、diff、URL、限制
tests/                    Host 单测 + 设置页/研究卡片组件测试
docs/                     架构、设计、M0 验收、发布清单
```

### 为什么用 linkedom 而不是 jsdom

Readability 运行在 Host 内。`jsdom` 的 `tr46` 依赖会调用 `createRequire(...).resolve.paths`，而 DSH 的 profile resolution hook 没有实现它；`linkedom` 更小，也能在 Host 内工作。`jsdom` 只作为组件测试的 dev 依赖。

## 发布流程

发布前确认：

- `package.json` 版本是 `0.1.1`；
- `CHANGELOG.md` 有对应条目；
- `pnpm release` 全绿；
- 工作区干净；
- npm 认证可用，或仓库配置了 `NPM_TOKEN` secret。

本地检查：

```sh
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm release
pnpm pack --pack-destination dist
```

打 tag 并推送：

```sh
git tag -a v0.1.1 -m "dsh-search-tools v0.1.1"
git push origin main --follow-tags
```

推送 `v*` tag 会触发 `.github/workflows/release.yml`：

1. 重复 `pnpm release`；
2. 检查该版本是否已发布，已存在则跳过；
3. 用 `NPM_TOKEN` 发布到 npm（provenance）；
4. 把 tarball 附加到 GitHub Release。

手动发布：

```sh
npm publish --provenance --access public
```

发布后做一次全新 profile 冒烟：安装、启用、配置 SearXNG、搜索测试、抓取测试、一次 `web_research` 调用。详细清单见 [v0.1.1 发布清单](https://github.com/ThzxxArt/dsh-search-tools/blob/main/docs/release-v0.1.1.md)。

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 设置页没有“搜索工具” | bundle 未启用；DSH 版本不匹配；客户端加载失败 | 在插件页启用；确认 DSH 在 `>=0.2.1-rc.2 <0.3.0`；看浏览器控制台/插件日志 |
| 搜索测试 401/403 | 实例需要认证；凭据未保存；Basic 格式不是 `username:password` | 在认证字段选择正确类型，保存密钥后重试；确认 `Source: env` 是否符合预期 |
| 搜索测试 429 | 实例限流 | 降低频率、换实例、增加缓存 TTL，或改用其他后端 |
| 返回 0 条但测试“成功” | SearXNG 默认引擎被限流/CAPTCHA | 看 **Search notes**；指定 `engines`（例如 `bing`）或换实例 |
| JSON 解析失败 | 实例未启用 JSON 格式 | 在 SearXNG 的 `search.formats` 加 `json`；或把格式设为 `html` |
| `web_research is disabled` | 研究工具关闭 | 设置 → 研究 → 启用 `web_research` 并保存 |
| 研究只返回来源、不抓正文 | `fetch_top=0`；抓取失败；目标页面不可读 | 提高 `fetch_top`；看抓取详情的 `error`；手动在抓取页测试 URL |
| 内网 URL 抓取失败 | SSRF 防护 | 预期行为；不要尝试绕过 |
| 接管后内置搜索报错 | bundle 被停用/卸载但接管仍指向插件 | 重新启用插件，或关闭接管；设置页/插件详情页有恢复入口 |
| 配置保存冲突 | 配置在别处被修改；更高层覆盖 | 点 **重新加载**；检查 profile 的 `cordis.patch.yml` 和更高层 overlay |
| 配置只读 | 被更高层配置覆盖 | 页面顶部会说明；到覆盖层修改，或移除覆盖 |
| 实例 URL 重复 | 规范化后相同 | 去掉重复实例；URL 会去掉末尾 `/search`、query、hash |
| 代理配置报错 | 不是 http(s)，或包含用户名/密码 | 改成无凭据的 `http(s)://host:port` |
| 缓存结果不更新 | TTL 未到 | 在高级页清空缓存，或等 TTL 过期 |
| 安装后没有 `web_research` | 研究工具关闭；模型未刷新工具列表 | 启用并保存；开新会话或重新加载页面 |
| npm 安装失败 | registry/网络/peer 不匹配 | 检查 DSH 版本、Node 版本、npm registry；用 tarball 离线安装 |

诊断顺序建议：

1. 看 **设置 → 高级 → 最近错误**；
2. 看 **Search notes**（引擎级错误）；
3. 用 **测试** 复现，不要只看模型回合；
4. 确认是否开启了接管，以及当前 provider 是哪一个；
5. 最后再查 DSH 日志和实例日志。

## 已知限制

- **只内置一个搜索 adapter 和一个抓取 adapter。** 架构支持更多，但 0.1.x 不附带 Google/Bing/Exa 等商业后端。
- **没有自动更新。** 升级需要卸载再安装。
- **外部 adapter contract 是实验性的。** 0.1.x 可能调整；生产集成请锁版本。
- **不做浏览器渲染。** 不执行 JS，不处理登录态；SPA/付费墙/验证码页面可能抓不到正文。
- **只处理文本/HTML。** PDF、图片、音视频不会转成正文。
- **`web_research` 不是爬虫。** 只抓前 N 条结果，不做站点遍历、去重图谱或深度抓取。
- **研究提示词预览是只读的。** 不提供复制按钮；工具描述保持英文，与模型实际看到的内容一致。
- **研究超时字段尚未接到工具注册。** `research.timeoutMs` 目前只用于提示词预算展示；实际 `web_research` 注册超时固定为 `120000` ms。需要更长/更短超时的部署应等待后续版本或改代码。
- **接管是全局 provider 切换。** 它会影响该 DSH profile 中所有使用 `ctx.web` 的调用，不只本插件。
- **缓存是进程内内存。** 重启后丢失；多进程不共享。
- **DSH preview 兼容范围窄。** 当前锁在 `0.2.1-rc.2` 线，升级 DSH 前先跑回归。

## 许可证与第三方组件

本项目使用 MIT 许可证，见 [LICENSE](https://github.com/ThzxxArt/dsh-search-tools/blob/main/LICENSE)。

第三方组件与许可证说明见 [THIRD_PARTY_NOTICES.md](https://github.com/ThzxxArt/dsh-search-tools/blob/main/THIRD_PARTY_NOTICES.md)。主要运行时依赖包括 `@mozilla/readability`、`linkedom`、`cheerio`、`turndown`、`@joplin/turndown-plugin-gfm`、`undici`、`lru-cache`、`normalize-url`。

---

如果这个插件对你有帮助，欢迎在 GitHub 提 issue 或 discussion。安全问题请不要公开贴 token、实例密码或完整配置。
