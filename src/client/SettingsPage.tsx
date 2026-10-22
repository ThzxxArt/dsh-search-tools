/** Settings → Search Tools page. The only editable surface for this plugin. */

import { useEffect, useId, useRef, useSyncExternalStore, useState } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, CodeBlock, IconBrowseOutlineRegular, IconCloseCircleFillRegular, IconCopyOutlineRegular,
  IconGaugeOutlineRegular, IconInfoOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular,
  IconSearchOutlineRegular, IconSlidersTwoOutlineRegular, IconSparkleRegular, IconTrashOutlineRegular,
  IconWarningTriangleOutlineRegular, Input, PathLabel, SegmentedTabs, StateDot, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AdapterIssue, AdapterListResponse, AdapterManifest, JsonObject, JsonValue, LocalizedText, StatusResponse,
} from '../core/types.ts'
import { DEFAULT_STORED_CONFIG, type ActivationConfig, type ResearchConfig, type StoredConfig } from '../shared/defaults.ts'
import { diffSections, type ConfigSection } from '../shared/diff.ts'
import { getPath } from '../shared/path.ts'
import { isRecord, validateManifestConfig } from '../shared/validation.ts'
import { validateSearxngConfig } from '../search/adapters/searxng/schema.ts'
import { validateReadableHttpConfig } from '../fetch/adapters/readable-http/schema.ts'
import {
  clearCache, clearDiagnostics as clearDiagnosticsRequest, fetchAdapters, fetchStatus, previewFetch, previewSearch, probeSearch,
} from './api.ts'
import { AdapterForm } from './components/AdapterForm.tsx'
import { type InstanceTestResult, type InstanceValue } from './components/InstanceCard.tsx'
import { SectionCard } from './components/SectionCard.tsx'
import { type CredentialInfo } from './credential-types.ts'
import { formatDiagnostics } from './diagnostic-text.ts'
import { issueText } from './issue-text.ts'
import { buildResearchPromptPreview } from '../research/prompt.ts'
import { type Translate } from './components/Field.tsx'

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

type Tab = 'overview' | 'search' | 'fetch' | 'research' | 'diagnostics'
type Testing = 'search' | 'fetch' | undefined

const TABS: readonly Tab[] = ['overview', 'search', 'fetch', 'research', 'diagnostics']

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
  const activeFetchManifest = findManifest(adapters.fetch, draft.fetch.adapter)
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

  const tabItems = TABS.map(item => ({
    value: item,
    label: t(item),
    id: `dshst-tab-${item}`,
    panelId: `dshst-panel-${item}`,
  })) as [SegmentedTab<Tab>, ...SegmentedTab<Tab>[]]

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
            tone={status === undefined ? 'neutral' : status.fetch.registered ? 'success' : 'warning'}
            loading={status === undefined}
            label={`${t('fetch')}: ${status === undefined ? t('loading') : status.fetch.registered ? t('available') : t('notAvailable')}`}
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
            readOnly={readOnly}
            onOpenSearch={() => { setTab('search') }}
            onOpenFetch={() => { setTab('fetch') }}
          />
        </div>
      ) : null}

      {tab === 'search' ? (
        <div role="tabpanel" id="dshst-panel-search" aria-labelledby="dshst-tab-search" className="dshst-stack">
          <SectionCard
            icon={<IconSlidersTwoOutlineRegular size={16} />}
            title={t('searchBackend')}
            description={t('searchTabHint')}
          >
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
            {activeSearchManifest === undefined ? null : (
              <AdapterForm
                manifest={activeSearchManifest}
                config={adapterConfig(draft.search, draft.search.adapter)}
                errors={searchIssues}
                disabled={readOnly}
                text={text}
                t={t}
                onTestInstance={(instance) => { void testInstance(instance) }}
                testingInstanceUrl={instanceTesting}
                instanceResults={instanceResults}
                secretInfo={credentialInfo}
                secretDrafts={secretDrafts}
                secretBusy={secretBusy}
                onSecretDraft={(ref, value) => setSecretDrafts(previous => ({ ...previous, [ref]: value }))}
                onSecretSave={(ref) => { void saveSecret(ref) }}
                onSecretClear={(ref) => { void clearSecret(ref) }}
                onChange={(config) => edit({
                  ...draft,
                  search: { ...draft.search, adapters: { ...draft.search.adapters, [draft.search.adapter]: config } },
                })}
              />
            )}
          </SectionCard>
          <SectionCard
            icon={<IconPlayOutlineRegular size={16} />}
            title={t('testConsole')}
            description={t('testSearchHint')}
          >
            <TestConsole
              t={t}
              kind="search"
              value={query}
              placeholder={t('query')}
              label={t('query')}
              testing={testing === 'search'}
              disabled={testing !== undefined}
              onChange={setQuery}
              onTest={() => { void runSearchTest() }}
            />
            <TestResult preview={preview?.kind === 'search' ? preview : undefined} t={t} />
          </SectionCard>
        </div>
      ) : null}

      {tab === 'fetch' ? (
        <div role="tabpanel" id="dshst-panel-fetch" aria-labelledby="dshst-tab-fetch" className="dshst-stack">
          <SectionCard
            icon={<IconBrowseOutlineRegular size={16} />}
            title={t('fetchBackend')}
            description={t('fetchTabHint')}
          >
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
            {activeFetchManifest === undefined ? null : (
              <AdapterForm
                manifest={activeFetchManifest}
                config={adapterConfig(draft.fetch, draft.fetch.adapter)}
                errors={fetchIssues}
                disabled={readOnly}
                text={text}
                t={t}
                secretInfo={credentialInfo}
                secretDrafts={secretDrafts}
                secretBusy={secretBusy}
                onSecretDraft={(ref, value) => setSecretDrafts(previous => ({ ...previous, [ref]: value }))}
                onSecretSave={(ref) => { void saveSecret(ref) }}
                onSecretClear={(ref) => { void clearSecret(ref) }}
                onChange={(config) => edit({
                  ...draft,
                  fetch: { ...draft.fetch, adapters: { ...draft.fetch.adapters, [draft.fetch.adapter]: config } },
                })}
              />
            )}
          </SectionCard>
          <SectionCard
            icon={<IconPlayOutlineRegular size={16} />}
            title={t('testConsole')}
            description={t('testFetchHint')}
          >
            <TestConsole
              t={t}
              kind="fetch"
              value={fetchUrl}
              placeholder={t('url')}
              label={t('url')}
              testing={testing === 'fetch'}
              disabled={testing !== undefined}
              onChange={setFetchUrl}
              onTest={() => { void runFetchTest() }}
            />
            <TestResult preview={preview?.kind === 'fetch' ? preview : undefined} t={t} />
          </SectionCard>
        </div>
      ) : null}

      {tab === 'research' ? (
        <div role="tabpanel" id="dshst-panel-research" aria-labelledby="dshst-tab-research" className="dshst-stack">
          <SectionCard
            icon={<IconSparkleRegular size={16} />}
            title={t('researchScope')}
            description={t('researchHint')}
          >
            <div className="dshst-group-body">
              <BooleanRow
                t={t}
                label={t('researchEnabled')}
                hint={t('researchEnabledHint')}
                checked={draft.research.enabled}
                disabled={readOnly}
                onChange={(value) => edit({ ...draft, research: { ...draft.research, enabled: value } })}
              />
              <NumberRow label={t('researchMaxResults')} value={draft.research.maxResults} min={1} max={20} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxResults: value } })} />
              <NumberRow label={t('researchMaxFetch')} value={draft.research.maxFetch} min={1} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxFetch: value } })} />
              <NumberRow label={t('researchDefaultFetchTop')} value={draft.research.defaultFetchTop} min={0} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, defaultFetchTop: value } })} />
            </div>
          </SectionCard>
          <SectionCard
            icon={<IconBrowseOutlineRegular size={16} />}
            title={t('contentBudget')}
            description={t('contentBudgetHint')}
          >
            <div className="dshst-group-body">
              <NumberRow label={t('researchMaxCharsPerPage')} value={draft.research.maxCharsPerPage} min={1000} max={200000} step={1000} unit={t('chars')} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxCharsPerPage: value } })} />
              <NumberRow label={t('researchMaxTotalChars')} value={draft.research.maxTotalChars} min={1000} max={500000} step={1000} unit={t('chars')} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, maxTotalChars: value } })} />
              <div className="dshst-span2"><ResearchBudget research={draft.research} t={t} /></div>
            </div>
          </SectionCard>
          <SectionCard
            icon={<IconGaugeOutlineRegular size={16} />}
            title={t('execution')}
            description={t('executionHint')}
          >
            <div className="dshst-group-body">
              <NumberRow label={t('researchConcurrency')} value={draft.research.concurrency} min={1} max={8} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, concurrency: value } })} />
              <NumberRow label={t('researchTimeout')} value={draft.research.timeoutMs} min={5000} max={600000} step={1000} unit="ms" disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...draft.research, timeoutMs: value } })} />
            </div>
          </SectionCard>
          <ResearchPrompt research={draft.research} t={t} />
        </div>
      ) : null}

      {tab === 'diagnostics' ? (
        <div role="tabpanel" id="dshst-panel-diagnostics" aria-labelledby="dshst-tab-diagnostics" className="dshst-stack">
          <SectionCard
            icon={<IconGaugeOutlineRegular size={16} />}
            title={t('diagnostics')}
            description={t('configPathHint')}
            aside={<Tag tone="outline">v{status?.version ?? '—'}</Tag>}
          >
            <div className="dshst-stat-grid">
              <div className="dshst-stat">
                <span className="dshst-stat-label">{t('version')}</span>
                <span className="dshst-stat-value">{status?.version ?? '—'}</span>
                <span className="dshst-stat-meta">dsh-search-tools</span>
              </div>
              <div className="dshst-stat">
                <span className="dshst-stat-label">{t('search')}</span>
                <span className="dshst-stat-value">{status?.search.instances ?? 0}</span>
                <span className="dshst-stat-meta">{status?.search.instances === 1 ? t('oneInstance') : t('instancesCount', { n: status?.search.instances ?? 0 })}</span>
              </div>
              <div className="dshst-stat">
                <span className="dshst-stat-label">{t('cache')}</span>
                <span className="dshst-stat-value">{status?.cache.size ?? 0}</span>
                <span className="dshst-stat-meta">{t('entries', { n: status?.cache.size ?? 0 })}</span>
              </div>
              <div className="dshst-stat">
                <span className="dshst-stat-label">{t('lastErrors')}</span>
                <span className="dshst-stat-value">{status?.lastErrors.length ?? 0}</span>
                <span className="dshst-stat-meta">{status?.lastErrors.length ? t('attentionNeeded') : t('noErrors')}</span>
              </div>
            </div>
            <div className="dshst-path-row">
              <span className="dshst-stat-label">{t('configPath')}</span>
              <PathLabel className="dshst-path" path={status?.configPath ?? '—'} />
              <Button size="sm" variant="ghost" icon={<IconCopyOutlineRegular size={13} />} disabled={status?.configPath == null} onClick={() => { void copyPath() }} aria-label={t('copyPath')} />
            </div>
            <div className="dshst-actions">
              <Button size="sm" variant="outline" disabled={status === undefined} onClick={() => { void copyDiagnostics() }}>{t('copyDiagnostics')}</Button>
              <Button size="sm" variant="ghost" disabled={status === undefined} onClick={() => { void clearCacheNow() }}>{t('clearCache')}</Button>
            </div>
          </SectionCard>
          <SectionCard
            icon={<IconWarningTriangleOutlineRegular size={16} />}
            title={t('lastErrors')}
            description={t('lastErrorsHint')}
          >
            {status?.lastErrors.length ? (
              <ul className="dshst-error-list">
                {status.lastErrors.map(error => (
                  <li className="dshst-error-item" key={`${error.time}:${error.code}`}>
                    <span className="dshst-error-dot" aria-hidden="true" />
                    <div>
                      <div className="dshst-error-meta">{error.time} · {error.code}{error.host === undefined ? '' : ` · ${error.host}`}</div>
                      <div className="dshst-error-message">{error.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="dshst-hint">{t('noErrors')}</p>}
            <div className="dshst-actions">
              <Button size="sm" variant="ghost" icon={<IconTrashOutlineRegular size={13} />} disabled={status?.lastErrors.length === 0} onClick={() => { void clearDiagnosticEntries() }}>{t('clearErrors')}</Button>
            </div>
          </SectionCard>
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
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setDraft(normalize(snapshot.value)); setDirty(false); setMessage(undefined) }}>{t('discard')}</Button>
          <Button variant="primary" disabled={!dirty || saving || errors.length > 0 || readOnly} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</Button>
        </div>
      </footer>
    </div>
  )
}

function StatusChip({ tone, loading, label, title }: {
  tone: 'neutral' | 'success' | 'warning'
  loading: boolean
  label: string
  title?: string | undefined
}): React.ReactElement {
  const dot = loading ? 'ongoing' : tone === 'success' ? 'done' : tone === 'warning' ? 'warning' : 'idle'
  return (
    <span className="dshst-status-chip" data-tone={tone} title={title}>
      <StateDot state={dot} size={10} />
      <span>{label}</span>
    </span>
  )
}

function Notice({ tone, icon, title, children }: {
  tone: 'info' | 'warning' | 'error'
  icon: React.ReactNode
  title?: string | undefined
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="dshst-notice" data-tone={tone} role={tone === 'error' ? 'status' : undefined}>
      <span className="dshst-notice-icon" aria-hidden="true">{icon}</span>
      <div className="dshst-notice-copy">
        {title === undefined ? null : <p><strong>{title}</strong></p>}
        {children}
      </div>
    </div>
  )
}

function Overview({ t, status, currentSearch, currentFetch, query, setQuery, fetchUrl, setFetchUrl, testing, preview, testSearch, testFetch, setProvider, readOnly, onOpenSearch, onOpenFetch }: {
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
  readOnly: boolean
  onOpenSearch: () => void
  onOpenFetch: () => void
}): React.ReactElement {
  const searchActive = currentSearch === SEARCH_PROVIDER
  const fetchActive = currentFetch === FETCH_PROVIDER
  return (
    <>
      <div className="dshst-stat-grid">
        <div className="dshst-stat">
          <span className="dshst-stat-label">{t('search')}</span>
          <span className="dshst-stat-value">{status?.search.instances ?? 0}</span>
          <span className="dshst-stat-meta">{status?.search.instances === 1 ? t('oneInstance') : t('instancesCount', { n: status?.search.instances ?? 0 })}</span>
        </div>
        <div className="dshst-stat">
          <span className="dshst-stat-label">{t('cache')}</span>
          <span className="dshst-stat-value">{status?.cache.size ?? 0}</span>
          <span className="dshst-stat-meta">{t('entries', { n: status?.cache.size ?? 0 })}</span>
        </div>
        <div className="dshst-stat">
          <span className="dshst-stat-label">{t('lastErrors')}</span>
          <span className="dshst-stat-value">{status?.lastErrors.length ?? 0}</span>
          <span className="dshst-stat-meta">{status?.lastErrors.length ? t('attentionNeeded') : t('noErrors')}</span>
        </div>
      </div>

      {status !== undefined && status.search.instances === 0 ? (
        <div className="dshst-empty">
          <span className="dshst-empty-icon" aria-hidden="true"><IconSearchOutlineRegular size={18} /></span>
          <div className="dshst-empty-copy">
            <h3 className="dshst-empty-title">{t('emptyTitle')}</h3>
            <p className="dshst-empty-desc">{t('emptyHint')}</p>
            <Button size="sm" variant="primary" onClick={onOpenSearch}>{t('emptyAction')}</Button>
          </div>
        </div>
      ) : null}

      <div className="dshst-grid2">
        <PowerCard
          active={searchActive}
          mark={<IconSearchOutlineRegular size={16} />}
          title={t('takeover')}
          description={t('takeoverHint')}
          current={searchActive ? SEARCH_PROVIDER : t('defaultProvider')}
          currentLabel={t('currentProvider')}
          activeLabel={t('searchTakeoverTag')}
          idleLabel={t('defaultProvider')}
          switchLabel={searchActive ? t('disableSearchTakeover') : t('takeover')}
          disabled={readOnly}
          t={t}
          onToggle={next => { void setProvider('search', next) }}
          onConfigure={onOpenSearch}
        />
        <PowerCard
          active={fetchActive}
          mark={<IconBrowseOutlineRegular size={16} />}
          title={t('takeoverFetch')}
          description={t('takeoverFetchHint')}
          current={fetchActive ? FETCH_PROVIDER : t('defaultProvider')}
          currentLabel={t('currentFetchProvider')}
          activeLabel={t('fetchTakeoverTag')}
          idleLabel={t('defaultProvider')}
          switchLabel={fetchActive ? t('disableFetchTakeover') : t('takeoverFetch')}
          disabled={readOnly}
          t={t}
          onToggle={next => { void setProvider('fetch', next) }}
          onConfigure={onOpenFetch}
        />
      </div>

      <SectionCard
        icon={<IconPlayOutlineRegular size={16} />}
        title={t('testConsole')}
        description={t('testConsoleHint')}
      >
        <TestConsole
          t={t}
          kind="search"
          value={query}
          placeholder={t('query')}
          label={t('query')}
          testing={testing === 'search'}
          disabled={testing !== undefined}
          onChange={setQuery}
          onTest={() => { void testSearch() }}
        />
        <TestConsole
          t={t}
          kind="fetch"
          value={fetchUrl}
          placeholder={t('url')}
          label={t('url')}
          testing={testing === 'fetch'}
          disabled={testing !== undefined}
          onChange={setFetchUrl}
          onTest={() => { void testFetch() }}
        />
        <TestResult preview={preview} t={t} />
      </SectionCard>
    </>
  )
}

function PowerCard({ active, mark, title, description, current, currentLabel, activeLabel, idleLabel, switchLabel, disabled, t, onToggle, onConfigure }: {
  active: boolean
  mark: React.ReactNode
  title: string
  description: string
  current: string
  currentLabel: string
  activeLabel: string
  idleLabel: string
  switchLabel: string
  disabled: boolean
  t: Translate
  onToggle: (next: boolean) => void
  onConfigure: () => void
}): React.ReactElement {
  return (
    <section className="dshst-card dshst-power" data-active={active}>
      <div className="dshst-power-head">
        <span className="dshst-power-mark" aria-hidden="true">{mark}</span>
        <div className="dshst-power-copy">
          <h3 className="dshst-card-title">{title}</h3>
          <p className="dshst-card-desc">{description}</p>
        </div>
        <Switch checked={active} label={switchLabel} disabled={disabled} onChange={onToggle} />
      </div>
      <div className="dshst-power-meta">
        <span className="dshst-power-label">{currentLabel}</span>
        <code className="dshst-code-inline">{current}</code>
        <Tag tone={active ? 'info' : 'outline'}>{active ? activeLabel : idleLabel}</Tag>
      </div>
      <div className="dshst-power-actions">
        <Button size="sm" variant="ghost" aria-label={`${t('configure')} ${title}`} onClick={onConfigure}>{t('configure')}</Button>
      </div>
    </section>
  )
}

function TestConsole({ t, kind, value, placeholder, label, testing, disabled, onChange, onTest }: {
  t: Translate
  kind: 'search' | 'fetch'
  value: string
  placeholder: string
  label: string
  testing: boolean
  disabled: boolean
  onChange: (value: string) => void
  onTest: () => void
}): React.ReactElement {
  return (
    <div className="dshst-console" data-kind={kind}>
      <div className="dshst-console-row">
        <Input
          className="dshst-input"
          aria-label={label}
          value={value}
          placeholder={placeholder}
          disabled={testing}
          onChange={event => { onChange(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !disabled) { event.preventDefault(); onTest() }
          }}
        />
        <Button
          className="dshst-console-btn"
          size="sm"
          variant="outline"
          icon={<IconPlayOutlineRegular size={13} />}
          aria-label={`${t('test')} ${label}`}
          disabled={disabled}
          onClick={onTest}
        >{testing ? t('testing') : t('test')}</Button>
      </div>
    </div>
  )
}

function TestResult({ preview, t }: { preview: PreviewState | undefined; t: Translate }): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (preview === undefined) return
    const node = ref.current
    if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [preview])
  if (preview === undefined) return null
  return (
    <div className="dshst-test-result" ref={ref} aria-live="polite">
      <div className="dshst-test-head">
        <div className="dshst-test-title">{t('preview')}</div>
        <Tag tone={preview.ok ? 'success' : 'danger'}>{preview.ok ? t('testOk') : t('testFail')}</Tag>
        {preview.elapsedMs === undefined ? null : <span className="dshst-field-hint">{t('elapsedMs', { ms: preview.elapsedMs })}</span>}
      </div>
      {preview.message === undefined ? null : <p className="dshst-field-error">{preview.message}</p>}
      {preview.kind === 'search' ? (
        (preview.sources ?? []).length === 0 ? <p className="dshst-field-hint">{t('noResults')}</p> : (
          <ul className="dshst-source-list">
            {(preview.sources ?? []).map((source, index) => (
              <li className="dshst-source" key={`${source.url}:${index}`}>
                <a className="dshst-source-title" href={source.url} target="_blank" rel="noreferrer noopener">{source.title ?? source.url}</a>
                <div className="dshst-source-url">{source.url}</div>
                {source.snippet === undefined ? null : <p className="dshst-source-snippet">{source.snippet}</p>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="dshst-console">
          <p className="dshst-field-hint">
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
          <p className="dshst-field-hint">{t('searchNotes')}</p>
          <ul className="dshst-research-list">
            {(preview.notes ?? []).map(note => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
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
  const hintId = useId()
  const groupName = useId()
  const selected = manifests.find(manifest => manifest.id === value)
  const missing = value.length > 0 && selected === undefined
  return (
    <div className="dshst-picker">
      <div className="dshst-picker-head">
        <div>
          <div className="dshst-picker-label" id={labelId}>{t('adapter')}</div>
          <p className="dshst-field-hint" id={hintId}>{t('adapterHint')}</p>
        </div>
        <Button size="sm" variant="outline" icon={<IconRefreshOutlineRegular size={13} />} disabled={refreshing} onClick={onRefresh}>
          {refreshing ? t('refreshingAdapters') : t('refreshAdapters')}
        </Button>
      </div>
      <div className="dshst-picker-grid" role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId}>
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
                  <span className="dshst-adapter-tags">
                    {manifest.capabilities.map(capability => <span className="dshst-capability" key={capability}>{capability}</span>)}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      {manifests.length === 0 && !missing ? <p className="dshst-field-hint">{t('noAdapters')}</p> : null}
    </div>
  )
}

function ResearchBudget({ research, t }: { research: ResearchConfig; t: Translate }): React.ReactElement {
  const total = research.defaultFetchTop * research.maxCharsPerPage
  const totalPercent = Math.min(100, Math.round((total / Math.max(1, research.maxTotalChars)) * 100))
  const pagePercent = Math.min(100, Math.round((research.maxCharsPerPage / Math.max(1, research.maxTotalChars)) * 100))
  const tone = total > research.maxTotalChars ? 'error' : total > research.maxTotalChars * 0.85 ? 'warning' : undefined
  const remaining = Math.max(0, research.maxTotalChars - total)
  const format = new Intl.NumberFormat()
  return (
    <div className="dshst-budget">
      <div className="dshst-budget-row">
        <div className="dshst-budget-head">
          <span className="dshst-budget-label">{t('budgetPerPage')}</span>
          <span className="dshst-budget-value">{t('budgetShare', { n: pagePercent })}</span>
        </div>
        <div className="dshst-meter" aria-hidden="true">
          <div className="dshst-meter-fill" style={{ width: `${pagePercent}%` }} />
        </div>
      </div>
      <div className="dshst-budget-row">
        <div className="dshst-budget-head">
          <span className="dshst-budget-label">{t('budgetProjected')}</span>
          <span className="dshst-budget-value">{t('budgetProjectedValue', { used: format.format(total), total: format.format(research.maxTotalChars) })}</span>
        </div>
        <div
          className="dshst-meter"
          role="progressbar"
          aria-label={t('budgetProjected')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={totalPercent}
        >
          <div className="dshst-meter-fill" data-tone={tone} style={{ width: `${totalPercent}%` }} />
        </div>
        <span className="dshst-budget-label">{t('budgetRemaining', { n: format.format(remaining) })}</span>
      </div>
    </div>
  )
}

function ResearchPrompt({ research, t }: { research: ResearchConfig; t: Translate }): React.ReactElement {
  const preview = buildResearchPromptPreview(research)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyPrompt = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(preview.text)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  return (
    <SectionCard
      icon={<IconSparkleRegular size={16} />}
      title={t('researchPromptTitle')}
      description={t('researchPromptHint')}
      aside={(
        <Button
          size="sm"
          variant="ghost"
          className="dshst-copy-btn"
          icon={<IconCopyOutlineRegular size={13} />}
          disabled={!preview.enabled}
          onClick={() => { void copyPrompt() }}
        >{copy === 'copied' ? t('copiedPrompt') : copy === 'failed' ? t('copyFailed') : t('copyPrompt')}</Button>
      )}
    >
      {preview.enabled ? null : <Notice tone="warning" icon={<IconInfoOutlineRegular size={14} />}>{t('researchPromptDisabled')}</Notice>}
      <div className="dshst-code-head">
        <Tag tone="outline">{t('researchPromptEnglishShort')}</Tag>
      </div>
      <div className="dshst-codeblock" data-testid="research-prompt">
        <CodeBlock
          code={preview.text}
          lang="text"
          showHeader={false}
          className="dshst-prompt-code"
          copyLabel={t('copyPrompt')}
          copiedLabel={t('copiedPrompt')}
        />
      </div>
      <p className="dshst-field-hint">{t('researchPromptEnglish')}</p>
    </SectionCard>
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

function BooleanRow({ t, label, hint, checked, disabled, onChange }: {
  t: Translate
  label: string
  hint?: string | undefined
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}): React.ReactElement {
  return (
    <div className="dshst-field" data-kind="switch">
      <div className="dshst-field-copy">
        <div className="dshst-field-label">{label}</div>
        {hint === undefined ? null : <p className="dshst-field-hint">{hint}</p>}
      </div>
      <div className="dshst-switch-line">
        <span className="dshst-switch-state" aria-hidden="true">{t(checked ? 'on' : 'off')}</span>
        <Switch checked={checked} label={label} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  )
}

function NumberRow({ label, value, min, max, step, unit, hint, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number | undefined
  unit?: string | undefined
  hint?: string | undefined
  disabled: boolean
  onChange: (value: number) => void
}): React.ReactElement {
  const id = useId()
  return (
    <div className="dshst-field">
      <label className="dshst-field-label" htmlFor={id}>{label}</label>
      <div className="dshst-unit-wrap">
        <Input
          id={id}
          className="dshst-input"
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
        {unit === undefined ? null : <span className="dshst-unit">{unit}</span>}
      </div>
      {hint === undefined ? null : <p className="dshst-field-hint">{hint}</p>}
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
