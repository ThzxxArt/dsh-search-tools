/** Conversation card for `web_research`; falls back to a compact row on bad meta. */

import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

interface ResearchMeta {
  query?: string
  sourceCount?: number
  sources?: Array<{ url?: string; title?: string; domain?: string }>
  fetched?: Array<{ url?: string; title?: string; chars?: number; error?: string }>
  truncated?: boolean
}

type ResearchCardProps = ToolCallViewProps & PropsLocale<'dsh-search-tools'>

export function ResearchCard(props: ResearchCardProps): React.ReactElement {
  const { t } = props
  const block = props.block as unknown as { args?: unknown; meta?: unknown }
  const args = typeof block.args === 'object' && block.args !== null ? block.args as { query?: unknown } : {}
  const meta = normalizeMeta(block.meta)
  const query = meta?.query ?? (typeof args.query === 'string' ? args.query : 'web research')
  const phase = props.phase

  if (phase !== 'result' || meta === undefined) {
    return (
      <div className="dshst-research-head">
        <StateDot state="ongoing" />
        <span>{query}</span>
        <Tag tone="outline">{t('researchCardSearchFetch')}</Tag>
      </div>
    )
  }

  const fetched = meta.fetched ?? []
  const failed = fetched.filter(page => page.error !== undefined).length
  const fetchedOk = fetched.length - failed
  return (
    <div>
      <div className="dshst-research-head">
        <StateDot state={failed > 0 ? 'warning' : 'done'} />
        <strong>{query}</strong>
        <Tag tone="outline">{t('researchCardSources', { n: meta.sourceCount ?? meta.sources?.length ?? 0 })}</Tag>
        <Tag tone="outline">{failed > 0
          ? t('researchCardFetchedPartial', { ok: fetchedOk, n: fetched.length })
          : t('researchCardFetched', { n: fetched.length })}</Tag>
        {meta.truncated === true ? <Tag tone="warning">{t('researchCardTruncated')}</Tag> : null}
        <Tag tone="quiet">{t('researchCardUntrusted')}</Tag>
      </div>
      {meta.sources !== undefined && meta.sources.length > 0 ? (
        <ul className="dshst-research-list">
          {meta.sources.map((source, index) => (
            <li key={`${source.url ?? source.title ?? 'source'}-${index}`}>
              {source.url === undefined
                ? source.title ?? source.domain
                : <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title ?? source.domain ?? source.url}</a>}
            </li>
          ))}
        </ul>
      ) : null}
      {meta.fetched !== undefined && meta.fetched.length > 0 ? (
        <details className="dshst-details">
          <summary>{t('researchCardDetails')}</summary>
          <ul className="dshst-research-list">
            {meta.fetched.map((page, index) => (
              <li key={`${page.url ?? 'page'}-${index}`}>
                {page.title ?? page.url} · {page.chars ?? 0} {t('researchCardChars')}
                {page.error === undefined ? null : <span className="dshst-error"> · {page.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function normalizeMeta(value: unknown): ResearchMeta | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const sources = Array.isArray(record.sources)
    ? record.sources.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return []
      const source = entry as Record<string, unknown>
      const url = httpUrl(source.url)
      const normalized = {
        ...(url === undefined ? {} : { url }),
        ...(typeof source.title === 'string' ? { title: source.title } : {}),
        ...(typeof source.domain === 'string' ? { domain: source.domain } : {}),
      }
      return Object.keys(normalized).length === 0 ? [] : [normalized]
    })
    : undefined
  const fetched = Array.isArray(record.fetched)
    ? record.fetched.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return []
      const page = entry as Record<string, unknown>
      const url = httpUrl(page.url)
      const normalized = {
        ...(url === undefined ? {} : { url }),
        ...(typeof page.title === 'string' ? { title: page.title } : {}),
        ...(typeof page.chars === 'number' ? { chars: page.chars } : {}),
        ...(typeof page.error === 'string' ? { error: page.error } : {}),
      }
      return Object.keys(normalized).length === 0 ? [] : [normalized]
    })
    : undefined
  return {
    ...(typeof record.query === 'string' ? { query: record.query } : {}),
    ...(typeof record.sourceCount === 'number' ? { sourceCount: record.sourceCount } : {}),
    ...(sources === undefined ? {} : { sources }),
    ...(fetched === undefined ? {} : { fetched }),
    ...(record.truncated === true ? { truncated: true } : {}),
  }
}
