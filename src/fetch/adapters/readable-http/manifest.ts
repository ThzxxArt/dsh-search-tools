/** Readable HTTP fetch adapter manifest. */

import type { AdapterManifest, JsonObject } from '../../../core/types.ts'
import { DEFAULT_READABLE_HTTP_CONFIG } from './schema.ts'

export const readableHttpManifest: AdapterManifest = {
  kind: 'fetch',
  id: 'readable-http',
  label: 'Readability HTTP',
  description: '复用 DSH 的安全 HTTP 抓取，再用 Readability 提取正文；失败时回退原始内容。',
  defaults: DEFAULT_READABLE_HTTP_CONFIG as unknown as JsonObject,
  capabilities: ['readability', 'probe'],
  fields: [
    { kind: 'boolean', key: 'enabled', label: '启用正文提取', default: true },
    { kind: 'boolean', key: 'readability', label: '使用 Readability', default: true },
    { kind: 'number', key: 'minArticleChars', label: '正文最小字符数', min: 0, max: 100_000, step: 1, default: 200 },
    { kind: 'number', key: 'maxArticleChars', label: '正文最大字符数', min: 1_000, max: 5_000_000, step: 1_000, default: 200_000 },
    { kind: 'number', key: 'maxResponseBytes', label: '响应最大字节', min: 1_024, max: 50_000_000, step: 1_024, default: 5_000_000 },
    { kind: 'number', key: 'maxBodyChars', label: '解码最大字符', min: 1_024, max: 20_000_000, step: 1_024, default: 2_000_000 },
    { kind: 'number', key: 'timeoutMs', label: '超时（ms）', min: 1_000, max: 120_000, step: 500, default: 20_000 },
    { kind: 'number', key: 'maxRedirects', label: '最大重定向', min: 0, max: 10, step: 1, default: 5 },
    { kind: 'text', key: 'userAgent', label: 'User-Agent' },
    { kind: 'boolean', key: 'failOpen', label: '提取失败时回退原文', default: true },
  ],
}
