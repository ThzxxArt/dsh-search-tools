# dsh-search-tools

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 adapter-first 的网页搜索与正文抓取。

> **状态：v0.1.0 发布候选（2026-10-22）。** M0 已端到端验证：Host 与客户端 bundle 可构建，设置里的「搜索工具」在真实 Web GUI 中出现，保存写入 YAML，认证路由可用，搜索/抓取接管与恢复可用，密钥不落 YAML。设置页提供搜索/抓取内联测试、诊断复制/清空、键盘保存、卡片式 adapter picker，以及模型看到的 `web_research` 契约预览。真实 OpenAI 兼容模型已分别调用 `web_research`、内置 `web_search` 和内置 `web_fetch`，搜索走真实 SearXNG，研究卡片正常渲染。构建、测试、打包和 publint 检查均通过。发布是剩余的外部步骤；见 `docs/release-v0.1.0.md`。

## 它做什么

- 注册**稳定**的 DSH provider：`dsh-search-tools`（搜索）和 `dsh-search-tools-fetch`（抓取）。新增或切换后端时 provider id 不变。
- 第一个搜索 adapter 是 **SearXNG**，第一个抓取 adapter 是 **Readability HTTP**。
- 新增 `web_research` 工具：一次调用完成“搜索 + 抓前 N 条正文”。
- 在 Web GUI 注册 **设置 → 搜索工具**，所有配置在页面完成，不需要手改文件。
- 搜索/抓取页签内置测试面板，返回结构化来源和抓取预览；高级页可复制/清空诊断信息。
- 配置通过 DSH 原生 settings 服务写入 profile 的 YAML patch（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）。密钥走 DSH credentials，不写入 YAML。

## 新增后端

Adapter 包依赖 `ctx.searchTools`，注册 manifest 和 runtime：

```ts
export const inject = ['searchTools']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.searchTools.registerSearchAdapter(exaAdapter), 'exa adapter')
}
```

设置页从 Host 路由读取 manifest，自动渲染字段；新增 adapter 不需要改页面代码。

## 开发

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

`pnpm build` 产出：

```text
lib/index.js        Host 半侧
lib/client.js       浏览器 lazy-CJS factory
lib/types/**        类型声明
```

## 在 DSH 里安装

主路径是 Web UI：

1. 打开 **插件**。
2. **添加插件** → 输入 `dsh-search-tools`。
3. 启用。
4. 打开 **设置 → 搜索工具**，配置 SearXNG 实例。

包已发布到 npm：`dsh-search-tools`，Web UI 会直接安装。离线安装可以用 release
里的 tarball：

```sh
dsh plugin --profile <profile> add ./dsh-search-tools-0.1.0.tgz
```

tarball 附在 GitHub release 上，与 npm 产物字节一致。

本地开发可以用绝对路径 overlay 加载 `src/index.ts`，具体 `--patch` 命令以 DSH checkout 文档为准。

## 目录

```text
src/core/                 adapter 类型、注册表、稳定 dispatcher
src/search/adapters/      搜索 adapter（第一个是 searxng）
src/fetch/adapters/       抓取 adapter（第一个是 readable-http）
src/research/             web_research pipeline、prompt、render、tool
src/host/                 受认证的设置路由
src/client/               设置 → 搜索工具 + 工具卡片
src/shared/               config、校验、diff、URL 辅助
tests/                    Host 单测 + 设置页/研究卡片组件测试
```

Readability 使用 `linkedom`，不是 `jsdom`：jsdom 的 `tr46` 依赖会调用
`createRequire(...).resolve.paths`，而 DSH 的 profile resolution hook 没有实现它。
linkedom 更小，也能在 Host 内正常工作。

## 安全

- 设置路由使用 DSH 的 `connection.requestRejection` 栅栏。
- 抓取复用 DSH 的 SSRF 安全 `HttpFetchProvider`。
- token 每次请求从 `ctx.credentials`/环境变量读取，不进 YAML、日志或错误文本。
- SearXNG 请求使用 `redirect: 'error'`，凭据不会跟随跨源重定向。

## 许可证

MIT。见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
