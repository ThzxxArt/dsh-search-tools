/** Readable HTTP fetch adapter manifest. */

import type { AdapterField, AdapterManifest, JsonObject } from '../../../core/types.ts'
import { lt } from '../../../shared/localized.ts'
import { DEFAULT_READABLE_HTTP_CONFIG } from './schema.ts'

export const readableHttpManifest: AdapterManifest = {
  kind: 'fetch',
  id: 'readable-http',
  label: lt('Readability HTTP', 'Readability HTTP'),
  description: lt(
    'Reuse DSH safe HTTP retrieval, then extract the article body with Readability; fall back to the raw page on failure.',
    '复用 DSH 的安全 HTTP 抓取，再用 Readability 提取正文；失败时回退原始内容。',
  ),
  groups: [
    {
      id: 'extraction',
      label: lt('Extraction', '正文提取'),
      description: lt('How the readable body is detected and what happens when it is missing.', '正文如何识别，以及提取失败时如何处理。'),
    },
    {
      id: 'limits',
      label: lt('Safety limits', '安全上限'),
      description: lt('Response, decode, timeout, redirect, and identity limits.', '响应、解码、超时、重定向和身份限制。'),
    },
  ],
  defaults: DEFAULT_READABLE_HTTP_CONFIG as unknown as JsonObject,
  capabilities: ['readability', 'probe'],
  fields: ([
    { kind: 'boolean', key: 'enabled', label: lt('Enable body extraction', '启用正文提取'), default: true },
    { kind: 'boolean', key: 'readability', label: lt('Use Readability', '使用 Readability'), default: true },
    {
      kind: 'number',
      key: 'minArticleChars',
      label: lt('Minimum article characters', '正文最小字符数'),
      min: 0,
      max: 100_000,
      step: 1,
      default: 200,
    },
    {
      kind: 'number',
      key: 'maxArticleChars',
      label: lt('Maximum article text characters', '正文文本最大字符数'),
      description: lt(
        'Caps the extracted article text, not the raw HTML length. HTML is kept only when it can be safely truncated.',
        '限制提取后的正文文本字符数，不是原始 HTML 长度；只有能安全截断时才保留 HTML。',
      ),
      min: 1_000,
      max: 5_000_000,
      step: 1_000,
      default: 200_000,
    },
    {
      kind: 'number',
      key: 'maxResponseBytes',
      label: lt('Maximum response bytes', '响应最大字节'),
      min: 1_024,
      max: 50_000_000,
      step: 1_024,
      default: 5_000_000,
    },
    {
      kind: 'number',
      key: 'maxBodyChars',
      label: lt('Maximum decoded characters', '解码最大字符'),
      min: 1_024,
      max: 20_000_000,
      step: 1_024,
      default: 2_000_000,
    },
    {
      kind: 'number',
      key: 'timeoutMs',
      label: lt('Timeout (ms)', '超时（ms）'),
      min: 1_000,
      max: 120_000,
      step: 500,
      default: 20_000,
    },
    {
      kind: 'number',
      key: 'maxRedirects',
      label: lt('Maximum redirects', '最大重定向'),
      min: 0,
      max: 10,
      step: 1,
      default: 5,
    },
    { kind: 'text', key: 'userAgent', label: lt('User-Agent', 'User-Agent') },
    {
      kind: 'boolean',
      key: 'failOpen',
      label: lt('Fall back to the raw page on failure', '提取失败时回退原文'),
      default: true,
    },
  ] satisfies readonly AdapterField[]).map((field): AdapterField => {
    const unit = field.key === 'minArticleChars' || field.key === 'maxArticleChars' || field.key === 'maxBodyChars'
      ? 'chars'
      : field.key === 'maxResponseBytes'
        ? 'bytes'
        : field.key === 'timeoutMs'
          ? 'ms'
          : undefined
    const group = field.key === 'enabled'
      || field.key === 'readability'
      || field.key === 'minArticleChars'
      || field.key === 'maxArticleChars'
      || field.key === 'failOpen'
      ? 'extraction'
      : 'limits'
    return { ...field, group, ...(unit === undefined ? {} : { unit }) }
  }),
}
