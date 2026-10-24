/** Settings → Search Tools page. The only editable surface for this plugin. */

import { useEffect, useRef, useSyncExternalStore, useState } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconCloseCircleFillRegular, IconInfoOutlineRegular, IconSearchOutlineRegular,
  IconWarningTriangleOutlineRegular, SegmentedTabs,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdapterIssue, AdapterListResponse, JsonObject, JsonValue, LocalizedText, StatusResponse } from '../core/types.ts'
import { DEFAULT_STORED_CONFIG, type ActivationConfig, type StoredConfig } from '../shared/defaults.ts'
import { diffSections, type ConfigSection } from '../shared/diff.ts'
import { getPath } from '../shared/path.ts'
import {
  clearCache, clearDiagnostics as clearDiagnosticsRequest, fetchAdapters, fetchStatus, previewFetch, previewSearch, probeSearch,
} from './api.ts'
import type { InstanceTestResult, InstanceValue } from './components/InstanceCard.tsx'
import { Notice, StatusChip } from './components/Feedback.tsx'
import { type CredentialInfo } from './credential-types.ts'
import { formatDiagnostics } from './diagnostic-text.ts'
import { issueText } from './issue-text.ts'
import { type Translate } from './components/Field.tsx'
import { FETCH_PROVIDER, SEARCH_PROVIDER } from './provider-ids.ts'
import type { PreviewState } from './preview-types.ts'
import type { SearchProbeState, SettingsModel, Tab, Testing } from './settings-model.ts'
import { adapterConfig, findManifest, hasEnabledInstances, isHttpUrl, validateAdapterConfig } from './settings-utils.ts'
import { DiagnosticsTab } from './tabs/DiagnosticsTab.tsx'
import { FetchTab } from './tabs/FetchTab.tsx'
import { OverviewTab } from './tabs/OverviewTab.tsx'
import { ResearchTab } from './tabs/ResearchTab.tsx'
import { SearchTab } from './tabs/SearchTab.tsx'

export { FETCH_PROVIDER, SEARCH_PROVIDER } from './provider-ids.ts'

export interface WebSelection {
  searchProvider?: string
  fetchProvider?: string
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

const TABS: readonly Tab[] = ['overview', 'search', 'fetch', 'research', 'diagnostics']

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
  const [conflict, setConflict] = useState(false)
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<StatusResponse | undefined>()
  const [adapters, setAdapters] = useState<AdapterListResponse>({ search: [], fetch: [] })
  const [query, setQuery] = useState('DeepSeek Harness')
  const [fetchUrl, setFetchUrl] = useState('https://example.com')
  const [preview, setPreview] = useState<PreviewState | undefined>()
  const [testing, setTesting] = useState<Testing>()
  const [probingSearch, setProbingSearch] = useState(false)
  const [searchProbe, setSearchProbe] = useState<SearchProbeState>()
  const [credentialInfo, setCredentialInfo] = useState<Record<string, CredentialInfo>>({})
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [secretBusy, setSecretBusy] = useState<string>()
  const [instanceTesting, setInstanceTesting] = useState<string>()
  const [instanceResults, setInstanceResults] = useState<Record<string, InstanceTestResult>>({})
  const [refreshingAdapters, setRefreshingAdapters] = useState(false)
  const probeGeneration = useRef(0)

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
    probeGeneration.current += 1
    setDraft(normalize(snapshot.value))
    setSearchProbe(undefined)
    setProbingSearch(false)
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
  const activeErrors = tab === 'overview'
    ? errors
    : tab === 'search'
      ? searchIssues
      : tab === 'fetch'
        ? fetchIssues
        : tab === 'research' ? researchIssues : []

  const edit = (next: StoredConfig): void => {
    probeGeneration.current += 1
    setDraft(next)
    setDirty(true)
    setMessage(undefined)
    setConflict(false)
    setSearchProbe(undefined)
    setProbingSearch(false)
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

  const clearCacheNow = async (): Promise<void> => {
    try {
      await clearCache()
      await refreshStatus()
      setMessage(t('cleared'))
    } catch (error) {
      setMessage(errorText(error))
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
        setConflict(true)
        setMessage(t('conflict'))
        return
      }
      setDirty(false)
      setConflict(false)
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

  const copyPath = async (): Promise<void> => {
    const path = status?.configPath
    if (path === undefined || path === null) return
    try {
      await navigator.clipboard.writeText(path)
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
      setSecretErrors(previous => {
        const next = { ...previous }
        delete next[ref]
        return next
      })
      setMessage(t('saved'))
    } catch (error) {
      setSecretErrors(previous => ({ ...previous, [ref]: error instanceof Error ? error.message : String(error) }))
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
      setSecretErrors(previous => {
        const next = { ...previous }
        delete next[ref]
        return next
      })
      setMessage(t('saved'))
    } catch (error) {
      setSecretErrors(previous => ({ ...previous, [ref]: error instanceof Error ? error.message : String(error) }))
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

  const probeSearchNow = async (): Promise<void> => {
    if (searchIssues.length > 0) {
      setMessage(t('fixErrorsFirst'))
      return
    }
    const generation = ++probeGeneration.current
    const adapter = draft.search.adapter
    const config = adapterConfig(draft.search, adapter)
    setProbingSearch(true)
    setSearchProbe(undefined)
    try {
      const result = await probeSearch(adapter, config)
      if (generation === probeGeneration.current) setSearchProbe({ adapter, result })
    } catch (error) {
      if (generation === probeGeneration.current) {
        setSearchProbe({
          adapter,
          result: { ok: false, code: 'SEARCH_PROBE_FAILED', message: errorText(error), latencyMs: 0 },
        })
      }
    } finally {
      if (generation === probeGeneration.current) setProbingSearch(false)
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
    if (!ok) {
      setConflict(true)
      setMessage(t('conflict'))
    } else {
      setConflict(false)
      setMessage(t('saved'))
      await refreshStatus()
    }
  }

  const tabItems = TABS.map(item => ({
    value: item,
    label: t(item),
    id: `dshst-tab-${item}`,
    panelId: `dshst-panel-${item}`,
  })) as [SegmentedTab<Tab>, ...SegmentedTab<Tab>[]]

  const selectAdapter = (kind: 'search' | 'fetch', id: string): void => {
    const section = kind === 'search' ? draft.search : draft.fetch
    const list = kind === 'search' ? adapters.search : adapters.fetch
    const next = {
      adapter: id,
      adapters: {
        ...section.adapters,
        [id]: section.adapters[id] ?? (findManifest(list, id)?.defaults as JsonObject | undefined) ?? {},
      },
    }
    edit(kind === 'search' ? { ...draft, search: next } : { ...draft, fetch: next })
  }

  const editSecretDraft = (ref: string, value: string): void => {
    setSecretDrafts(previous => ({ ...previous, [ref]: value }))
    setSecretErrors((previous) => {
      if (previous[ref] === undefined) return previous
      const next = { ...previous }
      delete next[ref]
      return next
    })
  }

  const model: SettingsModel = {
    t,
    text,
    draft,
    adapters,
    status,
    currentSearch,
    currentFetch,
    preview,
    query,
    fetchUrl,
    testing,
    probingSearch,
    searchProbe,
    readOnly,
    refreshingAdapters,
    searchIssues,
    fetchIssues,
    researchIssues,
    instanceTesting,
    instanceResults,
    credentialInfo,
    secretDrafts,
    secretBusy,
    secretErrors,
    conflict,
    setQuery,
    setFetchUrl,
    edit,
    onOpenTab: setTab,
    onRefreshAdapters: refreshAdapters,
    onSelectAdapter: selectAdapter,
    onTestInstance: testInstance,
    onSecretDraft: editSecretDraft,
    onSecretSave: saveSecret,
    onSecretClear: clearSecret,
    runSearchTest,
    runFetchTest,
    probeSearch: probeSearchNow,
    setProvider,
    copyDiagnostics,
    copyPath,
    clearCache: clearCacheNow,
    clearDiagnostics: clearDiagnosticEntries,
  }

  return (
    <div className="dshst-page">
      <header className="dshst-hero">
        <div className="dshst-hero-main">
          <span className="dshst-hero-mark" aria-hidden="true"><IconSearchOutlineRegular size={21} /></span>
          <div className="dshst-hero-copy">
            <h2 className="dshst-title">{t('title')}</h2>
            <p className="dshst-sub">{t('subtitle')}</p>
          </div>
        </div>
        <div className="dshst-hero-status" aria-label={t('status')}>
          <StatusChip
            tone={status === undefined ? 'neutral' : status.search.available ? 'success' : 'warning'}
            loading={status === undefined}
            label={status === undefined ? t('loading') : status.search.available ? t('configured') : t('notConfigured')}
            title={currentSearch === SEARCH_PROVIDER ? t('searchTakeoverTag') : t('defaultProvider')}
          />
          <StatusChip
            tone={status === undefined ? 'neutral' : status.fetch.available ? 'success' : 'warning'}
            loading={status === undefined}
            label={`${t('fetch')}: ${status === undefined ? t('loading') : status.fetch.available ? t('available') : t('notAvailable')}`}
          />
          <StatusChip
            tone={status === undefined ? 'neutral' : status.research.enabled ? 'success' : 'neutral'}
            loading={status === undefined}
            label={`${t('research')}: ${status === undefined ? t('loading') : status.research.enabled ? t('on') : t('off')}`}
          />
        </div>
      </header>

      <SegmentedTabs
        items={tabItems}
        value={tab}
        onChange={setTab}
        label={t('title')}
        className="dshst-tabs"
      />

      <div className="dshst-notice-stack">
        {snapshot.status === 'loading' ? <Notice tone="info" icon={<IconInfoOutlineRegular size={14} />}>{t('loading')}</Notice> : null}
        {snapshot.status === 'unavailable' ? <Notice tone="warning" icon={<IconWarningTriangleOutlineRegular size={14} />}>{t('unavailable')}</Notice> : null}
        {snapshot.status === 'ready' && snapshot.writable === false ? <Notice tone="warning" icon={<IconInfoOutlineRegular size={14} />}>{t('readOnly')}</Notice> : null}
        {conflict ? <Notice tone="warning" icon={<IconWarningTriangleOutlineRegular size={14} />}>{t('conflict')}</Notice> : null}
        {activeErrors.length > 0 ? (
          <Notice tone="error" icon={<IconCloseCircleFillRegular size={14} />} title={t('invalid')}>
            <ul className="dshst-notice-list">
              {activeErrors.slice(0, 8).map(error => <li key={`${error.path}:${error.code ?? error.message}`}>{issueText(error, t)}</li>)}
            </ul>
          </Notice>
        ) : null}
      </div>

      {tab === 'overview' ? (
        <div role="tabpanel" id="dshst-panel-overview" aria-labelledby="dshst-tab-overview" className="dshst-stack">
          <OverviewTab model={model} />
        </div>
      ) : null}

      {tab === 'search' ? (
        <div role="tabpanel" id="dshst-panel-search" aria-labelledby="dshst-tab-search" className="dshst-stack">
          <SearchTab model={model} />
        </div>
      ) : null}

      {tab === 'fetch' ? (
        <div role="tabpanel" id="dshst-panel-fetch" aria-labelledby="dshst-tab-fetch" className="dshst-stack">
          <FetchTab model={model} />
        </div>
      ) : null}

      {tab === 'research' ? (
        <div role="tabpanel" id="dshst-panel-research" aria-labelledby="dshst-tab-research" className="dshst-stack">
          <ResearchTab model={model} />
        </div>
      ) : null}

      {tab === 'diagnostics' ? (
        <div role="tabpanel" id="dshst-panel-diagnostics" aria-labelledby="dshst-tab-diagnostics" className="dshst-stack">
          <DiagnosticsTab model={model} />
        </div>
      ) : null}

      <footer className="dshst-actionbar">
        <div className="dshst-actionbar-status" data-dirty={dirty} role="status" aria-live="polite">
          {dirty ? <span className="dshst-dirty-dot" aria-hidden="true" /> : null}
          <span>{errors.length > 0
            ? `${dirty ? `${t('dirty')} · ` : ''}${t('invalid')}${message === undefined ? '' : ` · ${message}`}`
            : dirty ? `${t('dirty')}${message === undefined ? '' : ` · ${message}`}` : message ?? t('clean')}</span>
        </div>
        <div className="dshst-actionbar-actions">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { probeGeneration.current += 1; setDraft(normalize(snapshot.value)); setDirty(false); setMessage(undefined); setConflict(false); setSearchProbe(undefined); setProbingSearch(false) }}>{t('discard')}</Button>
          <Button variant="primary" disabled={!dirty || saving || errors.length > 0 || readOnly} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</Button>
        </div>
      </footer>
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
