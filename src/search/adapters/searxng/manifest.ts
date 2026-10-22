/** SearXNG adapter manifest: the settings page renders this without SearXNG code. */

import type { AdapterManifest, JsonObject } from '../../../core/types.ts'
import { DEFAULT_SEARXNG_CONFIG } from './schema.ts'

export const searxngManifest: AdapterManifest = {
  kind: 'search',
  id: 'searxng',
  label: 'SearXNG',
  description: '连接你自己的 SearXNG 实例，支持多实例故障转移、JSON/HTML 解析和认证。',
  defaults: DEFAULT_SEARXNG_CONFIG as unknown as JsonObject,
  capabilities: ['json', 'html', 'probe', 'cache', 'pagination'],
  secretRefs: [
    {
      key: 'auth.bearerToken',
      ref: 'SEARXNG_TOKEN',
      label: 'Bearer Token',
      description: '只写入 DSH 凭据存储，不写入 YAML。',
      authType: 'bearer',
    },
    {
      key: 'auth.basic',
      ref: 'SEARXNG_BASIC_AUTH',
      label: 'Basic 用户名:密码',
      description: '格式为 username:password，只写入 DSH 凭据存储。',
      authType: 'basic',
    },
  ],
  fields: [
    { kind: 'boolean', key: 'enabled', label: '启用 SearXNG', default: true },
    { kind: 'instances', key: 'instances', label: '实例', description: '按顺序尝试；失败时自动切换到下一个。' },
    {
      kind: 'tags',
      key: 'engines',
      label: '引擎',
      description: '留空使用实例默认引擎；可填 google、bing、duckduckgo 等。',
      placeholder: 'google, bing',
    },
    {
      kind: 'tags',
      key: 'categories',
      label: '分类',
      description: '通常填 general；留空使用实例默认。',
      placeholder: 'general',
    },
    { kind: 'text', key: 'language', label: '语言', placeholder: 'all / zh-CN / en-US', default: 'all' },
    { kind: 'number', key: 'safesearch', label: '安全搜索（0/1/2）', min: 0, max: 2, step: 1, default: 1 },
    {
      kind: 'select',
      key: 'timeRange',
      label: '时间范围',
      default: '',
      options: [
        { value: '', label: '不限' },
        { value: 'day', label: '最近一天' },
        { value: 'week', label: '最近一周' },
        { value: 'month', label: '最近一月' },
        { value: 'year', label: '最近一年' },
      ],
    },
    { kind: 'number', key: 'pages', label: '分页数', min: 1, max: 3, step: 1, default: 1 },
    { kind: 'number', key: 'maxResults', label: '每次结果数', min: 1, max: 20, step: 1, default: 10 },
    {
      kind: 'select',
      key: 'strategy',
      label: '实例策略',
      default: 'ordered',
      options: [
        { value: 'ordered', label: '顺序优先' },
        { value: 'round-robin', label: '轮询' },
      ],
    },
    {
      kind: 'select',
      key: 'method',
      label: '请求方法',
      default: 'GET',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
      ],
    },
    {
      kind: 'select',
      key: 'format',
      label: '响应格式',
      default: 'auto',
      options: [
        { value: 'auto', label: '自动（JSON → HTML）' },
        { value: 'json', label: '仅 JSON' },
        { value: 'html', label: '仅 HTML' },
      ],
    },
    {
      kind: 'select',
      key: 'auth.type',
      label: '认证',
      default: 'none',
      options: [
        { value: 'none', label: '无' },
        { value: 'bearer', label: 'Bearer Token' },
        { value: 'basic', label: 'Basic' },
      ],
    },
    { kind: 'number', key: 'requestTimeoutMs', label: '单次超时（ms）', min: 1_000, max: 120_000, step: 500, default: 12_000 },
    { kind: 'number', key: 'deadlineMs', label: '总预算（ms）', min: 1_000, max: 300_000, step: 1_000, default: 45_000 },
    { kind: 'number', key: 'retries', label: '每个实例重试次数', min: 0, max: 5, step: 1, default: 1 },
    { kind: 'number', key: 'cacheTtlMs', label: '缓存 TTL（ms）', min: 0, max: 86_400_000, step: 1_000, default: 300_000 },
    { kind: 'number', key: 'cacheMaxEntries', label: '缓存条数', min: 0, max: 10_000, step: 1, default: 200 },
    { kind: 'text', key: 'userAgent', label: 'User-Agent' },
    { kind: 'text', key: 'proxy', label: '代理', placeholder: 'http://127.0.0.1:7890' },
    { kind: 'tags', key: 'includeDomains', label: '只保留域名', placeholder: 'example.com' },
    { kind: 'tags', key: 'excludeDomains', label: '排除域名', placeholder: 'spam.example' },
  ],
}
