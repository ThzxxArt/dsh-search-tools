/** Local-direct manifest: no service, no key, no instances. */

import type { AdapterField, AdapterManifest, JsonObject } from '../../../core/types.ts'
import { lt } from '../../../shared/localized.ts'
import {
  DEFAULT_LOCAL_DIRECT_CONFIG, LOCAL_DIRECT_ENGINES, LOCAL_DIRECT_MARKETS,
  LOCAL_DIRECT_PROFILES, LOCAL_DIRECT_SAFE_SEARCH,
} from './schema.ts'

const engineLabels: Record<(typeof LOCAL_DIRECT_ENGINES)[number], ReturnType<typeof lt>> = {
  duckduckgo: lt('DuckDuckGo', 'DuckDuckGo'),
  bing: lt('Bing', 'Bing'),
  brave: lt('Brave Search · Recommended', 'Brave Search · 推荐'),
  so360: lt('360 Search · Chinese market', '360 搜索 · 中文市场'),
}

const marketLabels: Record<(typeof LOCAL_DIRECT_MARKETS)[number], ReturnType<typeof lt>> = {
  auto: lt('Automatic', '自动'),
  'us-en': lt('United States · English', '美国 · 英语'),
  'cn-zh': lt('China · Chinese', '中国 · 中文'),
  'gb-en': lt('United Kingdom · English', '英国 · 英语'),
  'jp-ja': lt('Japan · Japanese', '日本 · 日语'),
  'de-de': lt('Germany · German', '德国 · 德语'),
  'fr-fr': lt('France · French', '法国 · 法语'),
}

const safeLabels: Record<(typeof LOCAL_DIRECT_SAFE_SEARCH)[number], ReturnType<typeof lt>> = {
  off: lt('Off', '关闭'),
  moderate: lt('Moderate', '适中'),
  strict: lt('Strict', '严格'),
}

const profileLabels: Record<(typeof LOCAL_DIRECT_PROFILES)[number], ReturnType<typeof lt>> = {
  chrome: lt('Chrome', 'Chrome'),
  firefox: lt('Firefox', 'Firefox'),
}

const fields: readonly AdapterField[] = [
  {
    kind: 'boolean',
    key: 'enabled',
    label: lt('Enable Local Direct', '启用 Local Direct'),
    default: true,
    group: 'connection',
  },
  {
    kind: 'checkboxes',
    key: 'engines',
    label: lt('Engines', '搜索引擎'),
    description: lt(
      'At least one engine. Results from all enabled engines are fused locally.',
      '至少一个。所有启用引擎的结果会在本地融合。',
    ),
    required: true,
    default: [...DEFAULT_LOCAL_DIRECT_CONFIG.engines],
    group: 'connection',
    options: LOCAL_DIRECT_ENGINES.map(value => ({ value, label: engineLabels[value] })),
  },
  {
    kind: 'select',
    key: 'market',
    label: lt('Market', '市场'),
    default: DEFAULT_LOCAL_DIRECT_CONFIG.market,
    group: 'connection',
    options: LOCAL_DIRECT_MARKETS.map(value => ({ value, label: marketLabels[value] })),
  },
  {
    kind: 'select',
    key: 'safeSearch',
    label: lt('Safe search', '安全搜索'),
    default: DEFAULT_LOCAL_DIRECT_CONFIG.safeSearch,
    group: 'behavior',
    options: LOCAL_DIRECT_SAFE_SEARCH.map(value => ({ value, label: safeLabels[value] })),
  },
  {
    kind: 'number',
    key: 'maxResults',
    label: lt('Results per search', '每次结果数'),
    min: 1,
    max: 20,
    step: 1,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.maxResults,
    group: 'behavior',
  },
  {
    kind: 'number',
    key: 'maxPerHost',
    label: lt('Results per host', '每站结果数'),
    min: 1,
    max: 5,
    step: 1,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.maxPerHost,
    group: 'behavior',
  },
  {
    kind: 'select',
    key: 'profile',
    label: lt('TLS profile', 'TLS 指纹'),
    default: DEFAULT_LOCAL_DIRECT_CONFIG.profile,
    group: 'advanced',
    options: LOCAL_DIRECT_PROFILES.map(value => ({ value, label: profileLabels[value] })),
  },
  {
    kind: 'number',
    key: 'requestTimeoutMs',
    label: lt('Request timeout', '单引擎超时'),
    min: 1_000,
    max: 30_000,
    step: 500,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.requestTimeoutMs,
    unit: 'ms',
    group: 'advanced',
  },
  {
    kind: 'number',
    key: 'deadlineMs',
    label: lt('Total deadline', '总预算'),
    min: 1_000,
    max: 60_000,
    step: 1_000,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.deadlineMs,
    unit: 'ms',
    group: 'advanced',
  },
  {
    kind: 'number',
    key: 'retries',
    label: lt('Retries', '重试次数'),
    min: 0,
    max: 2,
    step: 1,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.retries,
    group: 'advanced',
  },
  {
    kind: 'number',
    key: 'minIntervalMs',
    label: lt('Minimum engine interval', '引擎最小间隔'),
    min: 0,
    max: 10_000,
    step: 100,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.minIntervalMs,
    unit: 'ms',
    group: 'advanced',
  },
  {
    kind: 'number',
    key: 'cacheTtlMs',
    label: lt('Cache TTL', '缓存 TTL'),
    min: 0,
    max: 86_400_000,
    step: 1_000,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.cacheTtlMs,
    unit: 'ms',
    group: 'advanced',
  },
  {
    kind: 'number',
    key: 'cacheMaxEntries',
    label: lt('Cache entries', '缓存条数'),
    min: 0,
    max: 1_000,
    step: 1,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.cacheMaxEntries,
    group: 'advanced',
  },
  {
    kind: 'number',
    key: 'maxResponseBytes',
    label: lt('Response limit', '响应上限'),
    min: 65_536,
    max: 10_485_760,
    step: 1_024,
    default: DEFAULT_LOCAL_DIRECT_CONFIG.maxResponseBytes,
    unit: 'bytes',
    group: 'advanced',
  },
  {
    kind: 'text',
    key: 'proxy',
    label: lt('Proxy', '代理'),
    placeholder: 'http://127.0.0.1:7890',
    group: 'advanced',
  },
  {
    kind: 'tags',
    key: 'includeDomains',
    label: lt('Include domains', '只保留域名'),
    placeholder: 'example.com',
    group: 'advanced',
  },
  {
    kind: 'tags',
    key: 'excludeDomains',
    label: lt('Exclude domains', '排除域名'),
    placeholder: 'spam.example',
    group: 'advanced',
  },
]

export const localDirectManifest: AdapterManifest = {
  kind: 'search',
  id: 'local-direct',
  label: lt('Local Direct', '本地直连'),
  description: lt(
    'Query public HTML engines directly and fuse their results on this machine. DuckDuckGo and Bing are enabled by default; Brave Search and 360 are optional.',
    '直接查询公开 HTML 搜索引擎，并在本机融合结果。默认启用 DuckDuckGo 与 Bing；Brave Search 与 360 可选。',
  ),
  notice: lt(
    'Runs locally: queries leave this machine to the enabled engines, but parsing, fusion, ranking, and caching stay here. No SearXNG, Reader, API key, browser, or third-party aggregator. JavaScript is not executed. Brave Search uses a Firefox HTTP profile internally; the TLS profile setting applies to the other engines.',
    '在本机运行：查询会直接发往启用的搜索引擎，但解析、融合、排序和缓存都在本机完成。不需要 SearXNG、Reader、API Key、浏览器或第三方聚合服务，也不执行页面 JavaScript。Brave Search 内部使用 Firefox HTTP 指纹；TLS 指纹设置对其余引擎生效。',
  ),
  groups: [
    {
      id: 'connection',
      label: lt('Engines', '搜索引擎'),
      description: lt('Choose the public HTML engines and the market they should target.', '选择公开 HTML 引擎及其市场。'),
    },
    {
      id: 'behavior',
      label: lt('Search behavior', '搜索行为'),
      description: lt('Result count, per-host diversity, and safe search.', '结果数、同站限制和安全搜索。'),
    },
    {
      id: 'advanced',
      label: lt('Advanced', '高级'),
      description: lt('TLS profile, timeouts, retries, cache, proxy, and domain filters.', 'TLS 指纹、超时、重试、缓存、代理和域名过滤。'),
      advanced: true,
    },
  ],
  defaults: DEFAULT_LOCAL_DIRECT_CONFIG as unknown as JsonObject,
  fields,
  sourceCount: { field: 'engines' },
  engineProbe: true,
  capabilities: ['html', 'probe', 'cache'],
}
