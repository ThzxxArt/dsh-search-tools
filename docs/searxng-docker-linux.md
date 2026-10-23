# SearXNG Linux Docker 部署与使用教程

> 适用对象：在 Linux 上自建 SearXNG，并把它接入 `dsh-search-tools` / DeepSeek Harness 的 `web_search`、`web_research`。
>
> 本文以 SearXNG 官方当前容器模板（`searxng/searxng` 仓库的 `container/docker-compose.yml`）为准，配置核对日期：**2026-10-23**。官方文档版本：`2026.10.19+81371861f`。
>
> 说明：编写本文的开发机没有安装 Docker，所以容器命令没有在本机实际启动；所有命令、字段和端口都按官方文档与官方模板核对，并在每一步给出可执行的验收方式。首次上线请先在测试机或测试目录跑通，再迁移到正式目录。

## 1. 先看清：你要部署的是什么

SearXNG 是一个元搜索引擎：它把查询转发给 Google、Bing、DuckDuckGo、Wikipedia 等上游引擎，再把结果聚合起来。它不是搜索索引，也不是“匿名代理”；上游引擎仍然会看到 SearXNG 服务器的出口 IP。

本教程的部署结构是：

```text
浏览器 / DSH
     │  http://127.0.0.1:8080  或  https://search.example.com
     ▼
┌─────────────────────────────────────────┐
│ Docker Compose 项目 searxng             │
│                                         │
│  searxng-core    SearXNG 应用 :8080     │
│  searxng-valkey  Valkey   :6379（内部） │
│                                         │
│  core-config/settings.yml               │
│  core-data（favicon 等缓存）            │
│  valkey-data（限流状态）                │
└─────────────────────────────────────────┘
```

关键点：

- **只暴露 `8080` 给本机或反向代理**，不要直接把 `8080` 暴露到公网。
- **Valkey 不对外发布端口**，它只给 SearXNG 的 limiter 用。
- `core-config/settings.yml` 是配置中心；官方容器首次启动时会从模板自动生成，但本教程会显式创建，便于固定 `secret_key` 和 JSON API。
- **JSON API 必须显式开启**，否则 `format=json` 会返回 403。DSH 的 `format=auto` 可以回退 HTML，但 JSON 更稳定，建议开启。
- 官方当前模板使用 **Valkey**，不是旧教程里的 Redis。旧 `searxng-docker` 仓库仍可运行，但官方文档已经给出迁移到新模板的路径；新部署不要照抄旧教程。

官方资料：

- [SearXNG 容器安装](https://docs.searxng.org/admin/installation-docker.html)
- [官方 compose 模板](https://github.com/searxng/searxng/blob/master/container/docker-compose.yml)
- [官方 `.env.example`](https://github.com/searxng/searxng/blob/master/container/.env.example)

## 2. 前提条件

### 2.1 系统和资源

建议：

| 项目 | 最低 | 建议 |
|---|---:|---:|
| Linux | 能运行 Docker 的 x86_64/arm64 | Debian 12/13、Ubuntu 22.04/24.04 |
| CPU | 1 核 | 2 核 |
| 内存 | 512 MB | 1–2 GB |
| 磁盘 | 1 GB 可用 | 5 GB 以上 |
| 网络 | 能访问上游搜索引擎 | 稳定的出网 DNS/代理 |

SearXNG 本身很轻，真正吃资源的是并发搜索、图片代理和 Valkey 限流状态。给 2 GB 内存、2 核 CPU 对个人/小团队足够。

### 2.2 安装 Docker Engine 和 Compose 插件

下面以 **Debian / Ubuntu** 为例。Fedora / RHEL / Arch 请用 Docker 官方对应发行版的仓库；不要用发行版里过旧的 `docker.io` 包代替。

```bash
# 1) 基础工具
sudo apt-get update
sudo apt-get install -y ca-certificates curl jq openssl

# 2) Docker 官方 GPG key
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
  | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc

# 3) Docker 官方 apt 源
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

# 4) 安装 Engine + Compose 插件
sudo apt-get update
sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# 5) 开机启动
sudo systemctl enable --now docker

# 6) 让当前用户能直接使用 docker
sudo usermod -aG docker "$USER"
```

`usermod` 之后要**重新登录**，或者当前 shell 执行 `newgrp docker`。然后验证：

```bash
docker version
docker compose version
docker run --rm hello-world
```

如果 `docker compose version` 找不到命令，说明只装了旧版 `docker-compose`，请补装 `docker-compose-plugin`。本文全部使用 `docker compose`（有空格），不是 `docker-compose`。

官方安装文档：<https://docs.docker.com/engine/install/>

### 2.3 防火墙

如果只在单机本机使用，**不要**开放 8080：

```bash
# 只允许 SSH；本机访问 127.0.0.1:8080 不需要开防火墙端口
sudo ufw allow 22/tcp
sudo ufw enable
```

如果要通过 Nginx 对外提供 HTTPS：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

不要执行 `ufw allow 8080` 把 SearXNG 裸端口暴露出去。

## 3. 目录与官方 Compose 模板

推荐放在 `/opt/searxng`：

```bash
sudo mkdir -p /opt/searxng/core-config
sudo chown -R "$USER":"$USER" /opt/searxng
cd /opt/searxng

# 官方当前模板：core + valkey
curl -fsSLO https://raw.githubusercontent.com/searxng/searxng/master/container/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/searxng/searxng/master/container/.env.example

cp -n .env.example .env
chmod 600 .env
```

目录应该长这样：

```text
/opt/searxng/
├── docker-compose.yml
├── .env
└── core-config/
    └── settings.yml      # 下一步创建
```

查看模板内容和 Compose 解析结果：

```bash
sed -n '1,160p' docker-compose.yml
docker compose config
```

官方模板的核心内容（不要手改镜像名，除非你明确知道自己在做什么）：

```yaml
name: searxng

services:
  core:
    container_name: searxng-core
    image: docker.io/searxng/searxng:${SEARXNG_VERSION:-latest}
    restart: always
    ports:
      - ${SEARXNG_HOST:+${SEARXNG_HOST}:}${SEARXNG_PORT:-8080}:${SEARXNG_PORT:-8080}
    env_file: ./.env
    volumes:
      - ./core-config/:/etc/searxng/:Z
      - core-data:/var/cache/searxng/

  valkey:
    container_name: searxng-valkey
    image: docker.io/valkey/valkey:9-alpine
    command: valkey-server --save 300 1 --save 60 1000 --loglevel warning
    restart: always
    volumes:
      - valkey-data:/data/

volumes:
  core-data:
  valkey-data:
```

`.env` 只保留必要项，先绑定本机：

```dotenv
# 首次部署可以先用 latest；验证后建议改成固定版本 tag
SEARXNG_VERSION=latest

# 只监听本机，由 Nginx / SSH 隧道 / VPN 访问
SEARXNG_HOST=127.0.0.1
SEARXNG_PORT=8080
```

> **为什么绑定 `127.0.0.1`？** SearXNG 自己没有账号系统；裸端口暴露到公网等于把搜索服务交给所有人。需要远程访问时，用 Nginx + TLS + Basic Auth，或者只开放 SSH 隧道/VPN。

## 4. 写 `settings.yml`

### 4.1 生成随机 `secret_key`

```bash
cd /opt/searxng
umask 077
SECRET=$(openssl rand -hex 32)
printf '%s\n' "$SECRET"
```

不要把 `secret_key` 提交到 Git、发到聊天或写进公开 issue。把下面配置里的 `PASTE_RANDOM_SECRET_HERE` 替换成刚生成的 64 位十六进制字符串。

### 4.2 本机/内网使用的最小配置

创建 `core-config/settings.yml`：

```yaml
use_default_settings: true

general:
  instance_name: "dsh-searxng"

server:
  # 本机访问；接反向代理后改成 https://search.example.com/
  base_url: "http://127.0.0.1:8080/"
  secret_key: "PASTE_RANDOM_SECRET_HERE"

  # 私有实例先关闭 limiter；公网/多人使用再打开，见 4.4
  limiter: false
  public_instance: false

  # 可选：图片走 SearXNG 代理，避免浏览器直连第三方图片站
  image_proxy: true

search:
  safe_search: 0
  default_lang: "zh-CN"
  formats:
    - html
    - json
```

逐项解释：

| 字段 | 作用 | 本教程值 |
|---|---|---|
| `use_default_settings` | 在镜像自带默认配置上做增量覆盖 | `true`，必须 |
| `general.instance_name` | 页面标题/实例名 | 可改 |
| `server.base_url` | 生成链接、CSRF、静态资源的基地址 | 必须与访问地址一致 |
| `server.secret_key` | 会话/CSRF 等加密密钥 | 必须随机，不能留模板值 |
| `server.limiter` | 请求限流/ bot 防护 | 私有 `false`；公开 `true` |
| `server.public_instance` | 公共实例特性（link token、image proxy 等） | 私有 `false` |
| `server.image_proxy` | 图片代理 | 可选；会增加内存 |
| `search.safe_search` | 0 关 / 1 中 / 2 严 | `0` 或按需 |
| `search.default_lang` | 默认语言 | `zh-CN` 或留空 |
| `search.formats` | 允许的响应格式 | 必须包含 `json` |

> **JSON 是重点。** `search.formats` 默认可能只有 `html`，此时 `format=json` 会返回 403。加入 `json` 后，DSH 可以稳定拿到结构化结果。

### 4.3 权限和配置校验

```bash
chmod 640 core-config/settings.yml
docker compose config >/dev/null && echo "compose 配置有效"
```

SearXNG 容器入口脚本会在首次启动时检查配置目录；如果发现属主不是 `searxng:searxng`，会尝试用 root 修正，或者打印 warning。看到 ownership warning 时，先看 8.6 节，不要直接 `chmod 777`。

### 4.4 公网/多人使用的配置差异

如果你要让别人通过 HTTPS 使用，建议至少做三件事：

1. Nginx / Caddy 加 TLS；
2. 加 Basic Auth 或放在 VPN 后面；
3. 打开 limiter，并确认 Valkey 可用。

在 `settings.yml` 里改成：

```yaml
server:
  base_url: "https://search.example.com/"
  secret_key: "PASTE_RANDOM_SECRET_HERE"
  limiter: true
  public_instance: false   # 有登录保护时保持 false；完全公开才考虑 true
  image_proxy: true

valkey:
  url: valkey://valkey:6379/0
```

说明：

- `limiter: true` 需要 Valkey；官方 compose 已经带了 `valkey` 服务，主机名就是 `valkey`。
- `public_instance: true` 只适用于真正公开、无登录的实例；它会启用公共实例相关特性。私有实例不要为了“看起来更完整”打开它。
- 如果 limiter 把你的 DSH 请求也拦了，先看 8.2；不要在公网实例上直接关掉 limiter 了事。
- 修改 `base_url` 后必须重启 `core`，否则页面链接、CSRF 和静态资源可能错乱。

## 5. 启动与验收

### 5.1 启动

```bash
cd /opt/searxng
docker compose up -d
docker compose ps
```

正常应看到 `searxng-core` 为 `Up`，`searxng-valkey` 为 `Up`；`core` 的端口映射类似：

```text
127.0.0.1:8080->8080/tcp
```

看日志：

```bash
docker compose logs -f core
```

首次启动会打印版本、配置路径，并可能提示从模板生成了 `settings.yml`。如果你已经创建了文件，它不会覆盖。`Ctrl-C` 只退出日志，不会停止容器。

### 5.2 检查首页

```bash
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8080/
```

返回 `HTTP 200` 即首页可访问。

### 5.3 检查 JSON API

```bash
curl -fsS --get 'http://127.0.0.1:8080/search' \
  --data-urlencode 'q=DeepSeek Harness' \
  --data-urlencode 'format=json' \
  --data-urlencode 'language=zh-CN' \
  | jq '{results: (.results | length), first: .results[0].url, unresponsive: .unresponsive_engines}'
```

期望输出类似：

```json
{
  "results": 10,
  "first": "https://example.com/...",
  "unresponsive": []
}
```

如果返回 403，优先检查：

1. `settings.yml` 里 `search.formats` 是否有 `json`；
2. 修改后是否重启了 `core`；
3. 是否被 limiter 拦截（先看日志和 8.2）。

如果返回 200 但 `results` 为空，不一定是部署失败。看 `unresponsive_engines`：可能是某个上游引擎被限流/CAPTCHA。换一个引擎或查询再试：

```bash
curl -fsS --get 'http://127.0.0.1:8080/search' \
  --data-urlencode 'q=linux docker' \
  --data-urlencode 'format=json' \
  --data-urlencode 'engines=bing' \
  | jq '{results: (.results | length), unresponsive: .unresponsive_engines}'
```

> DSH 的 `Search notes` 会保留 `unresponsive_engines`。看到 0 条结果时，先看 notes，不要直接认定“SearXNG 坏了”。

### 5.4 检查 POST

SearXNG 同时支持 GET 和 POST。DSH 默认 GET，但长查询可以 POST：

```bash
curl -fsS -X POST 'http://127.0.0.1:8080/search' \
  --data-urlencode 'q=Docker Compose healthcheck' \
  --data-urlencode 'format=json' \
  | jq '.results | length'
```

### 5.5 常用 API 参数

| 参数 | 示例 | 说明 |
|---|---|---|
| `q` | `q=DeepSeek` | 查询词 |
| `format` | `format=json` | `html` / `json` / `csv` / `rss`，必须已在 `search.formats` 开启 |
| `language` | `language=zh-CN` | 语言过滤 |
| `categories` | `categories=general` | 分类，多个用逗号 |
| `engines` | `engines=bing,wikipedia` | 指定引擎；名字必须是实例启用的精确名称 |
| `pageno` | `pageno=2` | 页码 |
| `time_range` | `time_range=year` | `day` / `week` / `month` / `year` |
| `safesearch` | `safesearch=1` | 0/1/2 |

> 引擎名写错通常不会报错，而是被静默忽略或返回 0 条；先在浏览器里确认实例支持哪些引擎，再写进 DSH 配置。

## 6. 反向代理、TLS 与 Basic Auth

只在单机用可以跳过本节。要通过公网/局域网域名访问，推荐 Nginx + Let's Encrypt + Basic Auth。

### 6.1 安装 Nginx 和 htpasswd

```bash
sudo apt-get install -y nginx apache2-utils certbot python3-certbot-nginx
sudo htpasswd -c /etc/nginx/.htpasswd dsh
```

`htpasswd` 会提示设置密码。这个用户名/密码就是 DSH Search 适配器里的 Basic 凭据；不要复用系统密码。

### 6.2 先配 HTTP 站点

创建 `/etc/nginx/sites-available/searxng.conf`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name search.example.com;

    location / {
        # auth 只放在 location / 里，避免把 certbot 的 HTTP-01 挑战也挡成 401
        auth_basic "SearXNG";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:8080;

        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection $http_connection;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 60s;
        client_max_body_size 2m;
    }
}
```

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/searxng.conf /etc/nginx/sites-enabled/searxng.conf
sudo nginx -t
sudo systemctl reload nginx
```

此时访问 `http://search.example.com` 应该弹出 Basic Auth；认证后能看到 SearXNG。

### 6.3 申请证书并切到 HTTPS

```bash
sudo certbot --nginx -d search.example.com
```

Certbot 会自动修改 Nginx 配置、加 443 和 HTTP→HTTPS 跳转。然后：

1. 把 `core-config/settings.yml` 的 `server.base_url` 改成：

   ```yaml
   base_url: "https://search.example.com/"
   ```

2. 重启：

   ```bash
   cd /opt/searxng
   docker compose restart core
   ```

3. 验证：

   ```bash
   curl -fsS -u 'dsh:你的密码' \
     'https://search.example.com/search?q=test&format=json' \
     | jq '.results | length'
   ```

### 6.4 为什么要加 `X-Real-IP` / `X-Forwarded-For`

SearXNG 的 limiter 和日志需要真实客户端 IP。反向代理必须传这两个头；否则所有请求看起来都来自 Nginx，限流会误伤或失效。

### 6.5 如果只想内网访问

不想配域名和证书时，两个更简单的选择：

- **SSH 隧道**：在客户端执行 `ssh -L 8080:127.0.0.1:8080 user@server`，然后访问本机 `http://127.0.0.1:8080`；
- **Tailscale / WireGuard**：只在 VPN 内绑定 `127.0.0.1` 或 VPN 地址，不给公网开 8080。

这两种方式都不需要把 SearXNG 裸端口暴露到公网。

### 6.6 公共实例的额外注意

如果你确实要运行一个公开、无登录的 SearXNG：

- `server.limiter: true`；
- `valkey.url` 必须配置；
- `server.public_instance: true`；
- 准备好处理滥用、版权和上游引擎封禁；
- 不要开启不必要的图片代理/大页数，避免内存和带宽被打满；
- 定期看 `docker compose logs` 和 Valkey 状态。

## 7. 接入 DSH / dsh-search-tools

### 7.1 在设置页配置

1. 打开 DSH 的 **设置 → 搜索工具 → 搜索**。
2. 后端选择 `SearXNG`。
3. 添加实例：
   - 本机：`http://127.0.0.1:8080`
   - 反代：`https://search.example.com`
   - 不要在 URL 里带 `/search`、query 或用户名密码。
4. 认证：
   - 没加 Nginx Auth：`none`；
   - 加了 Nginx Basic：选 `basic`，保存 `dsh:密码`；
   - 如果前面是 Bearer 网关：选 `bearer`。
5. 格式建议 `auto`（先 JSON 后 HTML 回退），或强制 `json`。
6. 点 **测试**，确认返回结构化来源；再 **保存并应用**。
7. 需要让内置 `web_search` 走它时，在 **概览** 打开 **接管内置搜索**；只使用 `web_research` 时可以不接管。

对应配置大致如下（实际以设置页写入的 YAML 为准）：

```yaml
search:
  adapter: searxng
  adapters:
    searxng:
      instances:
        - url: https://search.example.com
          enabled: true
          label: home
      auth:
        type: basic
      format: auto
      requestTimeoutMs: 12000
      deadlineMs: 45000
```

### 7.2 常见字段建议

| 字段 | 建议 | 原因 |
|---|---|---|
| `instances` | 1 个主实例，必要时加备用 | 多实例可故障转移 |
| `auth.type` | 反代 Basic 就选 `basic` | DSH 会带 `Authorization: Basic` |
| `format` | `auto` | JSON 不可用时回退 HTML |
| `engines` | 先留空 | 用实例默认引擎，避免写错名字 |
| `categories` | `general` | 一般网页搜索 |
| `language` | `zh-CN` 或 `all` | 按使用习惯 |
| `safesearch` | `1` | 中等安全搜索 |
| `requestTimeoutMs` | `12000` | 单次请求 |
| `deadlineMs` | `45000` | 整次搜索预算，不能小于单次超时 |
| `retries` | `1` | 只重试可重试错误 |
| `cacheTtlMs` | 按需 | 搜索结果缓存 |

### 7.3 用模型工具验证

在 DSH 会话里让模型执行一次搜索，例如：

```text
用 web_search 搜索 “SearXNG Docker 官方文档”，给我 3 条来源。
```

如果使用 `web_research`，它会同时走搜索和抓取；抓取后端由 Fetch 页签决定，和 SearXNG 是分开的。SearXNG 只负责搜索，不负责网页正文抓取。

### 7.4 用 CLI 验证同一实例

`searxng-use-cli` 或自定义脚本可以这样测：

```bash
export SEARXNG_INSTANCE='https://search.example.com'
export SEARXNG_BASIC_AUTH='dsh:你的密码'
python3 /path/to/searxng-use-cli/scripts/search.py -q 'SearXNG Docker' --format brief
```

如果 DSH 能搜到而 CLI 搜不到，优先比较 `base_url`、认证头、代理和实例 URL 是否一致。

## 8. 日常运维

### 8.1 查看状态和日志

```bash
cd /opt/searxng
docker compose ps
docker compose logs --tail=100 core
docker compose logs --tail=100 valkey
```

实时日志：

```bash
docker compose logs -f core
```

### 8.2 更新

先备份（见 8.4），再更新：

```bash
cd /opt/searxng
docker compose pull
docker compose up -d
docker compose ps
```

官方文档的更新流程是 `down` → `pull` → `up -d`；对单机个人实例，直接 `pull` + `up -d` 通常也可以，但如果你改过模板或 `.env`，建议按官方流程先 `down`，避免旧容器残留。

生产环境不要长期用 `latest`。验证某个版本后，把 `.env` 改成固定 tag：

```dotenv
SEARXNG_VERSION=2026.10.19-81371861f
```

具体可用 tag 以 Docker Hub / GHCR 为准；升级前看 release notes。

### 8.3 固定镜像和回滚

- 在 `.env` 固定 `SEARXNG_VERSION`；
- 升级前记录当前 tag；
- 出问题时把 tag 改回旧值，`docker compose up -d`；
- 配置目录 `core-config` 不要跟着镜像一起删。

### 8.4 备份

必须备份：

- `docker-compose.yml`
- `.env`
- `core-config/`（尤其 `settings.yml`）

```bash
sudo mkdir -p /var/backups/searxng
cd /opt/searxng
tar czf "/var/backups/searxng/searxng-$(date +%F-%H%M).tgz" \
  docker-compose.yml .env core-config
```

`core-data` 和 `valkey-data` 是命名卷，通常不是关键数据；如果要完整备份：

```bash
docker run --rm \
  -v searxng_core-data:/data \
  -v /var/backups/searxng:/backup \
  alpine tar czf "/backup/core-data-$(date +%F).tgz" -C /data .
```

卷名可能因 Compose 项目名不同而变化，先用 `docker volume ls` 确认。

恢复时先 `docker compose down`（不要加 `-v`），把配置解压回 `/opt/searxng`，再 `docker compose up -d`。

### 8.5 从旧 `searxng-docker` 迁移

旧仓库通常是：

```text
searxng-docker/
├── searxng/settings.yml
├── Caddyfile
├── docker-compose.yml
└── .env
```

官方迁移步骤：

1. 在旧目录外新建一个官方模板环境；
2. 先让新环境跑起来；
3. 停止旧环境；
4. 把 `searxng-docker/searxng/*` 移到新环境的 `core-config/`；
5. 如果启用了 limiter，把 Valkey 主机名改成 `valkey` 或 `searxng-valkey`；
6. 把旧 `.env` 里的变量补到新 `.env`；
7. 验证后再删除旧目录。

参考：<https://docs.searxng.org/admin/installation-docker.html#migrate-from-searxng-docker>

### 8.6 卸载

保留数据：

```bash
cd /opt/searxng
docker compose down
```

连卷一起删除（**不可恢复**）：

```bash
docker compose down -v
```

删除目录和镜像：

```bash
cd /
sudo rm -rf /opt/searxng
docker image rm docker.io/searxng/searxng:latest
docker image rm docker.io/valkey/valkey:9-alpine
```

执行 `rm -rf` 前先确认路径是 `/opt/searxng`，不要对变量或空路径执行。

## 9. 故障排查

### 9.1 `format=json` 返回 403

**原因**：`search.formats` 没开 `json`，或 limiter 拦截。

**处理**：

```bash
grep -A6 'formats:' core-config/settings.yml
docker compose restart core
docker compose logs --tail=50 core
```

如果配置正确但仍 403，检查 limiter 日志和反向代理的认证头。

### 9.2 `429 Too Many Requests`

**原因**：limiter 触发；常见于代理没有传真实 IP、短时间大量请求、公共实例被刷。

**处理**：

- 私有实例：确认 `server.limiter: false`；
- 公共实例：保留 limiter，检查 Nginx 是否传 `X-Real-IP` / `X-Forwarded-For`；
- 不要用“关掉 limiter”解决公网滥用；
- DSH 侧降低并发、增加重试/退避。

### 9.3 Nginx 502 Bad Gateway

```bash
curl -v http://127.0.0.1:8080/
docker compose ps
docker compose logs --tail=100 core
```

常见原因：

- `core` 没启动；
- 端口不是 8080；
- 容器绑定在 `127.0.0.1`，Nginx 却访问了错误地址；
- SELinux 阻止 Nginx 连接本地端口（看 audit 日志）。

### 9.4 容器启动即退出 / 500

看日志：

```bash
docker compose logs --tail=200 core
```

常见原因是 `settings.yml` YAML 缩进错误、`secret_key` 为空、`base_url` 非法。把配置改回最小版本再启动，逐段加回。

### 9.5 首页能开，但搜索 0 条

先看 `unresponsive_engines`：

```bash
curl -fsS --get 'http://127.0.0.1:8080/search' \
  --data-urlencode 'q=test' \
  --data-urlencode 'format=json' \
  | jq '.unresponsive_engines'
```

如果是 `Suspended: CAPTCHA` 或 `too many requests`，是上游引擎限制，不是 Docker 配置。换引擎、换出口 IP 或降低频率。

### 9.6 权限 / SELinux 报错

- 官方 compose 使用 `:Z` 挂载，SELinux 系统不要去掉；
- 确认 `core-config` 可读；
- 不要用 `chmod 777`；
- 看 `docker compose logs core` 里的 ownership warning；
- 官方入口脚本默认会尝试修正 ownership；如果你改了 `FORCE_OWNERSHIP`，恢复默认或手动修正。

### 9.7 端口被占用

```bash
sudo ss -lntp | grep ':8080'
```

修改 `.env` 的 `SEARXNG_PORT` 后：

```bash
docker compose up -d
```

注意：改端口后 DSH 实例 URL 也要同步改。

### 9.8 HTTPS 下页面错乱 / CSRF 失败

`server.base_url` 必须和浏览器地址完全一致（协议、域名、端口、结尾 `/`）。改成 HTTPS 后：

```bash
docker compose restart core
```

清一次浏览器 Cookie 再试。

### 9.9 limiter 报 Valkey 连接失败

确认：

```bash
docker compose ps
docker compose logs --tail=100 valkey
```

`settings.yml` 里应是：

```yaml
valkey:
  url: valkey://valkey:6379/0
```

不是旧教程里的 `redis://redis:6379/0`。

### 9.10 镜像拉取失败

Docker Hub 对匿名拉取有限流。可以改用 GHCR 镜像：

```yaml
image: ghcr.io/searxng/searxng:${SEARXNG_VERSION:-latest}
```

或者登录 Docker Hub 后重试。不要从不明来源的镜像仓库拉 SearXNG。

## 10. 安全清单

上线前逐项确认：

- [ ] `SEARXNG_HOST=127.0.0.1`，公网只开 80/443；
- [ ] Nginx/Caddy 有 TLS，HTTP 自动跳转 HTTPS；
- [ ] 有 Basic Auth / VPN / 其他访问控制；
- [ ] `secret_key` 是随机值，未提交到 Git；
- [ ] `search.formats` 只开需要的格式（至少 `html` + `json`）；
- [ ] 公网实例开启 limiter 和 Valkey；
- [ ] `.env`、`settings.yml` 权限不是 644/777；
- [ ] 镜像 tag 固定，升级前备份；
- [ ] 日志里没有凭据；
- [ ] 知道 SearXNG 不是匿名网络，查询仍会到达上游引擎；
- [ ] 不把 SearXNG 当作绕过登录、付费墙或验证码的工具。

## 11. 附：DSH 配置速查

```yaml
search:
  adapter: searxng
  adapters:
    searxng:
      instances:
        - url: https://search.example.com
          enabled: true
          label: home
      engines: []
      categories:
        - general
      language: zh-CN
      safesearch: 1
      pages: 1
      maxResults: 10
      strategy: ordered
      method: GET
      format: auto
      auth:
        type: basic
      requestTimeoutMs: 12000
      deadlineMs: 45000
      retries: 1
      cacheTtlMs: 300000
```

如果实例没有认证，把 `auth.type` 改成 `none`。如果使用 Bearer 网关，改成 `bearer` 并在 DSH 凭据里保存 token。

## 12. 官方参考

- [SearXNG 容器安装](https://docs.searxng.org/admin/installation-docker.html)
- [官方 Compose 模板](https://github.com/searxng/searxng/blob/master/container/docker-compose.yml)
- [官方 `.env.example`](https://github.com/searxng/searxng/blob/master/container/.env.example)
- [`server:` 设置](https://docs.searxng.org/admin/settings/settings_server.html)
- [`search:` 设置](https://docs.searxng.org/admin/settings/settings_search.html)
- [`valkey:` 设置](https://docs.searxng.org/admin/settings/settings_valkey.html)
- [Nginx 反向代理](https://docs.searxng.org/admin/installation-nginx.html)
- [Limiter](https://docs.searxng.org/admin/searx.limiter.html)
- [搜索 API](https://docs.searxng.org/dev/search_api.html)
- [Docker Engine 安装](https://docs.docker.com/engine/install/)
- 配套教程：[Jina Reader Linux Docker 部署与使用](jina-reader-docker-linux.md)
- 本项目配置：[README · SearXNG 搜索配置](../README.md#searxng-搜索配置)

## 13. 本文没有替你验证的事

- 没有在本机启动 Docker 容器；
- 没有验证你的上游引擎是否被 CAPTCHA/限流；
- 没有替你申请域名和证书；
- 没有验证你的云厂商防火墙、SELinux/AppArmor 策略；
- 没有验证公网滥用防护是否足够。

这些必须在你的目标主机上按第 5、6 节的验收命令逐项跑一遍。部署完成不等于搜索质量完成；SearXNG 的结果质量取决于上游引擎和你选择的出口网络。
