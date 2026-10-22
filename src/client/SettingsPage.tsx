/** Settings → Search Tools page. The only editable surface for this plugin. */

import { useEffect, useSyncExternalStore, useState } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AdapterIssue, AdapterListResponse, AdapterManifest, JsonObject, JsonValue, StatusResponse,
} from '../core/types.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../shared/defaults.ts'
import { diffSections, type ConfigSection } from '../shared/diff.ts'
import { getPath, setPath } from '../shared/path.ts'
import { validateSearxngConfig } from '../search/adapters/searxng/schema.ts'
import { validateReadableHttpConfig } from '../fetch/adapters/readable-http/schema.ts'
import { clearCache, fetchAdapters, fetchStatus, previewFetch, previewSearch } from './api.ts'
import { Field, InstanceEditor } from './components/Field.tsx'

export interface WebSelection {
  searchProvider?: string
  fetchProvider?: string
}

export interface SettingsPageProps {
  form: ConfigForm<StoredConfig>
  web: ConfigForm<WebSelection>
  t: (key: string) => string
}

type Tab = 'overview' | 'search' | 'fetch' | 'research' | 'advanced'

const SEARCH_PROVIDER = 'dsh-search-tools'
const FETCH_PROVIDER = 'dsh-search-tools-fetch'

export function SettingsPage({ form, web, t }: SettingsPageProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  )
  const webSnapshot = useSyncExternalStore(
    listener => web.subscribe(listener),
    () => web.getSnapshot(),
    () => web.getSnapshot(),
  )
  const [draft, setDraft] = useState<StoredConfig>(() => normalize(snapshot.value))
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [message, setMessage] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<StatusResponse | undefined>()
  const [adapters, setAdapters] = useState<AdapterListResponse>({ search: [], fetch: [] })
  const [query, setQuery] = useState('DeepSeek Harness')
  const [fetchUrl, setFetchUrl] = useState('https://example.com')
  const [preview, setPreview] = useState<string | undefined>()
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetchStatus(controller.signal).then(setStatus).catch(() => {})
    void fetchAdapters(controller.signal).then(setAdapters).catch(() => {})
    return () => { controller.abort() }
  }, [])

  useEffect(() => {
    if (dirty || snapshot.status !== 'ready') return
    setDraft(normalize(snapshot.value))
  }, [dirty, snapshot.revision, snapshot.status])

  const errors = validateDraft(draft)
  const readOnly = snapshot.status !== 'ready' || snapshot.writable === false

  const edit = (next: StoredConfig): void => {
    setDraft(next)
    setDirty(true)
    setMessage(undefined)
  }

  const save = async (): Promise<void> => {
    if (errors.length > 0 || readOnly) return
    setSaving(true)
    setMessage(undefined)
    try {
      const current = normalize(snapshot.value)
      const base = normalize(snapshot.base as StoredConfig | undefined)
      const ops = diffSections(draft, current, base)
      if (ops.length === 0) {
        setDirty(false)
        setMessage(t('clean'))
        return
      }
      const ok = await form.mutate(ops as unknown as SettingsPathOpView[], snapshot.revision)
      if (!ok) {
        setMessage(t('conflict'))
        return
      }
      setDirty(false)
      setMessage(t('saved'))
      setStatus(await fetchStatus().catch(() => status))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const testSearch = async (): Promise<void> => {
    setTesting(true)
    setPreview(undefined)
    try {
      const adapter = draft.search.adapter
      const config = adapterConfig(draft.search, adapter)
      const result = await previewSearch(adapter, query, config)
      if (!result.ok) throw new Error(result.message ?? result.code ?? 'search failed')
      setPreview((result.sources ?? []).map((source, index) => `${index + 1}. ${source.title ?? source.url}\n   ${source.url}`).join('\n') || 'No results.')
    } catch (error) {
      setPreview(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  const testFetch = async (): Promise<void> => {
    setTesting(true)
    setPreview(undefined)
    try {
      const adapter = draft.fetch.adapter
      const config = adapterConfig(draft.fetch, adapter)
      const result = await previewFetch(adapter, fetchUrl, config)
      if (!result.ok) throw new Error(result.message ?? result.code ?? 'fetch failed')
      setPreview(`${result.url ?? fetchUrl} — HTTP ${result.statusCode ?? '?'} — ${result.chars ?? 0} chars\n\n${(result.content ?? '').slice(0, 4_000)}`)
    } catch (error) {
      setPreview(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  const currentSearch = webSnapshot.value?.searchProvider ?? ''
  const currentFetch = webSnapshot.value?.fetchProvider ?? ''

  const setProvider = async (kind: 'search' | 'fetch', enabled: boolean): Promise<void> => {
    if (webSnapshot.writable === false) return
    const key = kind === 'search' ? 'searchProvider' : 'fetchProvider'
    const target = kind === 'search' ? SEARCH_PROVIDER : FETCH_PROVIDER
    const value = enabled ? target : undefined
    const ok = await web.mutate(
      value === undefined ? [{ op: 'unset', path: [key] }] : [{ op: 'set', path: [key], value }],
      webSnapshot.revision,
    )
    if (!ok) setMessage(t('conflict'))
    else setMessage(t('saved'))
  }

  return (
    <div className="dshst-page">
      <header className="dshst-head">
        <div>
          <h2 className="dshst-title">{t('title')}</h2>
          <p className="dshst-sub">{t('subtitle')}</p>
        </div>
        <div className="dshst-status">
          <StateDot state={status?.search.available === true ? 'done' : status === undefined ? 'ongoing' : 'warning'} />
          <span>{status?.search.available === true ? 'SearXNG ready' : 'Not ready'}</span>
          <Tag tone={currentSearch === SEARCH_PROVIDER ? 'info' : 'outline'}>
            {currentSearch === SEARCH_PROVIDER ? '接管搜索' : 'DSH 默认'}
          </Tag>
        </div>
      </header>

      <nav className="dshst-tabs" aria-label={t('title')}>
        {(['overview', 'search', 'fetch', 'research', 'advanced'] as const).map(item => (
          <button
            key={item}
            type="button"
            className="dshst-tab"
            data-active={tab === item}
            onClick={() => { setTab(item) }}
          >
            {t(item)}
          </button>
        ))}
      </nav>

      {snapshot.status === 'loading' ? <div className="dshst-notice">{t('loading')}</div> : null}
      {snapshot.status === 'unavailable' ? <div className="dshst-notice">{t('unavailable')}</div> : null}
      {snapshot.status === 'ready' && snapshot.writable === false ? <div className="dshst-notice">{t('readOnly')}</div> : null}
      {errors.length > 0 ? <div className="dshst-notice">{t('invalid')}<ul className="dshst-research-list">{errors.slice(0, 8).map(error => <li key={`${error.path}:${error.message}`}>{error.path}: {error.message}</li>)}</ul></div> : null}

      {tab === 'overview' ? (
        <Overview
          t={t}
          status={status}
          currentSearch={currentSearch}
          currentFetch={currentFetch}
          query={query}
          setQuery={setQuery}
          fetchUrl={fetchUrl}
          setFetchUrl={setFetchUrl}
          testing={testing}
          preview={preview}
          testSearch={testSearch}
          testFetch={testFetch}
          setProvider={setProvider}
        />
      ) : null}

      {tab === 'search' ? (
        <section className="dshst-card">
          <div>
            <div className="dshst-card-title">{t('search')}</div>
            <p className="dshst-card-desc">选择后端并配置实例。新增后端只需注册 adapter，页面不改。</p>
          </div>
          <AdapterPicker
            manifests={adapters.search}
            value={draft.search.adapter}
            onChange={(id) => edit({
              ...draft,
              search: {
                adapter: id,
                adapters: {
                  ...draft.search.adapters,
                  [id]: draft.search.adapters[id] ?? (findManifest(adapters.search, id)?.defaults as JsonObject | undefined) ?? {},
                },
              },
            })}
          />
          <AdapterForm
            manifest={findManifest(adapters.search, draft.search.adapter)}
            config={adapterConfig(draft.search, draft.search.adapter)}
            errors={errors}
            disabled={readOnly}
            onChange={(config) => edit({
              ...draft,
              search: { ...draft.search, adapters: { ...draft.search.adapters, [draft.search.adapter]: config } },
            })}
          />
        </section>
      ) : null}

      {tab === 'fetch' ? (
        <section className="dshst-card">
          <div>
            <div className="dshst-card-title">{t('fetch')}</div>
            <p className="dshst-card-desc">抓取仍复用 DSH 的安全 HTTP 层；Readability 只做正文提取。</p>
          </div>
          <AdapterPicker
            manifests={adapters.fetch}
            value={draft.fetch.adapter}
            onChange={(id) => edit({
              ...draft,
              fetch: {
                adapter: id,
                adapters: {
                  ...draft.fetch.adapters,
                  [id]: draft.fetch.adapters[id] ?? (findManifest(adapters.fetch, id)?.defaults as JsonObject | undefined) ?? {},
                },
              },
            })}
          />
          <AdapterForm
            manifest={findManifest(adapters.fetch, draft.fetch.adapter)}
            config={adapterConfig(draft.fetch, draft.fetch.adapter)}
            errors={errors}
            disabled={readOnly}
            onChange={(config) => edit({
              ...draft,
              fetch: { ...draft.fetch, adapters: { ...draft.fetch.adapters, [draft.fetch.adapter]: config } },
            })}
          />
        </section>
      ) : null}

      {tab === 'research' ? (
        <section className="dshst-card">
          <div>
            <div className="dshst-card-title">{t('research')}</div>
            <p className="dshst-card-desc">{t('researchHint')}</p>
          </div>
          <BooleanRow label="启用 web_research" checked={draft.research.enabled} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, enabled: value } })} />
          <NumberRow label="默认结果数" value={draft.research.maxResults} min={1} max={20} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxResults: value } })} />
          <NumberRow label="默认抓取条数" value={draft.research.defaultFetchTop} min={0} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, defaultFetchTop: value } })} />
          <NumberRow label="单页字符上限" value={draft.research.maxCharsPerPage} min={1000} max={200000} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxCharsPerPage: value } })} />
          <NumberRow label="总字符上限" value={draft.research.maxTotalChars} min={1000} max={500000} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxTotalChars: value } })} />
          <NumberRow label="并发数" value={draft.research.concurrency} min={1} max={8} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, concurrency: value } })} />
        </section>
      ) : null}

      {tab === 'advanced' ? (
        <section className="dshst-card">
          <div>
            <div className="dshst-card-title">{t('advanced')}</div>
            <p className="dshst-card-desc">{t('configPathHint')}</p>
          </div>
          <div className="dshst-row"><label>{t('configPath')}</label><code>{status?.configPath ?? '—'}</code></div>
          <div className="dshst-row"><label>{t('cache')}</label><div className="dshst-actions"><Tag>{status?.cache.size ?? 0} 条</Tag><Button size="sm" variant="outline" onClick={() => { void clearCache().then(() => fetchStatus()).then(setStatus) }}>{t('clearCache')}</Button></div></div>
          <div className="dshst-row"><label>{t('lastErrors')}</label><div>{status?.lastErrors.length ? status.lastErrors.map(error => <p key={`${error.time}:${error.code}`} className="dshst-hint">{error.time} · {error.code} · {error.message}</p>) : <p className="dshst-hint">{t('noErrors')}</p>}</div></div>
        </section>
      ) : null}

      <footer className="dshst-save">
        <span className="dshst-hint">{dirty ? t('dirty') : message ?? t('clean')}</span>
        <div className="dshst-actions">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setDraft(normalize(snapshot.value)); setDirty(false); setMessage(undefined) }}>{t('discard')}</Button>
          <Button variant="primary" disabled={!dirty || saving || errors.length > 0 || readOnly} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</Button>
        </div>
      </footer>
    </div>
  )
}

function Overview({ t, status, currentSearch, currentFetch, query, setQuery, fetchUrl, setFetchUrl, testing, preview, testSearch, testFetch, setProvider }: {
  t: (key: string) => string
  status: StatusResponse | undefined
  currentSearch: string
  currentFetch: string
  query: string
  setQuery: (value: string) => void
  fetchUrl: string
  setFetchUrl: (value: string) => void
  testing: boolean
  preview: string | undefined
  testSearch: () => Promise<void>
  testFetch: () => Promise<void>
  setProvider: (kind: 'search' | 'fetch', enabled: boolean) => Promise<void>
}): React.ReactElement {
  return (
    <div className="dshst-grid2">
      <section className="dshst-card">
        <div className="dshst-card-title">{t('takeover')}</div>
        <p className="dshst-card-desc">{t('takeoverHint')}</p>
        <div className="dshst-row"><label>{t('currentProvider')}</label><code>{currentSearch === SEARCH_PROVIDER ? 'dsh-search-tools' : t('defaultProvider')}</code></div>
        <div className="dshst-actions">
          <Button size="sm" variant={currentSearch === SEARCH_PROVIDER ? 'outline' : 'primary'} onClick={() => { void setProvider('search', currentSearch !== SEARCH_PROVIDER) }}>{currentSearch === SEARCH_PROVIDER ? t('restore') : t('takeover')}</Button>
          <Tag tone="outline">fetch: {currentFetch === FETCH_PROVIDER ? 'dsh-search-tools-fetch' : t('defaultProvider')}</Tag>
        </div>
        <div className="dshst-details"><summary>{t('status')}</summary><p className="dshst-hint">{status?.search.available ? 'SearXNG available' : 'SearXNG not available'} · {status?.search.instances ?? 0} instances · cache {status?.cache.size ?? 0}</p></div>
      </section>
      <section className="dshst-card">
        <div className="dshst-card-title">{t('quickSearch')}</div>
        <div className="dshst-actions"><Input value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('query')} /><Button size="sm" variant="outline" disabled={testing} onClick={() => { void testSearch() }}>{testing ? t('testing') : t('test')}</Button></div>
        <div className="dshst-card-title" style={{ marginTop: 8 }}>{t('quickFetch')}</div>
        <div className="dshst-actions"><Input value={fetchUrl} onChange={event => { setFetchUrl(event.target.value) }} placeholder={t('url')} /><Button size="sm" variant="outline" disabled={testing} onClick={() => { void testFetch() }}>{testing ? t('testing') : t('test')}</Button></div>
      </section>
      {preview === undefined ? null : <section className="dshst-card" style={{ gridColumn: '1 / -1' }}><div className="dshst-card-title">Preview</div><pre className="dshst-pre">{preview}</pre></section>}
    </div>
  )
}

function AdapterPicker({ manifests, value, onChange }: {
  manifests: readonly AdapterManifest[]
  value: string
  onChange: (id: string) => void
}): React.ReactElement {
  return (
    <div className="dshst-row">
      <label htmlFor="dshst-adapter">后端</label>
      <div>
        <select id="dshst-adapter" value={value} onChange={event => { onChange(event.target.value) }}>
          {manifests.length === 0 ? <option value={value}>{value}</option> : null}
          {manifests.map(manifest => <option key={manifest.id} value={manifest.id}>{manifest.label}</option>)}
        </select>
        <p className="dshst-hint">新增后端注册 adapter 即可；核心 provider id 不变。</p>
      </div>
    </div>
  )
}

function AdapterForm({ manifest, config, errors, disabled, onChange }: {
  manifest: AdapterManifest | undefined
  config: JsonObject
  errors: readonly AdapterIssue[]
  disabled: boolean
  onChange: (config: JsonObject) => void
}): React.ReactElement | null {
  if (manifest === undefined) return null
  return (
    <div>
      {manifest.fields.map(field => {
        const error = errors.find(issue => issue.path === field.key)?.message
        if (field.kind === 'instances') {
          return (
            <div className="dshst-row" key={field.key}>
              <label>{field.label}</label>
              <div>
                <InstanceEditor
                  value={getPath(config, field.key)}
                  disabled={disabled}
                  onChange={(instances) => onChange(setPath(config, field.key, instances as unknown as JsonValue))}
                />
                {field.description === undefined ? null : <p className="dshst-hint">{field.description}</p>}
                {error === undefined ? null : <p className="dshst-error">{error}</p>}
              </div>
            </div>
          )
        }
        return (
          <Field
            key={field.key}
            field={field}
            value={getPath(config, field.key)}
            disabled={disabled}
            error={error}
            onChange={(value) => onChange(setPath(config, field.key, value))}
          />
        )
      })}
    </div>
  )
}

function BooleanRow({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): React.ReactElement {
  return (
    <div className="dshst-row"><label>{label}</label><div><Button size="sm" variant={checked ? 'primary' : 'outline'} onClick={() => { onChange(!checked) }} disabled={disabled}>{checked ? '开' : '关'}</Button></div></div>
  )
}

function NumberRow({ label, value, min, max, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}): React.ReactElement {
  return (
    <div className="dshst-row"><label>{label}</label><div><Input type="number" min={min} max={max} value={String(value)} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next)))) }} /></div></div>
  )
}

function normalize(value: StoredConfig | undefined): StoredConfig {
  const source = value ?? DEFAULT_STORED_CONFIG
  return {
    search: {
      ...DEFAULT_STORED_CONFIG.search,
      ...source.search,
      adapters: { ...DEFAULT_STORED_CONFIG.search.adapters, ...source.search?.adapters },
    },
    fetch: {
      ...DEFAULT_STORED_CONFIG.fetch,
      ...source.fetch,
      adapters: { ...DEFAULT_STORED_CONFIG.fetch.adapters, ...source.fetch?.adapters },
    },
    research: { ...DEFAULT_STORED_CONFIG.research, ...source.research },
    activation: { ...DEFAULT_STORED_CONFIG.activation, ...source.activation },
  }
}

function adapterConfig(section: { adapter: string; adapters: Record<string, JsonObject> }, id: string): JsonObject {
  return section.adapters[id] ?? {}
}

function findManifest(list: readonly AdapterManifest[], id: string): AdapterManifest | undefined {
  return list.find(manifest => manifest.id === id)
}

function validateDraft(draft: StoredConfig): AdapterIssue[] {
  const issues: AdapterIssue[] = []
  const searxng = validateSearxngConfig(draft.search.adapters.searxng ?? {})
  if (draft.search.adapter === 'searxng') issues.push(...searxng.issues)
  const readable = validateReadableHttpConfig(draft.fetch.adapters['readable-http'] ?? {})
  if (draft.fetch.adapter === 'readable-http') issues.push(...readable.issues)
  if (draft.research.defaultFetchTop > draft.research.maxFetch) issues.push({ path: 'research.defaultFetchTop', message: '默认抓取条数不能大于最大抓取条数' })
  if (draft.research.maxTotalChars < draft.research.maxCharsPerPage) issues.push({ path: 'research.maxTotalChars', message: '总字符上限不能小于单页上限' })
  return issues
}

/** Keep the section type available to future tab implementations. */
export type { ConfigSection }
