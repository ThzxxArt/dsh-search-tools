# Jina Reader Linux Docker 部署与使用教程

> 适用对象：在 Linux 上自建 Jina Reader，并把它接入 `dsh-search-tools` / DeepSeek Harness 的 `web_fetch`、`web_research`。
>
> 本文以 Jina Reader 开源分支（`jina-ai/reader`）当前 `main` 分支和官方镜像 `ghcr.io/jina-ai/reader:oss` 为准，配置核对日期：**2026-10-23**。
>
> 说明：编写本文的开发机没有安装 Docker，所以容器命令没有在本机实际启动；镜像、端口、API 头和缓存变量均按官方 README、`CONTRIBUTING.md` 和源码核对，并给出逐步验收命令。首次上线请先在测试机验证。

## 1. 先看清：Jina Reader 是什么，不是什么

Jina Reader 把任意 URL 转成适合 LLM 读取的内容：

```text
目标网页 / PDF / Office 文件
        │
        ▼
┌──────────────────────────────────────┐
│ Jina Reader 容器                    │
│  - headless Chrome（browser）        │
│  - curl / auto 轻量抓取              │
│  - PDF.js / LibreOffice              │
│  - Markdown / HTML / text 输出       │
└──────────────────────────────────────┘
        │  JSON: data.content / data.html / data.text
        ▼
DSH web_fetch / web_research
```

它**是**：

- 一个可以把网页、PDF、Word/Excel/PowerPoint 转成 Markdown 的抓取服务；
- 支持 headless Chrome，因此能处理大量 SPA/CSR 页面；
- 支持 CSS 选择器、iframe、Shadow DOM、缓存控制和超时；
- 可以在本机/内网自托管，页面内容不必经过 Jina 的 SaaS。

它**不是**：

- 不是登录态浏览器，不会替你登录、绕过付费墙或破解验证码；
- 不是匿名代理，Reader 仍然会用自己的出口 IP 访问目标站点；
- 不是完整 SSRF 防护。Reader 会重新解析目标 DNS，也可能跟随重定向/浏览器跳转，所以自托管时必须限制它的网络出口；
- 开源 OSS 镜像默认没有给公网直接使用的认证/限流层。**不要**把 `3000` 端口直接暴露到公网。

官方资料：

- [Jina Reader 仓库](https://github.com/jina-ai/reader)
- [Self-host with Docker（README）](https://github.com/jina-ai/reader#self-host-with-docker)
- [环境变量表](https://github.com/jina-ai/reader/blob/main/CONTRIBUTING.md#environment-variables)
- [支持的请求头源码](https://github.com/jina-ai/reader/blob/main/src/dto/crawler-options.ts)
- [Reader API 文档](https://r.jina.ai/docs)

## 2. 前提条件

### 2.1 系统和资源

官方镜像同时提供 amd64 / arm64 版本。建议：

| 项目 | 最低 | 建议 |
|---|---:|---:|
| Linux | 能运行 Docker 的 x86_64/arm64 | Debian 12/13、Ubuntu 22.04/24.04 |
| CPU | 1 核 | 2 核以上 |
| 内存 | 1 GB | 2 GB 以上 |
| 共享内存 `/dev/shm` | Docker 默认 64 MB 不够 | `--shm-size=1g` 或 Compose `shm_size: 1gb` |
| 磁盘 | 1 GB | 3 GB 以上（镜像本身包含 Chrome/LibreOffice） |

Chrome 对 `/dev/shm` 很敏感；共享内存太小会出现 `Target closed`、`Page crashed` 或随机超时。Compose 里的 `shm_size` 不是可选项，建议保留。

### 2.2 安装 Docker

以 Debian / Ubuntu 为例：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl jq openssl

sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
  | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

重新登录（或 `newgrp docker`）后验证：

```bash
docker version
docker compose version
docker run --rm hello-world
```

官方安装文档：<https://docs.docker.com/engine/install/>

### 2.3 端口规划

镜像暴露两个端口：

| 容器端口 | 协议 | 用途 |
|---:|---|---|
| `8080` | HTTP/2 cleartext（h2c） | Cloud Run 等生产环境使用；普通 `curl` 需要 `--http2-prior-knowledge` |
| `8081` | HTTP/1.1 | 普通 `curl`、浏览器、Nginx 反代使用 |

**给 DSH / Nginx 用的请映射 `8081`。** 如果你把 `8080` 映射给普通 `curl`，很可能得到连接重置或空响应，不是服务没起来，而是协议不匹配。

本教程统一使用：

```text
宿主机 127.0.0.1:3000  ->  容器 8081/tcp
```

## 3. 启动 Reader

### 3.1 目录

```bash
sudo mkdir -p /opt/jina-reader
sudo chown -R "$USER":"$USER" /opt/jina-reader
cd /opt/jina-reader
```

### 3.2 Compose 文件

创建 `compose.yaml`：

```yaml
name: jina-reader

services:
  reader:
    image: ghcr.io/jina-ai/reader:oss
    container_name: jina-reader
    restart: unless-stopped

    # 只绑定本机；由 Nginx / SSH 隧道 / VPN 访问
    ports:
      - "127.0.0.1:3000:8081"

    # Chrome 需要足够的共享内存
    shm_size: "1gb"

    # 资源上限按机器调整；太小会导致 Chrome 被 OOM kill
    mem_limit: "2g"
    cpus: "2.0"

    # 默认无持久化数据；如需 S3 兼容缓存，见 7.2
    # environment:
    #   GCP_STORAGE_ENDPOINT: https://s3.example.com
    #   GCP_STORAGE_BUCKET: reader-cache
    #   GCP_STORAGE_ACCESS_KEY: ...
    #   GCP_STORAGE_SECRET_KEY: ...
```

启动：

```bash
docker compose up -d
docker compose ps
docker compose logs -f reader
```

日志出现监听信息后，`Ctrl-C` 退出日志（不会停止容器）。

### 3.3 不用 Compose 的等价命令

```bash
docker run -d \
  --name jina-reader \
  --restart unless-stopped \
  -p 127.0.0.1:3000:8081 \
  --shm-size=1g \
  --memory=2g \
  --cpus=2 \
  ghcr.io/jina-ai/reader:oss
```

`--rm` 只适合临时试跑；生产用 `--restart unless-stopped`，不要用 `--rm`。

### 3.4 第一次验收

先测最简单的 GET：

```bash
curl -fsS 'http://127.0.0.1:3000/https://example.com/' | head -40
```

应该看到 Markdown 文本（可能包含 `Title:`、`URL Source:` 和正文）。如果失败：

- 连接被重置：检查是不是把 `8080` 映射给了普通 curl；改用 `8081`；
- `Connection refused`：`docker compose ps` 看容器是否 Up；
- 容器启动即退出：`docker compose logs --tail=100 reader`；
- 目标站点超时：换 `https://example.com/` 先排除目标站点问题。

再测 DSH 实际使用的 POST + JSON 形式：

```bash
curl -fsS -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'X-Respond-With: markdown' \
  -H 'X-Engine: browser' \
  -H 'X-Timeout: 25' \
  --data-urlencode 'url=https://example.com/' \
  | jq '{code, status, title: .data.title, chars: (.data.content | length)}'
```

期望 `code/status` 为成功值，`data.content` 非空。DSH 的 Jina adapter 读取的正是 `data.content`（Markdown 模式）、`data.html`（HTML 模式）或 `data.text`（text 模式）。

> 如果这里返回 401/403，而你是直连本地 Reader，通常不是 Reader 的认证，而是目标站点或代理层的问题；先看 `docker compose logs`。如果是托管 `https://r.jina.ai/`，401/403 才优先检查 API key。

## 4. API 使用方法

### 4.1 两种基本形式

**GET：URL 直接拼在 Reader 地址后面**

```bash
curl -fsS 'http://127.0.0.1:3000/https://en.wikipedia.org/wiki/Artificial_intelligence' \
  | head -60
```

**POST：把目标 URL 放在表单 `url` 字段**

```bash
curl -fsS -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'url=https://example.com/' \
  | jq '.data.content' -r | head -40
```

DSH 使用的是 **POST + `url=` 表单**，这样目标 URL 里的 `#`、`?` 和特殊字符不会被错误拆分，也更适合 SPA 的 hash 路由。

### 4.2 响应格式

- 不加 `Accept: application/json`：通常返回纯文本/Markdown；
- 加 `Accept: application/json`：返回 JSON 包装，正文在 `data.content`（或 `data.html` / `data.text`）；
- `X-Respond-With: markdown`：Markdown；
- `X-Respond-With: html`：HTML；
- `X-Respond-With: text`：纯文本；
- 一些版本还支持 `frontmatter`、`screenshot`、`pageshot` 等，具体以 `https://r.jina.ai/docs` 和你运行的 OSS 版本为准。

### 4.3 常用请求头

| 请求头 | 示例 | 作用 |
|---|---|---|
| `X-Respond-With` | `markdown` | 输出 Markdown；也支持 `html` / `text` |
| `X-Engine` | `browser` | 强制 headless Chrome；`auto` 由 Reader 选择 |
| `X-Timeout` | `30` | Reader 等待预算，最大 180 秒 |
| `X-Wait-For-Selector` | `main` | 等某个 CSS 元素出现再提取 |
| `X-Target-Selector` | `article` | 只提取匹配元素 |
| `X-Remove-Selector` | `nav, .ads` | 提取前移除导航/广告 |
| `X-No-Cache` | `true` | 绕过缓存，要求实时抓取 |
| `X-With-Iframe` | `true` | 包含 iframe 内容 |
| `X-With-Shadow-Dom` | `true` | 包含 Shadow DOM 内容 |
| `X-Locale` | `zh-CN` | 浏览器 locale |
| `X-User-Agent` | `Mozilla/5.0 ...` | 覆盖目标页 UA |
| `X-Retain-Images` | `none` / `all` | 是否保留图片 |
| `X-Retain-Links` | `all` / `none` | 是否保留链接 |
| `X-Proxy-Url` | `http://proxy:8080` | 指定上游代理；**高风险，见第 6 节** |

注意：

- `X-Timeout` 是 Reader 的等待预算，不是 DSH 的硬超时。DSH 外层还有 `web_fetch` 的 30 秒工具超时；把 Reader 调到 30 秒以上时，必须同时调高 DSH `tool-web.fetchTimeoutMs`。
- `X-Engine: browser` 更慢但能执行 JS；静态页可以先用默认 `auto`。
- `X-With-Iframe` / `X-With-Shadow-Dom` 会增加抓取时间和失败概率，只在目标页确实需要时打开。
- `X-Proxy-Url` 可以让 Reader 访问内网代理；不要把带这个能力的 Reader 暴露给不可信用户。

### 4.4 SPA / hash 路由

对于 `https://example.com/#/route` 这类 hash 路由，必须用 POST，且对 `url` 做表单编码：

```bash
curl -fsS -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  -H 'X-Respond-With: markdown' \
  -H 'X-Engine: browser' \
  -H 'X-Timeout: 30' \
  --data-urlencode 'url=https://example.com/#/route' \
  | jq -r '.data.content' | head -80
```

### 4.5 CSS 选择器和等待

```bash
curl -fsS -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  -H 'X-Respond-With: markdown' \
  -H 'X-Engine: browser' \
  -H 'X-Wait-For-Selector: article' \
  -H 'X-Target-Selector: article' \
  -H 'X-Remove-Selector: nav, aside, .ads' \
  --data-urlencode 'url=https://example.com/article' \
  | jq -r '.data.content' | head -100
```

选择器写法是 CSS 选择器；`X-Remove-Selector` 支持逗号分隔的多个选择器。选择器写错不会让请求一定失败，但可能得到空正文或整页正文，先用 `curl` 小样本确认。

### 4.6 PDF / Office

镜像内置 Chrome、PDF.js 和 LibreOffice，并带 CJK 字体。直接抓 PDF 或 Office 文件：

```bash
curl -fsS -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  -H 'X-Respond-With: markdown' \
  --data-urlencode 'url=https://www.nasa.gov/wp-content/uploads/2023/01/55583main_vision_space_exploration2.pdf' \
  | jq -r '.data.content' | head -80
```

如果 PDF 解析失败，先确认：

- URL 本身可访问（不是登录后/付费墙后的文件）；
- 文件不是扫描图片且没有可提取文本；
- 容器内存足够（PDF.js/Office 转换会吃内存）；
- 目标站点没有拦截 Reader 的 UA/IP。

### 4.7 缓存

默认 OSS 容器是**无状态、无缓存**的：每次请求都实抓目标 URL。需要缓存时，官方支持 S3 兼容存储，用这些环境变量：

```yaml
environment:
  GCP_STORAGE_ENDPOINT: https://s3.example.com
  GCP_STORAGE_BUCKET: reader-cache
  GCP_STORAGE_ACCESS_KEY: "..."
  GCP_STORAGE_SECRET_KEY: "..."
  GCP_STORAGE_REGION: us-east-1   # 可选
```

配置后重启容器：

```bash
docker compose up -d
```

需要强制新鲜内容时加：

```bash
-H 'X-No-Cache: true'
```

> 变量名带 `GCP_` 是历史命名；实际可以指向 MinIO 或其他 S3 兼容服务。缓存桶的权限、生命周期和敏感内容保留策略由你负责。

### 4.8 典型错误

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 连接重置 / 空响应 | 把 `8080` h2c 当 HTTP/1.1 用 | 改映射 `8081`，或 curl 加 `--http2-prior-knowledge` |
| 401/403 | 托管 API key 无效；反向代理 Bearer 不匹配；目标站点拒绝 | 分别检查 `Authorization`、Nginx 日志、目标 URL |
| 429 | 托管服务限流；自建反代限流 | 降低频率；自建时检查 Nginx `limit_req` |
| 504/超时 | 目标页慢、`X-Timeout` 太短、Chrome 资源不足 | 提高超时/内存，先用 `example.com` 排除目标问题 |
| `data.content` 为空 | 选择器错误、目标页只有 JS 内容、反爬 | 改 `browser`、加等待选择器，或换目标 |
| PDF 乱码/失败 | 扫描件、字体、内存、文件受保护 | 换源、加内存、确认不是付费墙 |
| 容器被 OOM kill | 内存太小、Chrome 多标签 | 加内存，限制并发 |

## 5. 接入 DSH / dsh-search-tools

### 5.1 在设置页配置

1. 打开 DSH 的 **设置 → 搜索工具 → 抓取**。
2. 后端选择 **Jina Reader**。
3. Endpoint：
   - 本机 Reader：`http://127.0.0.1:3000/`
   - 反代 Reader：`https://reader.example.com/`
   - 托管 Jina：`https://r.jina.ai/`
4. API key：
   - 本机无认证 Reader：留空；
   - 反代 Bearer：填与 Nginx 一致的 token；
   - 托管 Jina：填 `JINA_API_KEY`。
5. Fetch engine：需要 JS 渲染选 `browser`；静态页可以先 `auto`。
6. Response mode：一般 `markdown`；需要 HTML 交给本地 Readability 时选 `html`。
7. Timeout：默认 `25000` ms；如果目标站很慢，可调到 30000–60000，同时看 5.4。
8. 按需打开 `noCache`、`includeIframes`、`includeShadowDom`、选择器和图片/链接保留。
9. 先点 **测试**，确认返回正文；再 **保存并应用**。
10. 需要接管内置 `web_fetch` 时，在 **概览** 打开 **接管内置抓取**；只用 `web_research` 时可以不接管。

### 5.2 本机接入示例

```yaml
fetch:
  adapter: jina-reader
  adapters:
    jina-reader:
      endpoint: http://127.0.0.1:3000/
      engine: browser
      responseMode: markdown
      timeoutMs: 25000
      maxResponseBytes: 5000000
      maxBodyChars: 200000
      noCache: false
      respectRobots: true
      retainImages: none
      retainLinks: all
```

`endpoint` 是 loopback 时允许明文 HTTP；远程 endpoint 必须是 HTTPS，这是 DSH 适配器的硬校验。

### 5.3 和 SearXNG 的分工

- SearXNG 负责 **搜索**：`web_search`、`web_research` 的搜索阶段；
- Jina Reader 负责 **抓取**：`web_fetch`、`web_research` 的正文抓取阶段；
- 两者可以同时启用，但抓取后端只有一个当前选中项。切换抓取后端不影响搜索配置。

### 5.4 超时链路

```text
DSH web_fetch 工具超时（默认 30s）
  └─ jina-reader 本地 timeoutMs（默认 25s）
       └─ Reader 的 X-Timeout（本地 timeoutMs - 1s）
            └─ 目标站点响应
```

如果你把 Reader 的 `timeoutMs` 设为 60s：

1. jina-reader 会发 `X-Timeout: 59`；
2. 但 DSH 的 `web_fetch` 默认 30s 仍会先返回 `TOOL_TIMEOUT`；
3. 必须同时调高 DSH 的 `tool-web.fetchTimeoutMs`，否则 Reader 根本等不到 59s。

不要只调 Reader 一侧就以为“已经支持长任务”。

### 5.5 用模型验证

在 DSH 会话里：

```text
用 web_fetch 抓取 https://example.com/，告诉我页面标题。
```

或者在 `web_research` 里让模型先搜索再抓正文。验证时看：

- 设置页 **测试** 是否通过；
- `web_fetch` 是否返回标题/正文；
- 日志里是否出现 `JINA_TIMEOUT`、`JINA_BAD_RESPONSE`、`JINA_TARGET_BLOCKED` 等错误码；
- 目标 URL 是否是公网地址（DSH 会拒绝 loopback/私有地址，这是预期行为）。

### 5.6 托管 Jina 与自托管的区别

| 项目 | 托管 `https://r.jina.ai/` | 自托管 `http://127.0.0.1:3000/` |
|---|---|---|
| 数据路径 | 目标 URL 发给 Jina | 页面在本地 Reader 内抓取 |
| API key | 建议配置；匿名有限流 | 通常不需要；反代可加 Bearer |
| 限流 | Jina 侧 | 默认无内置限流；自己加 Nginx |
| 认证 | API key | 默认未配置访问控制；必须限制访问 |
| 能力/版本 | Jina 统一维护 | 取决于你拉的 `oss` 镜像 |
| 缓存 | 可能有服务端缓存 | 默认无状态；可选 S3 |
| 出口 IP | Jina 的 IP | 你的服务器 IP |

## 6. 生产安全：把它当“会访问任意 URL 的服务”

这是本文最重要的一节。Jina Reader 的功能本质上就是“让服务端访问用户给的 URL”。DSH 会在发出前做公网目标守卫，但 Reader 仍会重新解析 DNS、跟随重定向和浏览器跳转，因此：

- DSH 的预检是 **best-effort**，不是连接级 SSRF 防护；
- 自托管 Reader 必须限制网络出口；
- 不能把 Reader 和敏感内网服务、云元数据、Docker socket 放在同一信任域。

### 6.1 最低要求

- 只绑定 `127.0.0.1`，公网访问必须经过 Nginx/Caddy + TLS + Bearer；
- 不要把 `3000` 映射到 `0.0.0.0`；
- 不要让 Reader 容器使用 `--network host`；
- 不要挂载 `/var/run/docker.sock`；
- 不要给容器 `--privileged`；
- 不要在同一台机器上放置云厂商凭据、内部管理面板、数据库等敏感服务；
- 容器以非 root 的 `jina` 用户运行（官方 Dockerfile 已设置），不要强行改回 root。

### 6.2 限制出口

Reader 需要访问公网，所以不能用 Docker 的 `internal` 网络把它完全断网。正确做法是在**宿主机防火墙/云安全组/网络策略**上限制 Reader 容器网段：

至少拒绝：

- `127.0.0.0/8`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.0.0/16`（包括云元数据 `169.254.169.254`）
- `::1/128`、`fc00::/7`、`fe80::/10`

示意（**不要直接复制，先按 `docker network inspect` 确认网段**）：

```bash
# 查看 Reader 容器所在网络和子网
docker network inspect jina-reader_default \
  --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'

# 假设 Reader 网段是 172.20.0.0/16
# 更推荐在云安全组/主机 nftables 里统一做，而不是在运行中的容器里改
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 10.0.0.0/8 -j REJECT
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 172.16.0.0/12 -j REJECT
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 192.168.0.0/16 -j REJECT
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 169.254.0.0/16 -j REJECT
```

在云主机上还要通过安全组/网络 ACL 阻断元数据服务；不要只依赖容器内配置。

### 6.3 反向代理加 Bearer

DSH 的 Jina adapter 只发送 **`Authorization: Bearer <JINA_API_KEY>`**，不发送 Basic Auth。因此自建 Reader 如果要远程访问，应使用 Bearer 网关，而不是 Nginx `auth_basic`。

先生成一个长随机 token：

```bash
openssl rand -hex 32
```

把 token 保存到 DSH 的 `JINA_API_KEY`，并写进 Nginx 的 `map`（只放在权限 600 的配置文件里）。

`/etc/nginx/conf.d/jina-reader-auth.conf`：

```nginx
map $http_authorization $reader_ok {
    default 0;
    "Bearer REPLACE_WITH_LONG_RANDOM_TOKEN" 1;
}

limit_req_zone $binary_remote_addr zone=reader_limit:10m rate=2r/s;
```

`/etc/nginx/sites-available/jina-reader.conf`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name reader.example.com;

    location / {
        # 只放在 location / 里；放 server 层会挡住 certbot 的 HTTP-01 挑战
        if ($reader_ok = 0) {
            return 401;
        }

        limit_req zone=reader_limit burst=10 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header Connection "";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
        client_max_body_size 10m;
    }
}
```

启用并申请证书：

```bash
sudo ln -s /etc/nginx/sites-available/jina-reader.conf /etc/nginx/sites-enabled/jina-reader.conf
sudo nginx -t
sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d reader.example.com
```

验证：

```bash
# 无 token，应 401
curl -i 'https://reader.example.com/https://example.com/' | head

# 带 token，应 200
curl -fsS -H 'Authorization: Bearer REPLACE_WITH_LONG_RANDOM_TOKEN' \
  'https://reader.example.com/https://example.com/' | head
```

然后在 DSH：

- Endpoint：`https://reader.example.com/`
- API key：与 Nginx 里一致的 token

> 不要把 token 写进 Git、公开 compose 文件或聊天记录。Nginx 配置含 token 时，`chmod 600`，并定期轮换。

### 6.4 不需要公网时

- 只在本机：保持 `127.0.0.1:3000`，不加反代；
- 远程办公：SSH 隧道 `ssh -L 3000:127.0.0.1:3000 user@server`；
- 团队：Tailscale / WireGuard 内网访问，公网不开放 3000。

### 6.5 其他风险

- **X-Proxy-Url / X-Proxy**：可以让 Reader 走你指定的代理；如果攻击者能控制这个头，就能借 Reader 访问代理后面的网络。不要把 Reader 开放给不可信用户。
- **缓存**：S3 缓存会保留目标页面内容；设置生命周期、访问控制和加密。
- **日志**：Reader/反代日志可能包含完整目标 URL（含查询参数）；按隐私要求脱敏/缩短保留。
- **供应链**：`oss` 是可变 tag；生产建议固定 digest。
- **法律/条款**：Reader 不绕过付费墙；抓取仍受目标站点条款和当地法律约束。

## 7. 日常运维

### 7.1 状态和日志

```bash
cd /opt/jina-reader
docker compose ps
docker compose logs --tail=100 reader
docker stats --no-stream jina-reader
```

### 7.2 缓存（可选）

默认无状态；需要跨请求缓存时，用官方 S3 兼容变量（见 4.7）。如果要接本地 MinIO，可单独起一个 MinIO 服务，把 `GCP_STORAGE_ENDPOINT` 指向它，并创建 bucket。缓存不是 DSH 正常工作的前提；先用无缓存模式跑通，再考虑缓存。

### 7.3 更新

```bash
cd /opt/jina-reader
docker compose pull
docker compose up -d
docker compose ps
```

升级前记录当前镜像 digest，方便回滚：

```bash
docker inspect ghcr.io/jina-ai/reader:oss \
  --format '{{index .RepoDigests 0}}'
```

生产建议固定 digest：

```yaml
image: ghcr.io/jina-ai/reader@sha256:REPLACE_WITH_DIGEST
```

固定 tag 也能减少意外，但 `oss` 仍是可变标签；digest 才是不可变引用。

### 7.4 备份

Reader 默认没有持久化数据；需要备份的是：

- `compose.yaml`；
- `.env` / Nginx 配置（含 Token 的要加密/限权）；
- 如果你自己加了缓存 bucket，备份 bucket 策略而不是容器。

```bash
sudo mkdir -p /var/backups/jina-reader
tar czf "/var/backups/jina-reader/jina-reader-$(date +%F).tgz" \
  -C /opt/jina-reader compose.yaml
```

### 7.5 卸载

```bash
cd /opt/jina-reader
docker compose down
docker image rm ghcr.io/jina-ai/reader:oss
```

默认没有命名卷；如果你加过缓存或本地存储，先确认数据位置再删除。

## 8. 故障排查

### 8.1 `curl` 无响应 / 连接重置

**最常见原因**：把容器 `8080`（h2c）映射给普通 HTTP/1.1 客户端。

```bash
# 正确：映射 8081
docker run --rm -p 3000:8081 ghcr.io/jina-ai/reader:oss
```

如果你确实要用 `8080`：

```bash
curl --http2-prior-knowledge 'http://127.0.0.1:8080/https://example.com/'
```

Nginx 反代请用 `8081`，不要用 h2c 端口。

### 8.2 容器启动即退出

```bash
docker compose logs --tail=200 reader
docker inspect jina-reader --format '{{.State.ExitCode}}'
```

常见原因：

- 镜像拉取失败/架构不匹配；
- 端口被占用；
- 内存/共享内存太小；
- 宿主机缺少 Chrome 需要的内核能力（极少见，优先用官方镜像而不是自己构建）。

### 8.3 502 Bad Gateway

```bash
curl -v http://127.0.0.1:3000/https://example.com/
docker compose ps
docker compose logs --tail=100 reader
```

检查 Nginx 的 `proxy_pass` 是不是 `127.0.0.1:3000`，以及 Reader 是否监听 `8081`。

### 8.4 401 / 403

- **401**：Nginx Bearer 不匹配，或托管 Jina API key 无效；
- **403**：目标站点拒绝 Reader（反爬、地区限制、付费墙），或托管 Jina 权限/额度问题。

用本地 Reader 直连测试，把“Reader 自身”和“目标站点”分开：

```bash
curl -i -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  --data-urlencode 'url=https://example.com/'
```

如果本地直连 200，经过 Nginx 才 401，问题在反代 token；如果本地直连也 403，问题在目标站点/出口 IP。

### 8.5 429

- 托管 Jina：降低请求频率，配置 API key；免费额度/匿名限流会变；
- 自建：检查 Nginx `limit_req`，以及是否有其他进程在刷 Reader；
- 不要通过关闭限流来解决公网滥用。

### 8.6 超时

```bash
time curl -fsS -X POST 'http://127.0.0.1:3000/' \
  -H 'Accept: application/json' \
  -H 'X-Engine: browser' \
  -H 'X-Timeout: 60' \
  --data-urlencode 'url=https://example.com/' \
  | jq -r '.data.content | length'
```

如果 60 秒仍失败：

- 目标页可能非常重/被墙；
- Chrome 内存不足；
- `X-Wait-For-Selector` 等了一个永远不出现的元素；
- 目标站点对数据中心 IP 做了限制。

DSH 侧还要看 `tool-web.fetchTimeoutMs` 是否大于 Reader 超时。

### 8.7 OOM / Chrome 崩溃

```bash
docker stats --no-stream jina-reader
docker inspect jina-reader --format '{{.HostConfig.ShmSize}}'
```

处理：

- `shm_size: "1gb"`（或 `--shm-size=1g`）；
- 提高 `mem_limit`；
- 降低并发/批量抓取；
- 不要同时跑大量 PDF/Office 转换；
- 看 `docker logs` 是否有 `Page crashed`、`Target closed`。

### 8.8 PDF / Office 解析失败

- 确认镜像是最新 `oss`；官方镜像包含 LibreOffice/PDF.js；
- 扫描版 PDF 可能没有文本层，需要 OCR，而 Reader 不是 OCR 服务；
- 文件受登录/付费墙保护时，Reader 也拿不到；
- 大文件需要更多内存和时间。

### 8.9 DSH 错误码对照

| 错误码 | 含义 | 优先检查 |
|---|---|---|
| `JINA_AUTH` | 401/403 | API key、Nginx Bearer、托管额度 |
| `JINA_RATE_LIMIT` | 429 | 降低频率、检查限流 |
| `JINA_TIMEOUT` | 超时 | Reader 日志、目标站点、DSH 工具超时 |
| `JINA_NETWORK` | 连不上 Reader | 端口、容器状态、DNS、反代 |
| `JINA_HTTP` | Reader 返回 5xx/其他 | Reader 日志、镜像版本 |
| `JINA_BAD_RESPONSE` | 没有当前模式的字段 | `Accept: application/json`、`X-Respond-With`、版本 |
| `JINA_RESPONSE_TOO_LARGE` | 超过 `maxResponseBytes` | 调大上限或换小页面 |
| `JINA_TARGET_BLOCKED` | DSH 预检拒绝目标 | 目标不是公网地址；这是预期安全行为 |
| `JINA_INVALID_TARGET` | 目标 URL 非法 | 只允许 http(s)，不能带凭据 |

注意：`JINA_TARGET_BLOCKED` 是 DSH 在发出前拒绝，不是 Reader 返回；不要试图绕过。

### 8.10 中文乱码 / 字体缺失

官方镜像包含 CJK 字体；如果自建镜像或自己构建，可能缺字体。优先使用官方 `ghcr.io/jina-ai/reader:oss`，不要为了“减小镜像”删字体和 LibreOffice。

### 8.11 TLS / 证书错误

- 远程 endpoint 必须是 HTTPS；
- 证书链要完整（Nginx 用 `fullchain.pem`）；
- 系统时间要正确；
- 自签名证书不会被 DSH 信任；用 Let's Encrypt 或私有 CA 并正确配置信任。

## 9. 安全与合规清单

- [ ] Reader 只绑定 `127.0.0.1` 或 VPN 地址；
- [ ] 公网入口有 TLS + Bearer + 限流；
- [ ] 没有把 `3000`/`8080` 裸奔到公网；
- [ ] 容器非 root、无 `--privileged`、无 Docker socket 挂载；
- [ ] 已限制容器到内网/云元数据的出口；
- [ ] 没有把 Reader 和敏感服务放在同一信任域；
- [ ] 缓存桶有访问控制和生命周期；
- [ ] 日志中的 URL/查询参数按隐私要求处理；
- [ ] 镜像固定 digest，升级前记录回滚点；
- [ ] 明确 Reader 不绕过登录、付费墙、验证码；
- [ ] 托管 Jina 时已向使用者说明目标 URL 会离开本机。

## 10. 附：官方参考

- [Jina Reader 仓库](https://github.com/jina-ai/reader)
- [Self-host with Docker](https://github.com/jina-ai/reader#self-host-with-docker)
- [环境变量](https://github.com/jina-ai/reader/blob/main/CONTRIBUTING.md#environment-variables)
- [请求头源码](https://github.com/jina-ai/reader/blob/main/src/dto/crawler-options.ts)
- [Reader API 文档](https://r.jina.ai/docs)
- [GitHub Container Registry 镜像](https://github.com/jina-ai/reader/pkgs/container/reader)
- [Docker Engine 安装](https://docs.docker.com/engine/install/)
- 配套教程：[SearXNG Linux Docker 部署与使用](searxng-docker-linux.md)
- 本项目 Jina 配置：[README · Jina Reader 抓取配置](../README.md#jina-reader-抓取配置)

## 11. 本文没有替你验证的事

- 没有在本机启动 Docker 容器；
- 没有验证你的目标站点是否反爬、是否需要登录；
- 没有验证云厂商元数据/内网出口规则是否真的生效；
- 没有验证托管 Jina 的当前免费额度；
- 没有验证你的 Nginx 证书、DNS 和防火墙；
- 没有验证 `oss` 镜像与你使用的 DSH 版本在所有边缘情况下的兼容性。

上线前请至少完成：

1. 本地 `example.com` GET/POST 通过；
2. DSH 设置页 **测试** 通过；
3. 一次真实 `web_fetch` 和一次 `web_research` 通过；
4. 无 Token 访问返回 401、带 Token 返回 200；
5. 从容器内访问内网/元数据地址被阻断（或至少在独立网络里验证过）；
6. 重启宿主机后容器能自动恢复。
