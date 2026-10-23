/** Jina Reader fetch adapter manifest. */

import type { AdapterField, AdapterManifest, JsonObject } from '../../../core/types.ts'
import { lt } from '../../../shared/localized.ts'
import { DEFAULT_JINA_READER_CONFIG } from './schema.ts'

export const jinaReaderManifest: AdapterManifest = {
  kind: 'fetch',
  id: 'jina-reader',
  label: lt('Jina Reader', 'Jina Reader'),
  description: lt(
    'Delegate public page rendering to a Jina Reader-compatible service: browser engine, PDF/Office, selectors, iframe and Shadow DOM.',
    '把公网页面交给 Jina Reader 兼容服务渲染：支持浏览器引擎、PDF/Office、选择器、iframe 和 Shadow DOM。',
  ),
  notice: lt(
    'The target URL leaves this machine to the configured Reader endpoint unless you self-host it. The Reader may cache pages and may follow redirects/navigations; restrict its egress for private services. It does not sign in, bypass paywalls, or solve CAPTCHAs.',
    '目标 URL 会发送到你配置的 Reader 端点；只有自托管时页面才留在本机。Reader 可能缓存页面，也可能跟随重定向/浏览器跳转；自托管时请限制其网络出口。它不会登录、绕过付费墙或破解验证码。',
  ),
  groups: [
    {
      id: 'connection',
      label: lt('Reader connection', 'Reader 连接'),
      description: lt('Endpoint, engine, timeout, and optional network identity.', '端点、引擎、超时和可选的网络身份。'),
    },
    {
      id: 'output',
      label: lt('Output and extraction', '输出与提取'),
      description: lt('Response shape, selectors, embedded content, and size limits.', '响应形态、选择器、嵌入内容和大小上限。'),
    },
    {
      id: 'privacy',
      label: lt('Privacy and access', '隐私与访问'),
      description: lt('Cache freshness and robots.txt behavior.', '缓存新鲜度与 robots.txt 行为。'),
    },
  ],
  defaults: DEFAULT_JINA_READER_CONFIG as unknown as JsonObject,
  capabilities: ['browser', 'pdf', 'probe'],
  secretRefs: [
    {
      key: 'apiKey',
      ref: 'JINA_API_KEY',
      label: lt('Jina API key', 'Jina API key'),
      description: lt(
        'Bearer token for the configured Reader endpoint. Anonymous access is heavily rate-limited; the key is stored in DSH credentials, never in YAML.',
        '配置端点使用的 Bearer token。匿名访问限流很严；密钥保存在 DSH 凭据存储，不写入 YAML。',
      ),
      group: 'connection',
    },
  ],
  fields: ([
    { kind: 'boolean', key: 'enabled', label: lt('Enable Jina Reader', '启用 Jina Reader'), default: true },
    {
      kind: 'url',
      key: 'endpoint',
      label: lt('Reader endpoint', 'Reader 端点'),
      description: lt(
        'Use https://r.jina.ai/ for the hosted service or a self-hosted Reader URL. Remote endpoints must use HTTPS; plain HTTP is only accepted for loopback.',
        '托管服务填 https://r.jina.ai/，自托管填 Reader URL。远程端点必须使用 HTTPS；仅 loopback 允许明文 HTTP。',
      ),
      placeholder: 'https://r.jina.ai/',
      required: true,
      default: DEFAULT_JINA_READER_CONFIG.endpoint,
    },
    {
      kind: 'select',
      key: 'engine',
      label: lt('Fetch engine', '抓取引擎'),
      description: lt(
        'Auto lets the Reader choose; browser forces a headless browser and is slower.',
        'auto 由 Reader 决定；browser 强制无头浏览器，速度更慢。',
      ),
      default: 'auto',
      options: [
        { value: 'auto', label: lt('Auto', '自动') },
        { value: 'browser', label: lt('Browser', '浏览器') },
        { value: 'curl', label: lt('Direct HTTP (curl)', '直接 HTTP（curl）') },
      ],
    },
    {
      kind: 'select',
      key: 'responseMode',
      label: lt('Response format', '响应格式'),
      description: lt(
        'Markdown is the default; HTML keeps markup for local Readability. Target errors are read from data.warning, then the official data.httpStatus.',
        '默认 Markdown；HTML 保留标记供本地 Readability 使用。目标站错误优先从 data.warning 读取，其次读官方 data.httpStatus。',
      ),
      default: 'markdown',
      options: [
        { value: 'markdown', label: lt('Markdown', 'Markdown') },
        { value: 'html', label: lt('HTML', 'HTML') },
        { value: 'text', label: lt('Plain text', '纯文本') },
      ],
    },
    {
      kind: 'number',
      key: 'timeoutMs',
      label: lt('Reader timeout (ms)', 'Reader 超时（ms）'),
      description: lt(
        'Local hard deadline. The Reader wait budget is sent one second shorter, so the minimum is 2s. Default 25s stays below the DSH web_fetch 30s tool timeout; raising it above 30s also requires raising the DSH tool timeout.',
        '本地硬超时；发给 Reader 的等待预算会少 1 秒，因此最小值是 2 秒。默认 25 秒，低于 DSH web_fetch 的 30 秒工具超时。超过 30 秒还需同时调高 DSH 工具超时。',
      ),
      min: 2_000,
      max: 180_000,
      step: 500,
      default: 25_000,
    },
    {
      kind: 'select',
      key: 'upstreamProxy',
      label: lt('Reader upstream proxy', 'Reader 上游代理'),
      description: lt('Use auto only when the Reader supports Jina proxy selection and an API key is configured.', '仅当 Reader 支持 Jina 代理选择且已配置 API key 时使用 auto。'),
      default: 'none',
      options: [
        { value: 'none', label: lt('None', '不使用') },
        { value: 'auto', label: lt('Auto', '自动') },
      ],
    },
    {
      kind: 'text',
      key: 'locale',
      label: lt('Browser locale', '浏览器 locale'),
      description: lt('Optional BCP 47 locale for pages that serve different markup by locale.', '可选的 BCP 47 locale；站点会按 locale 返回不同内容。'),
      placeholder: 'zh-CN',
    },
    {
      kind: 'text',
      key: 'userAgent',
      label: lt('Browser User-Agent', '浏览器 User-Agent'),
      description: lt('Sent as X-User-Agent for the target page; leave empty for the Reader default.', '作为 X-User-Agent 发给目标页；留空使用 Reader 默认值。'),
      placeholder: 'Mozilla/5.0 …',
      advanced: true,
    },
    {
      kind: 'number',
      key: 'maxResponseBytes',
      label: lt('Maximum Reader response bytes', 'Reader 响应最大字节'),
      description: lt('Caps the JSON envelope returned by the Reader, not the target page.', '限制 Reader 返回的 JSON 包体，不是目标页大小。'),
      min: 1_024,
      max: 50_000_000,
      step: 1_024,
      default: 5_000_000,
      advanced: true,
    },
    {
      kind: 'number',
      key: 'maxBodyChars',
      label: lt('Maximum content characters', '正文最大字符数'),
      description: lt('Clips the selected mode\'s content locally and reports truncated=true.', '在本地截断当前模式的响应内容，并置 truncated=true。'),
      min: 1_024,
      max: 20_000_000,
      step: 1_024,
      default: 200_000,
    },
    {
      kind: 'text',
      key: 'waitForSelector',
      label: lt('Wait for CSS selector', '等待 CSS 选择器'),
      description: lt('Wait until this element appears before extracting content.', '等待该元素出现后再提取内容。'),
      placeholder: 'main article',
      advanced: true,
    },
    {
      kind: 'text',
      key: 'targetSelector',
      label: lt('Extract CSS selector', '提取 CSS 选择器'),
      description: lt('Only extract content matching this selector.', '只提取匹配该选择器的内容。'),
      placeholder: 'article, .main-content',
      advanced: true,
    },
    {
      kind: 'text',
      key: 'removeSelector',
      label: lt('Exclude CSS selector', '排除 CSS 选择器'),
      description: lt('Remove matching elements before extraction.', '提取前移除匹配的元素。'),
      placeholder: 'nav, footer, .ads',
      advanced: true,
    },
    {
      kind: 'boolean',
      key: 'includeIframes',
      label: lt('Include iframe content', '包含 iframe 内容'),
      default: false,
      advanced: true,
    },
    {
      kind: 'boolean',
      key: 'includeShadowDom',
      label: lt('Include Shadow DOM', '包含 Shadow DOM'),
      default: false,
      advanced: true,
    },
    {
      kind: 'select',
      key: 'retainImages',
      label: lt('Retain images', '保留图片'),
      default: 'none',
      options: [
        { value: 'none', label: lt('Remove images', '移除图片') },
        { value: 'all', label: lt('Keep images', '保留图片') },
      ],
      advanced: true,
    },
    {
      kind: 'select',
      key: 'retainLinks',
      label: lt('Retain links', '保留链接'),
      default: 'all',
      options: [
        { value: 'none', label: lt('Remove links', '移除链接') },
        { value: 'all', label: lt('Keep links', '保留链接') },
      ],
      advanced: true,
    },
    {
      kind: 'boolean',
      key: 'noCache',
      label: lt('Bypass Reader cache', '绕过 Reader 缓存'),
      description: lt('Ask the Reader to fetch the live page instead of a cached copy.', '要求 Reader 重新抓取实时页面，不使用缓存副本。'),
      default: false,
      group: 'privacy',
    },
    {
      kind: 'boolean',
      key: 'respectRobots',
      label: lt('Respect robots.txt', '遵守 robots.txt'),
      description: lt('Ask the Reader to check robots.txt with the dsh-search-tools bot name.', '要求 Reader 以 dsh-search-tools bot 名检查 robots.txt。'),
      default: true,
      group: 'privacy',
    },
  ] satisfies readonly AdapterField[]).map((field): AdapterField => {
    const unit = field.key === 'timeoutMs'
      ? 'ms'
      : field.key === 'maxResponseBytes'
        ? 'bytes'
        : field.key === 'maxBodyChars'
          ? 'chars'
          : undefined
    const group = field.group
      ?? (field.key === 'endpoint'
        || field.key === 'engine'
        || field.key === 'timeoutMs'
        || field.key === 'upstreamProxy'
        || field.key === 'locale'
        || field.key === 'userAgent'
        || field.key === 'enabled'
        ? 'connection'
        : field.key === 'noCache' || field.key === 'respectRobots'
          ? 'privacy'
          : 'output')
    return { ...field, group, ...(unit === undefined ? {} : { unit }) }
  }),
}
