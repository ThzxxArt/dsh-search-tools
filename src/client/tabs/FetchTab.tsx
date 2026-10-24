/** Fetch tab: backend, extraction limits, and the fetch reader test console. */

import { IconBrowseOutlineRegular, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsModel } from '../settings-model.ts'
import { AdapterForm } from '../components/AdapterForm.tsx'
import { AdapterPicker } from '../components/AdapterPicker.tsx'
import { SectionCard } from '../components/SectionCard.tsx'
import { TestConsole, TestResult } from '../components/TestConsole.tsx'
import { adapterConfig, findManifest } from '../settings-utils.ts'

export function FetchTab({ model }: { model: SettingsModel }): React.ReactElement {
  const {
    t, text, draft, adapters, fetchIssues, readOnly, preview, testing, fetchUrl, setFetchUrl,
    refreshingAdapters, credentialInfo, secretDrafts, secretBusy, secretErrors,
    edit, onRefreshAdapters, onSelectAdapter, onSecretDraft, onSecretSave, onSecretClear, runFetchTest,
  } = model
  const manifest = findManifest(adapters.fetch, draft.fetch.adapter)
  return (
    <div className="dshst-stack">
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
          disabled={readOnly}
          text={text}
          t={t}
          onRefresh={() => { void onRefreshAdapters() }}
          onChange={(id) => { onSelectAdapter('fetch', id) }}
        />
        {manifest === undefined ? null : (
          <AdapterForm
            manifest={manifest}
            config={adapterConfig(draft.fetch, draft.fetch.adapter)}
            errors={fetchIssues}
            disabled={readOnly}
            text={text}
            t={t}
            secretInfo={credentialInfo}
            secretDrafts={secretDrafts}
            secretBusy={secretBusy}
            secretErrors={secretErrors}
            onSecretDraft={onSecretDraft}
            onSecretSave={(ref) => { void onSecretSave(ref) }}
            onSecretClear={(ref) => { void onSecretClear(ref) }}
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
  )
}
