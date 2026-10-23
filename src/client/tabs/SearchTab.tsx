/** Search tab: backend, connection, behavior, advanced fields, and test console. */

import { useEffect, useState } from 'react'
import { Button, IconPlayOutlineRegular, IconSlidersTwoOutlineRegular, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsModel } from '../settings-model.ts'
import { AdapterPicker } from '../components/AdapterPicker.tsx'
import { AdapterForm, resolveAdapterGroups } from '../components/AdapterForm.tsx'
import { SectionCard } from '../components/SectionCard.tsx'
import { TestConsole, TestResult } from '../components/TestConsole.tsx'
import { adapterConfig, adapterState, findManifest } from '../settings-utils.ts'

type SearchView = 'connection' | 'behavior'

export function SearchTab({ model }: { model: SettingsModel }): React.ReactElement {
  const {
    t, text, draft, adapters, searchIssues, readOnly, preview, testing, query, setQuery,
    refreshingAdapters, instanceTesting, instanceResults, credentialInfo, secretDrafts, secretBusy, secretErrors,
    edit, onRefreshAdapters, onSelectAdapter, onTestInstance,
    onSecretDraft, onSecretSave, onSecretClear, runSearchTest,
  } = model
  const manifest = findManifest(adapters.search, draft.search.adapter)
  const groups = manifest === undefined ? [] : resolveAdapterGroups(manifest, text, t)
  const canSplit = groups.length > 1
  const [view, setView] = useState<SearchView>('connection')
  const [pickerOpen, setPickerOpen] = useState(manifest === undefined)

  useEffect(() => {
    if (!canSplit) setView('connection')
  }, [canSplit, manifest?.id])

  useEffect(() => {
    setPickerOpen(manifest === undefined)
  }, [manifest?.id])

  const items = canSplit ? ([
    { value: 'connection', label: groups[0]?.label ?? t('connection'), id: 'dshst-search-view-connection', panelId: 'dshst-search-view-panel-connection' },
    { value: 'behavior', label: groups[1]?.label ?? t('searchBehavior'), id: 'dshst-search-view-behavior', panelId: 'dshst-search-view-panel-behavior' },
  ] satisfies [SegmentedTab<SearchView>, SegmentedTab<SearchView>]) : undefined
  const groupIds = canSplit
    ? view === 'connection'
      ? groups[0] === undefined ? [] : [groups[0].id]
      : groups.slice(1).map(group => group.id)
    : undefined
  const backendState = manifest === undefined
    ? 'setup'
    : adapterState(manifest, adapterConfig(draft.search, draft.search.adapter))
  const backendStatus = backendState === 'ready'
    ? t('adapterConfigured')
    : backendState === 'attention' ? t('adapterNeedsAttention') : t('adapterNeedsSetup')

  return (
    <div className="dshst-stack">
      <SectionCard
        icon={<IconSlidersTwoOutlineRegular size={16} />}
        title={t('searchBackend')}
        description={t('searchTabHint')}
      >
        {manifest !== undefined && !pickerOpen ? (
          <div className="dshst-backend-summary">
            <div className="dshst-backend-current">
              <span className="dshst-stat-label">{t('adapter')}</span>
              <strong>{text(manifest.label)}</strong>
              <Tag tone={backendState === 'ready' ? 'success' : backendState === 'attention' ? 'warning' : 'outline'}>{backendStatus}</Tag>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setPickerOpen(true) }}>{t('changeBackend')}</Button>
          </div>
        ) : (
          <AdapterPicker
            manifests={adapters.search}
            value={draft.search.adapter}
            configs={draft.search.adapters}
            refreshing={refreshingAdapters}
            text={text}
            t={t}
            onRefresh={() => { void onRefreshAdapters() }}
            onChange={(id) => { onSelectAdapter('search', id); setPickerOpen(false) }}
          />
        )}
        {items === undefined ? null : (
          <SegmentedTabs
            items={items}
            value={view}
            onChange={setView}
            label={t('searchBackend')}
            className="dshst-subtabs"
          />
        )}
        {manifest === undefined ? null : (
          <AdapterForm
            manifest={manifest}
            config={adapterConfig(draft.search, draft.search.adapter)}
            errors={searchIssues}
            disabled={readOnly}
            text={text}
            t={t}
            groupIds={groupIds}
            onTestInstance={(instance) => { void onTestInstance(instance) }}
            testingInstanceUrl={instanceTesting}
            instanceResults={instanceResults}
            secretInfo={credentialInfo}
            secretDrafts={secretDrafts}
            secretBusy={secretBusy}
            secretErrors={secretErrors}
            onSecretDraft={onSecretDraft}
            onSecretSave={(ref) => { void onSecretSave(ref) }}
            onSecretClear={(ref) => { void onSecretClear(ref) }}
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
  )
}
