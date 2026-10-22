/** Settings → Search Tools page. The only editable surface for this plugin. */

import { useEffect, useId, useSyncExternalStore, useState } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AdapterIssue, AdapterListResponse, AdapterManifest, JsonObject, JsonValue, LocalizedText, StatusResponse,
} from '../core/types.ts'
import { DEFAULT_STORED_CONFIG, type ActivationConfig, type ResearchConfig, type StoredConfig } from '../shared/defaults.ts'
import { diffSections, type ConfigSection } from '../shared/diff.ts'
import { getPath, setPath } from '../shared/path.ts'
import { isRecord, validateManifestConfig } from '../shared/validation.ts'
import { validateSearxngConfig } from '../search/adapters/searxng/schema.ts'
import { validateReadableHttpConfig } from '../fetch/adapters/readable-http/schema.ts'
import {
  clearCache, clearDiagnostics as clearDiagnosticsRequest, fetchAdapters, fetchStatus, previewFetch, previewSearch, probeSearch,
} from './api.ts'
import { formatDiagnostics } from './diagnostic-text.ts'
import { issueText } from './issue-text.ts'
import { buildResearchPromptPreview } from '../research/prompt.ts'
import { Field, InstanceEditor, type InstanceTestResult, type InstanceValue, type Translate } from './components/Field.tsx'

export interface WebSelection {
  searchProvider?: string
  fetchProvider?: string
}

/** One credential reference's UI-safe status; values never cross this face. */
export interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

/** The credential operations the page drives; values cross only on write. */
export interface CredentialsFace {
  describe(refs: string[]): Promise<{ ok: boolean; value?: Record<string, CredentialInfo> }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

/** The slice of `ctx.locale` the page consumes; kept structural for tests. */
export interface LocaleFace {
  resolveText(value: LocalizedText): string
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

export interface SettingsPageProps {
  form: ConfigForm<StoredConfig>
  web: ConfigForm<WebSelection>
  credentials: CredentialsFace
  t: Translate
  locale: LocaleFace
}

type Tab = 'overview' | 'search' | 'fetch' | 'research' | 'advanced'
type Testing = 'search' | 'fetch' | undefined

const TABS: readonly Tab[] = ['overview', 'search', 'fetch', 'research', 'advanced']

/** Structured result of an adapter test, rendered in place instead of a raw text blob. */
export interface PreviewState {
  kind: 'search' | 'fetch'
  ok: boolean
  elapsedMs?: number
  sources?: Array<{ url: string; title?: string; snippet?: string }>
  notes?: string[]
  url?: string
  statusCode?: number
  bodyKind?: 'html' | 'text'
  content?: string
  chars?: number
  truncated?: boolean
  message?: string
}

export const SEARCH_PROVIDER = 'dsh-search-tools'
export const FETCH_PROVIDER = 'dsh-search-tools-fetch'

export function SettingsPage({ form, web, credentials, t, locale }: SettingsPageProps): React.ReactElement {
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
  // Re-render on locale changes so manifests and page copy follow the active UI language.
  useSyncExternalStore(
    listener => locale.subscribe(listener),
    () => locale.getSnapshot(),
    () => locale.getSnapshot(),
  )
  const text = (value: LocalizedText): string => locale.resolveText(value)

  const [draft, setDraft] = useState<StoredConfig>(() => normalize(snapshot.value))
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [message, setMessage] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<StatusResponse | undefined>()
  const [adapters, setAdapters] = useState<AdapterListResponse>({ search: [], fetch: [] })
  const [query, setQuery] = useState('DeepSeek Harness')
  const [fetchUrl, setFetchUrl] = useState('https://example.com')
  const [preview, setPreview] = useState<PreviewState | undefined>()
  const [testing, setTesting] = useState<Testing>()
  const [credentialInfo, setCredentialInfo] = useState<Record<string, CredentialInfo>>({})
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [secretBusy, setSecretBusy] = useState<string>()
  const [instanceTesting, setInstanceTesting] = useState<string>()
  const [instanceResults, setInstanceResults] = useState<Record<string, InstanceTestResult>>({})
  const [refreshingAdapters, setRefreshingAdapters] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetchStatus(controller.signal).then(setStatus).catch(() => {})
    void fetchAdapters(controller.signal).then(setAdapters).catch(() => {})
    return () => { controller.abort() }
  }, [])

  useEffect(() => {
    const refs = [...new Set([...adapters.search, ...adapters.fetch]
      .flatMap(manifest => (manifest.secretRefs ?? []).map(secret => secret.ref)))]
    if (refs.length === 0) return
    let cancelled = false
    void credentials.describe(refs)
      .then((response) => {
        if (!cancelled && response.ok && response.value !== undefined) {
          setCredentialInfo(previous => ({ ...previous, ...response.value }))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [adapters, credentials])

  useEffect(() => {
    if (dirty || snapshot.status !== 'ready') return
    setDraft(normalize(snapshot.value))
  }, [dirty, snapshot.revision, snapshot.status])

  const readOnly = snapshot.status !== 'ready' || snapshot.writable === false
  const currentSearch = webSnapshot.value?.searchProvider ?? ''
  const currentFetch = webSnapshot.value?.fetchProvider ?? ''
  const searchIssues = validateSearchDraft(draft, adapters)
  const fetchIssues = validateFetchDraft(draft, adapters)
  const researchIssues = validateResearchDraft(draft, t)
  const activeSearchManifest = findManifest(adapters.search, draft.search.adapter)
  const activeInstancesField = activeSearchManifest?.fields.find(field => field.kind === 'instances')
  // Only adapters that actually model instances need the non-empty rule. The
  // takeover test remains the authority for adapters configured some other way.
  if (currentSearch === SEARCH_PROVIDER
    && activeInstancesField !== undefined
    && !hasEnabledInstances(getPath(adapterConfig(draft.search, draft.search.adapter), activeInstancesField.key))) {
    searchIssues.push({ path: 'instances', message: t('instancesRequiredWhenActive') })
  }
  const errors = [...searchIssues, ...fetchIssues, ...researchIssues]

  const edit = (next: StoredConfig): void => {
    setDraft(next)
    setDirty(true)
    setMessage(undefined)
  }

  const refreshStatus = async (): Promise<void> => {
    try {
      setStatus(await fetchStatus())
    } catch {
      // Keep the previous status; actions already surface their own errors.
    }
  }

  const refreshAdapters = async (): Promise<void> => {
    setRefreshingAdapters(true)
    try {
      setAdapters(await fetchAdapters())
      setMessage(t('adaptersRefreshed'))
    } catch (error) {
      setMessage(`${t('adaptersRefreshFailed')}: ${errorText(error)}`)
    } finally {
      setRefreshingAdapters(false)
    }
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
      setPreview(undefined)
      await refreshStatus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!dirty || saving || readOnly || errors.length > 0) return
      event.preventDefault()
      void save()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [dirty, saving, readOnly, errors.length, save])

  const copyDiagnostics = async (): Promise<void> => {
    if (status === undefined) return
    try {
      await navigator.clipboard.writeText(formatDiagnostics(status))
      setMessage(t('copied'))
    } catch (error) {
      setMessage(`${t('copyFailed')}: ${errorText(error)}`)
    }
  }

  const clearDiagnosticEntries = async (): Promise<void> => {
    try {
      await clearDiagnosticsRequest()
      await refreshStatus()
      setMessage(t('cleared'))
    } catch (error) {
      setMessage(errorText(error))
    }
  }

  const saveSecret = async (ref: string): Promise<void> => {
    const value = secretDrafts[ref] ?? ''
    if (value.length === 0) return
    setSecretBusy(ref)
    try {
      await credentials.set(ref, value)
      setSecretDrafts(previous => ({ ...previous, [ref]: '' }))
      try {
        const response = await credentials.describe([ref])
        if (response.ok && response.value !== undefined) {
          setCredentialInfo(previous => ({ ...previous, ...response.value }))
        }
      } catch {
        // The write succeeded; a failed status refresh must not claim otherwise.
      }
      setMessage(t('saved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSecretBusy(undefined)
    }
  }

  const clearSecret = async (ref: string): Promise<void> => {
    setSecretBusy(ref)
    try {
      await credentials.unset(ref)
      try {
        const response = await credentials.describe([ref])
        if (response.ok && response.value !== undefined) {
          setCredentialInfo(previous => ({ ...previous, ...response.value }))
        }
      } catch {
        setCredentialInfo(previous => ({ ...previous, [ref]: { configured: false, writable: true } }))
      }
      setMessage(t('saved'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSecretBusy(undefined)
    }
  }

  const testInstance = async (instance: InstanceValue): Promise<void> => {
    const url = instance.url.trim()
    if (url.length === 0) return
    setInstanceTesting(url)
    try {
      const adapter = draft.search.adapter
      const config = { ...adapterConfig(draft.search, adapter), instances: [instance] as unknown as JsonValue }
      const result = await probeSearch(adapter, config)
      setInstanceResults(previous => ({
        ...previous,
        [url]: {
          ok: result.ok,
          latencyMs: result.latencyMs,
          ...(result.ok ? {} : { message: result.message ?? result.code ?? t('instanceTestFail') }),
        },
      }))
    } catch (error) {
      setInstanceResults(previous => ({
        ...previous,
        [url]: { ok: false, message: error instanceof Error ? error.message : String(error) },
      }))
    } finally {
      setInstanceTesting(undefined)
    }
  }

  const runSearchTest = async (): Promise<boolean> => {
    if (searchIssues.length > 0) {
      setPreview({ kind: 'search', ok: false, message: t('fixErrorsFirst') })
      return false
    }
    setTesting('search')
    setPreview(undefined)
    try {
      const adapter = draft.search.adapter
      const config = adapterConfig(draft.search, adapter)
      const result = await previewSearch(adapter, query, config)
      if (!result.ok) {
        setPreview({
          kind: 'search',
          ok: false,
          message: result.message ?? result.code ?? t('testFail'),
          ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
        })
        return false
      }
      setPreview({
        kind: 'search',
        ok: true,
        sources: (result.sources ?? []).filter(source => isHttpUrl(source.url)),
        ...(result.notes === undefined ? {} : { notes: result.notes.filter(note => note.length > 0).slice(0, 8) }),
        ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
      })
      return true
    } catch (error) {
      setPreview({ kind: 'search', ok: false, message: errorText(error) })
      return false
    } finally {
      setTesting(undefined)
    }
  }

  const runFetchTest = async (): Promise<boolean> => {
    if (fetchIssues.length > 0) {
      setPreview({ kind: 'fetch', ok: false, message: t('fixErrorsFirst') })
      return false
    }
    setTesting('fetch')
    setPreview(undefined)
    try {
      const adapter = draft.fetch.adapter
      const config = adapterConfig(draft.fetch, adapter)
      const result = await previewFetch(adapter, fetchUrl, config)
      if (!result.ok) {
        setPreview({
          kind: 'fetch',
          ok: false,
          message: result.message ?? result.code ?? t('testFail'),
          ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
        })
        return false
      }
      setPreview({
        kind: 'fetch',
        ok: true,
        url: result.url ?? fetchUrl,
        ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
        ...(result.kind === undefined ? {} : { bodyKind: result.kind }),
        content: (result.content ?? '').slice(0, 4_000),
        ...(result.chars === undefined ? {} : { chars: result.chars }),
        ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
        ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
      })
      return true
    } catch (error) {
      setPreview({ kind: 'fetch', ok: false, message: errorText(error) })
      return false
    } finally {
      setTesting(undefined)
    }
  }

  const setProvider = async (kind: 'search' | 'fetch', enabled: boolean): Promise<void> => {
    if (webSnapshot.writable === false) {
      setMessage(t('readOnly'))
      return
    }
    if (enabled && dirty) {
      setMessage(t('takeoverNeedsSave'))
      return
    }
    const target = kind === 'search' ? SEARCH_PROVIDER : FETCH_PROVIDER
    const current = kind === 'search' ? currentSearch : currentFetch
    if (enabled === (current === target)) return

    if (enabled && kind === 'search') {
      const passed = await runSearchTest()
      if (!passed) {
        setMessage(t('takeoverTestFailed'))
        return
      }
    }

    const activation = normalize(snapshot.value).activation
    if (enabled) {
      const previousKey: keyof ActivationConfig = kind === 'search' ? 'previousSearchProvider' : 'previousFetchProvider'
      const stored = await form.mutate([{
        op: 'set',
        path: ['activation'],
        value: { ...activation, [previousKey]: current } as unknown as JsonValue,
      }], snapshot.revision)
      if (!stored) {
        setMessage(t('conflict'))
        return
      }
    }

    const previous = kind === 'search' ? activation.previousSearchProvider : activation.previousFetchProvider
    const value = enabled ? target : previous
    const key = kind === 'search' ? 'searchProvider' : 'fetchProvider'
    const ok = await web.mutate(
      value.length === 0
        ? [{ op: 'unset', path: [key] }]
        : [{ op: 'set', path: [key], value }],
      webSnapshot.revision,
    )
    if (!ok) setMessage(t('conflict'))
    else {
      setMessage(t('saved'))
      await refreshStatus()
    }
  }

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: Tab): void => {
    const index = TABS.indexOf(item)
    let next: Tab | undefined
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length]
    else if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length]
    else if (event.key === 'Home') next = TABS[0]
    else if (event.key === 'End') next = TABS[TABS.length - 1]
    if (next === undefined) return
    event.preventDefault()
    setTab(next)
    document.getElementById(`dshst-tab-${next}`)?.focus()
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
          <span>{status?.search.available === true ? t('configured') : status === undefined ? t('loading') : t('notConfigured')}</span>
          <Tag tone={currentSearch === SEARCH_PROVIDER ? 'info' : 'outline'}>
            {currentSearch === SEARCH_PROVIDER ? t('searchTakeoverTag') : t('defaultProvider')}
          </Tag>
        </div>
      </header>

      <nav className="dshst-tabs" role="tablist" aria-label={t('title')}>
        {TABS.map(item => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`dshst-tab-${item}`}
            aria-selected={tab === item}
            aria-controls={`dshst-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
            className="dshst-tab"
            data-active={tab === item}
            onClick={() => { setTab(item) }}
            onKeyDown={event => { onTabKeyDown(event, item) }}
          >
            {t(item)}
          </button>
        ))}
      </nav>

      {snapshot.status === 'loading' ? <div className="dshst-notice">{t('loading')}</div> : null}
      {snapshot.status === 'unavailable' ? <div className="dshst-notice">{t('unavailable')}</div> : null}
      {snapshot.status === 'ready' && snapshot.writable === false ? <div className="dshst-notice">{t('readOnly')}</div> : null}
      {errors.length > 0 ? <div className="dshst-notice" role="status">{t('invalid')}<ul className="dshst-research-list">{errors.slice(0, 8).map(error => <li key={`${error.path}:${error.code ?? error.message}`}>{error.path}: {issueText(error, t)}</li>)}</ul></div> : null}

      {tab === 'overview' ? (
        <div role="tabpanel" id="dshst-panel-overview" aria-labelledby="dshst-tab-overview">
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
            testSearch={runSearchTest}
            testFetch={runFetchTest}
            setProvider={setProvider}
            onOpenSearch={() => { setTab('search') }}
          />
        </div>
      ) : null}

      {tab === 'search' ? (
        <div role="tabpanel" id="dshst-panel-search" aria-labelledby="dshst-tab-search">
          <section className="dshst-card">
            <div>
              <div className="dshst-card-title">{t('search')}</div>
              <p className="dshst-card-desc">{t('searchTabHint')}</p>
            </div>
            <AdapterPicker
              manifests={adapters.search}
              value={draft.search.adapter}
              configs={draft.search.adapters}
              refreshing={refreshingAdapters}
              text={text}
              t={t}
              onRefresh={() => { void refreshAdapters() }}
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
              errors={searchIssues}
              disabled={readOnly}
              text={text}
              t={t}
              onTestInstance={(instance) => { void testInstance(instance) }}
              testingInstanceUrl={instanceTesting}
              instanceResults={instanceResults}
              onChange={(config) => edit({
                ...draft,
                search: { ...draft.search, adapters: { ...draft.search.adapters, [draft.search.adapter]: config } },
              })}
            />
            <SecretFields
              manifest={findManifest(adapters.search, draft.search.adapter)}
              config={adapterConfig(draft.search, draft.search.adapter)}
              info={credentialInfo}
              drafts={secretDrafts}
              busy={secretBusy}
              text={text}
              t={t}
              onDraft={(ref, value) => setSecretDrafts(previous => ({ ...previous, [ref]: value }))}
              onSave={(ref) => { void saveSecret(ref) }}
              onClear={(ref) => { void clearSecret(ref) }}
            />
          </section>
          <section className="dshst-card">
            <div>
              <div className="dshst-card-title">{t('quickSearch')}</div>
              <p className="dshst-card-desc">{t('testSearchHint')}</p>
            </div>
            <div className="dshst-actions">
              <Input aria-label={t('query')} value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('query')} />
              <Button size="sm" variant="outline" disabled={testing !== undefined} onClick={() => { void runSearchTest() }}>{testing === 'search' ? t('testing') : t('test')}</Button>
            </div>
          </section>
          <PreviewPanel preview={preview?.kind === 'search' ? preview : undefined} t={t} />
        </div>
      ) : null}

      {tab === 'fetch' ? (
        <div role="tabpanel" id="dshst-panel-fetch" aria-labelledby="dshst-tab-fetch">
          <section className="dshst-card">
            <div>
              <div className="dshst-card-title">{t('fetch')}</div>
              <p className="dshst-card-desc">{t('fetchTabHint')}</p>
            </div>
            <AdapterPicker
              manifests={adapters.fetch}
              value={draft.fetch.adapter}
              configs={draft.fetch.adapters}
              refreshing={refreshingAdapters}
              text={text}
              t={t}
              onRefresh={() => { void refreshAdapters() }}
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
              errors={fetchIssues}
              disabled={readOnly}
              text={text}
              t={t}
              onChange={(config) => edit({
                ...draft,
                fetch: { ...draft.fetch, adapters: { ...draft.fetch.adapters, [draft.fetch.adapter]: config } },
              })}
            />
            <SecretFields
              manifest={findManifest(adapters.fetch, draft.fetch.adapter)}
              config={adapterConfig(draft.fetch, draft.fetch.adapter)}
              info={credentialInfo}
              drafts={secretDrafts}
              busy={secretBusy}
              text={text}
              t={t}
              onDraft={(ref, value) => setSecretDrafts(previous => ({ ...previous, [ref]: value }))}
              onSave={(ref) => { void saveSecret(ref) }}
              onClear={(ref) => { void clearSecret(ref) }}
            />
          </section>
          <section className="dshst-card">
            <div>
              <div className="dshst-card-title">{t('quickFetch')}</div>
              <p className="dshst-card-desc">{t('testFetchHint')}</p>
            </div>
            <div className="dshst-actions">
              <Input aria-label={t('url')} value={fetchUrl} onChange={event => { setFetchUrl(event.target.value) }} placeholder={t('url')} />
              <Button size="sm" variant="outline" disabled={testing !== undefined} onClick={() => { void runFetchTest() }}>{testing === 'fetch' ? t('testing') : t('test')}</Button>
            </div>
          </section>
          <PreviewPanel preview={preview?.kind === 'fetch' ? preview : undefined} t={t} />
        </div>
      ) : null}

      {tab === 'research' ? (
        <div role="tabpanel" id="dshst-panel-research" aria-labelledby="dshst-tab-research">
          <section className="dshst-card">
            <div>
              <div className="dshst-card-title">{t('research')}</div>
              <p className="dshst-card-desc">{t('researchHint')}</p>
            </div>
            <BooleanRow label={t('researchEnabled')} checked={draft.research.enabled} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, enabled: value } })} />
            <NumberRow label={t('researchMaxResults')} value={draft.research.maxResults} min={1} max={20} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxResults: value } })} />
            <NumberRow label={t('researchMaxFetch')} value={draft.research.maxFetch} min={1} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxFetch: value } })} />
            <NumberRow label={t('researchDefaultFetchTop')} value={draft.research.defaultFetchTop} min={0} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, defaultFetchTop: value } })} />
            <NumberRow label={t('researchMaxCharsPerPage')} value={draft.research.maxCharsPerPage} min={1000} max={200000} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxCharsPerPage: value } })} />
            <NumberRow label={t('researchMaxTotalChars')} value={draft.research.maxTotalChars} min={1000} max={500000} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxTotalChars: value } })} />
            <NumberRow label={t('researchConcurrency')} value={draft.research.concurrency} min={1} max={8} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, concurrency: value } })} />
            <NumberRow label={t('researchTimeout')} value={draft.research.timeoutMs} min={5000} max={600000} step={1000} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, timeoutMs: value } })} />
          </section>
          <ResearchPrompt research={draft.research} t={t} />
        </div>
      ) : null}

      {tab === 'advanced' ? (
        <div role="tabpanel" id="dshst-panel-advanced" aria-labelledby="dshst-tab-advanced">
          <section className="dshst-card">
            <div>
              <div className="dshst-card-title">{t('advanced')}</div>
              <p className="dshst-card-desc">{t('configPathHint')}</p>
            </div>
            <div className="dshst-row"><label>{t('version')}</label><code>{status?.version ?? '—'}</code></div>
            <div className="dshst-row"><label>{t('configPath')}</label><code>{status?.configPath ?? '—'}</code></div>
            <div className="dshst-row"><label>{t('cache')}</label><div className="dshst-actions"><Tag>{t('entries', { n: status?.cache.size ?? 0 })}</Tag><Button size="sm" variant="outline" onClick={() => { void clearCache().then(() => fetchStatus()).then(setStatus) }}>{t('clearCache')}</Button></div></div>
            <div className="dshst-row">
              <label>{t('lastErrors')}</label>
              <div>
                {status?.lastErrors.length ? (
                  <ul className="dshst-research-list">
                    {status.lastErrors.map(error => (
                      <li key={`${error.time}:${error.code}`}>
                        {error.time} · {error.code}{error.host === undefined ? '' : ` · ${error.host}`} · {error.message}
                      </li>
                    ))}
                  </ul>
                ) : <p className="dshst-hint">{t('noErrors')}</p>}
                <div className="dshst-actions">
                  <Button size="sm" variant="outline" disabled={status === undefined} onClick={() => { void copyDiagnostics() }}>{t('copyDiagnostics')}</Button>
                  <Button size="sm" variant="ghost" disabled={status?.lastErrors.length === 0} onClick={() => { void clearDiagnosticEntries() }}>{t('clearErrors')}</Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="dshst-save">
        <span className="dshst-hint" role="status" aria-live="polite">
          {dirty ? `${t('dirty')}${message === undefined ? '' : ` · ${message}`}` : message ?? t('clean')}
        </span>
        <div className="dshst-actions">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setDraft(normalize(snapshot.value)); setDirty(false); setMessage(undefined) }}>{t('discard')}</Button>
          <Button variant="primary" disabled={!dirty || saving || errors.length > 0 || readOnly} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</Button>
        </div>
      </footer>
    </div>
  )
}

function Overview({ t, status, currentSearch, currentFetch, query, setQuery, fetchUrl, setFetchUrl, testing, preview, testSearch, testFetch, setProvider, onOpenSearch }: {
  t: Translate
  status: StatusResponse | undefined
  currentSearch: string
  currentFetch: string
  query: string
  setQuery: (value: string) => void
  fetchUrl: string
  setFetchUrl: (value: string) => void
  testing: Testing
  preview: PreviewState | undefined
  testSearch: () => Promise<boolean>
  testFetch: () => Promise<boolean>
  setProvider: (kind: 'search' | 'fetch', enabled: boolean) => Promise<void>
  onOpenSearch: () => void
}): React.ReactElement {
  return (
    <div className="dshst-grid2">
      {status !== undefined && status.search.instances === 0 ? (
        <section className="dshst-card" style={{ gridColumn: '1 / -1' }}>
          <div className="dshst-card-title">{t('emptyTitle')}</div>
          <p className="dshst-card-desc">{t('emptyHint')}</p>
          <div className="dshst-actions">
            <Button size="sm" variant="primary" onClick={onOpenSearch}>{t('emptyAction')}</Button>
          </div>
        </section>
      ) : null}
      <section className="dshst-card">
        <div className="dshst-card-title">{t('takeover')}</div>
        <p className="dshst-card-desc">{t('takeoverHint')}</p>
        <div className="dshst-row"><label>{t('currentProvider')}</label><code>{currentSearch === SEARCH_PROVIDER ? SEARCH_PROVIDER : t('defaultProvider')}</code></div>
        <div className="dshst-actions">
          <Button size="sm" variant={currentSearch === SEARCH_PROVIDER ? 'outline' : 'primary'} onClick={() => { void setProvider('search', currentSearch !== SEARCH_PROVIDER) }}>{currentSearch === SEARCH_PROVIDER ? t('restore') : t('takeover')}</Button>
          <Tag tone={currentSearch === SEARCH_PROVIDER ? 'info' : 'outline'}>{currentSearch === SEARCH_PROVIDER ? t('searchTakeoverTag') : t('defaultProvider')}</Tag>
        </div>
        <details className="dshst-details">
          <summary>{t('status')}</summary>
          <p className="dshst-hint">
            {status?.search.available ? t('configured') : t('notConfigured')} · {status?.search.instances === 1 ? t('oneInstance') : t('instancesCount', { n: status?.search.instances ?? 0 })} · {t('cache')} {status?.cache.size ?? 0}
          </p>
        </details>
      </section>
      <section className="dshst-card">
        <div className="dshst-card-title">{t('takeoverFetch')}</div>
        <p className="dshst-card-desc">{t('takeoverFetchHint')}</p>
        <div className="dshst-row"><label>{t('currentFetchProvider')}</label><code>{currentFetch === FETCH_PROVIDER ? FETCH_PROVIDER : t('defaultProvider')}</code></div>
        <div className="dshst-actions">
          <Button size="sm" variant={currentFetch === FETCH_PROVIDER ? 'outline' : 'primary'} onClick={() => { void setProvider('fetch', currentFetch !== FETCH_PROVIDER) }}>{currentFetch === FETCH_PROVIDER ? t('restore') : t('takeoverFetch')}</Button>
          <Tag tone={currentFetch === FETCH_PROVIDER ? 'info' : 'outline'}>{currentFetch === FETCH_PROVIDER ? t('fetchTakeoverTag') : t('defaultProvider')}</Tag>
        </div>
      </section>
      <section className="dshst-card" style={{ gridColumn: '1 / -1' }}>
        <div className="dshst-card-title">{t('quickSearch')}</div>
        <div className="dshst-actions"><Input aria-label={t('query')} value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('query')} /><Button size="sm" variant="outline" disabled={testing !== undefined} onClick={() => { void testSearch() }}>{testing === 'search' ? t('testing') : t('test')}</Button></div>
        <div className="dshst-card-title" style={{ marginTop: 8 }}>{t('quickFetch')}</div>
        <div className="dshst-actions"><Input aria-label={t('url')} value={fetchUrl} onChange={event => { setFetchUrl(event.target.value) }} placeholder={t('url')} /><Button size="sm" variant="outline" disabled={testing !== undefined} onClick={() => { void testFetch() }}>{testing === 'fetch' ? t('testing') : t('test')}</Button></div>
      </section>
      {preview === undefined ? null : <div style={{ gridColumn: '1 / -1' }}><PreviewPanel preview={preview} t={t} /></div>}
    </div>
  )
}

function PreviewPanel({ preview, t }: { preview: PreviewState | undefined; t: Translate }): React.ReactElement | null {
  if (preview === undefined) return null
  const title = t('preview')
  return (
    <section className="dshst-card" aria-live="polite">
      <div className="dshst-actions">
        <div className="dshst-card-title">{title}</div>
        <Tag tone={preview.ok ? 'success' : 'danger'}>{preview.ok ? t('testOk') : t('testFail')}</Tag>
        {preview.elapsedMs === undefined ? null : <span className="dshst-hint">{t('elapsedMs', { ms: preview.elapsedMs })}</span>}
      </div>
      {preview.message === undefined ? null : <p className="dshst-error">{preview.message}</p>}
      {preview.kind === 'search' ? (
        (preview.sources ?? []).length === 0 ? <p className="dshst-hint">{t('noResults')}</p> : (
          <ul className="dshst-preview-results">
            {(preview.sources ?? []).map((source, index) => (
              <li key={`${source.url}:${index}`}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">{source.title ?? source.url}</a>
                <div className="dshst-hint">{source.url}</div>
                {source.snippet === undefined ? null : <p className="dshst-hint">{source.snippet}</p>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div>
          <p className="dshst-hint">
            {preview.url ?? ''}
            {preview.statusCode === undefined ? '' : ` · HTTP ${preview.statusCode}`}
            {preview.bodyKind === undefined ? '' : ` · ${preview.bodyKind}`}
            {preview.chars === undefined ? '' : ` · ${preview.chars} ${t('chars')}`}
            {preview.truncated === true ? ` · ${t('truncated')}` : ''}
          </p>
          {preview.content === undefined ? null : <pre className="dshst-pre">{preview.content}</pre>}
        </div>
      )}
      {preview.kind === 'search' && (preview.notes?.length ?? 0) > 0 ? (
        <div>
          <p className="dshst-hint">{t('searchNotes')}</p>
          <ul className="dshst-hint">
            {(preview.notes ?? []).map(note => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function AdapterPicker({ manifests, value, configs, refreshing, text, t, onRefresh, onChange }: {
  manifests: readonly AdapterManifest[]
  value: string
  configs: Record<string, JsonObject>
  refreshing: boolean
  text: (value: LocalizedText) => string
  t: Translate
  onRefresh: () => void
  onChange: (id: string) => void
}): React.ReactElement {
  const labelId = useId()
  const groupName = useId()
  const selected = manifests.find(manifest => manifest.id === value)
  const missing = value.length > 0 && selected === undefined
  return (
    <div className="dshst-picker">
      <div className="dshst-picker-head">
        <div>
          <div className="dshst-picker-label" id={labelId}>{t('adapter')}</div>
          <p className="dshst-hint">{t('adapterHint')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? t('refreshingAdapters') : t('refreshAdapters')}
        </Button>
      </div>
      <div className="dshst-picker-grid" role="radiogroup" aria-labelledby={labelId}>
        {missing ? (
          <label className="dshst-adapter-card" data-selected="true">
            <input
              type="radio"
              name={groupName}
              value={value}
              checked
              onChange={() => { onChange(value) }}
            />
            <span className="dshst-adapter-body">
              <span className="dshst-adapter-head">
                <span className="dshst-adapter-name">{t('adapterNotInstalled', { id: value })}</span>
                <Tag tone="warning">{t('adapterNotInstalledTag')}</Tag>
              </span>
              <span className="dshst-adapter-desc">{t('adapterMissingHint')}</span>
            </span>
          </label>
        ) : null}
        {manifests.map((manifest) => {
          const state = adapterState(manifest, configs[manifest.id])
          const status = state === 'ready'
            ? t('adapterConfigured')
            : state === 'attention' ? t('adapterNeedsAttention') : t('adapterNeedsSetup')
          return (
            <label key={manifest.id} className="dshst-adapter-card" data-selected={value === manifest.id}>
              <input
                type="radio"
                name={groupName}
                value={manifest.id}
                checked={value === manifest.id}
                onChange={() => { onChange(manifest.id) }}
              />
              <span className="dshst-adapter-body">
                <span className="dshst-adapter-head">
                  <span className="dshst-adapter-name">{text(manifest.label)}</span>
                  <Tag tone={state === 'ready' ? 'success' : state === 'attention' ? 'warning' : 'outline'}>{status}</Tag>
                </span>
                <span className="dshst-adapter-desc">{text(manifest.description)}</span>
                {manifest.capabilities === undefined || manifest.capabilities.length === 0 ? null : (
                  <span className="dshst-tags">{manifest.capabilities.map(capability => <Tag key={capability}>{capability}</Tag>)}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      {manifests.length === 0 && !missing ? <p className="dshst-hint">{t('noAdapters')}</p> : null}
    </div>
  )
}

function ResearchPrompt({ research, t }: { research: ResearchConfig; t: Translate }): React.ReactElement {
  const preview = buildResearchPromptPreview(research)
  return (
    <section className="dshst-card">
      <div>
        <div className="dshst-card-title">{t('researchPromptTitle')}</div>
        <p className="dshst-card-desc">{t('researchPromptHint')}</p>
      </div>
      {preview.enabled ? null : <p className="dshst-notice" role="status">{t('researchPromptDisabled')}</p>}
      <pre className="dshst-pre dshst-prompt" data-testid="research-prompt">{preview.text}</pre>
      <p className="dshst-hint">{t('researchPromptEnglish')}</p>
    </section>
  )
}

function adapterState(manifest: AdapterManifest, config: JsonObject | undefined): 'ready' | 'attention' | 'setup' {
  if (config === undefined) return 'setup'
  const instances = manifest.fields.find(field => field.kind === 'instances')
  if (instances !== undefined) {
    if (!hasEnabledInstances(getPath(config, instances.key))) return 'setup'
  } else if (!hasMeaningfulConfig(manifest, config)) {
    return 'setup'
  }
  return validateAdapterConfig(manifest, config).length > 0 ? 'attention' : 'ready'
}

function hasMeaningfulConfig(manifest: AdapterManifest, config: JsonObject): boolean {
  return manifest.fields
    .filter(field => field.kind !== 'boolean' && field.kind !== 'instances')
    .some((field) => {
      const value = getPath(config, field.key)
      if (typeof value === 'string') return value.trim().length > 0
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null
    })
}

function validateAdapterConfig(manifest: AdapterManifest, config: JsonObject): readonly AdapterIssue[] {
  if (manifest.kind === 'search' && manifest.id === 'searxng') return validateSearxngConfig(config).issues
  if (manifest.kind === 'fetch' && manifest.id === 'readable-http') return validateReadableHttpConfig(config).issues
  return validateManifestConfig(manifest, config).issues
}

function AdapterForm({ manifest, config, errors, disabled, text, t, onTestInstance, testingInstanceUrl, instanceResults, onChange }: {
  manifest: AdapterManifest | undefined
  config: JsonObject
  errors: readonly AdapterIssue[]
  disabled: boolean
  text: (value: LocalizedText) => string
  t: Translate
  onTestInstance?: ((instance: InstanceValue) => void) | undefined
  testingInstanceUrl?: string | undefined
  instanceResults?: Record<string, InstanceTestResult> | undefined
  onChange: (config: JsonObject) => void
}): React.ReactElement | null {
  if (manifest === undefined) return null
  return (
    <div>
      {manifest.fields.map(field => {
        const issue = errors.find(entry => entry.path === field.key || entry.path.startsWith(`${field.key}[`))
        const error = issue === undefined ? undefined : issueText(issue, t)
        if (field.kind === 'instances') {
          return (
            <div className="dshst-row" key={field.key}>
              <label>{text(field.label)}</label>
              <div>
                <InstanceEditor
                  value={getPath(config, field.key)}
                  disabled={disabled}
                  invalid={error !== undefined}
                  t={t}
                  onTest={onTestInstance}
                  testingUrl={testingInstanceUrl}
                  results={instanceResults}
                  onChange={(instances) => onChange(setPath(config, field.key, instances as unknown as JsonValue))}
                />
                {field.description === undefined ? null : <p className="dshst-hint">{text(field.description)}</p>}
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
            text={text}
            t={t}
            onChange={(value) => onChange(setPath(config, field.key, value))}
          />
        )
      })}
    </div>
  )
}

function SecretFields({ manifest, config, info, drafts, busy, text, t, onDraft, onSave, onClear }: {
  manifest: AdapterManifest | undefined
  config: JsonObject
  info: Record<string, CredentialInfo>
  drafts: Record<string, string>
  busy: string | undefined
  text: (value: LocalizedText) => string
  t: Translate
  onDraft: (ref: string, value: string) => void
  onSave: (ref: string) => void
  onClear: (ref: string) => void
}): React.ReactElement | null {
  if (manifest?.secretRefs === undefined || manifest.secretRefs.length === 0) return null
  const authType = getPath(config, 'auth.type')
  const secrets = manifest.secretRefs.filter(secret => secret.authType === undefined || secret.authType === authType)
  if (secrets.length === 0) return null
  return (
    <div>
      {secrets.map(secret => {
        const state = info[secret.ref]
        const configured = state?.configured === true
        const writable = state?.writable !== false
        const value = drafts[secret.ref] ?? ''
        const working = busy === secret.ref
        const inputId = `dshst-secret-${secret.ref.replace(/[^A-Za-z0-9_-]/g, '-')}`
        return (
          <div className="dshst-row" key={secret.ref}>
            <label htmlFor={inputId}>{text(secret.label)}</label>
            <div>
              <Input
                id={inputId}
                type="password"
                autoComplete="new-password"
                value={value}
                disabled={!writable || working}
                onChange={event => { onDraft(secret.ref, event.target.value) }}
              />
              <p className="dshst-hint">
                {configured ? t('secretConfigured') : t('secretUnset')}
                {state?.source === undefined ? '' : ` · ${t('secretSource', { source: state.source })}`}
                {' · '}
                {t('secretTestHint')}
              </p>
              {secret.description === undefined ? null : <p className="dshst-hint">{text(secret.description)}</p>}
              <div className="dshst-actions">
                <Button size="sm" variant="outline" disabled={!writable || working || value.length === 0} onClick={() => { onSave(secret.ref) }}>{t('saveSecret')}</Button>
                <Button size="sm" variant="ghost" disabled={!writable || working || !configured} onClick={() => { onClear(secret.ref) }}>{t('clearSecret')}</Button>
              </div>
            </div>
          </div>
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
    <div className="dshst-row">
      <label>{label}</label>
      <div><Switch checked={checked} label={label} onChange={onChange} disabled={disabled} /></div>
    </div>
  )
}

function NumberRow({ label, value, min, max, step, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled: boolean
  onChange: (value: number) => void
}): React.ReactElement {
  const id = useId()
  return (
    <div className="dshst-row">
      <label htmlFor={id}>{label}</label>
      <div>
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={String(value)}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))))
          }}
        />
      </div>
    </div>
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

function hasEnabledInstances(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some(entry => isRecord(entry)
    && entry.enabled !== false
    && typeof entry.url === 'string'
    && entry.url.trim().length > 0)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateSearchDraft(draft: StoredConfig, adapters: AdapterListResponse): AdapterIssue[] {
  const manifest = findManifest(adapters.search, draft.search.adapter)
  if (manifest === undefined) return []
  return [...validateAdapterConfig(manifest, adapterConfig(draft.search, draft.search.adapter))]
}

function validateFetchDraft(draft: StoredConfig, adapters: AdapterListResponse): AdapterIssue[] {
  const manifest = findManifest(adapters.fetch, draft.fetch.adapter)
  if (manifest === undefined) return []
  return [...validateAdapterConfig(manifest, adapterConfig(draft.fetch, draft.fetch.adapter))]
}

function validateResearchDraft(draft: StoredConfig, t: Translate): AdapterIssue[] {
  const issues: AdapterIssue[] = []
  if (draft.research.defaultFetchTop > draft.research.maxFetch) issues.push({ path: 'research.defaultFetchTop', message: t('researchFetchTopTooLarge') })
  if (draft.research.maxTotalChars < draft.research.maxCharsPerPage) issues.push({ path: 'research.maxTotalChars', message: t('researchTotalCharsTooSmall') })
  return issues
}

/** Keep the section type available to future tab implementations. */
export type { ConfigSection }
