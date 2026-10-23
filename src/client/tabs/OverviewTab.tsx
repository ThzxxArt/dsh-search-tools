/** Overview tab: health summary, takeover cards, and the shared test console. */

import { Button, IconBrowseOutlineRegular, IconPlayOutlineRegular, IconSearchOutlineRegular, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { FETCH_PROVIDER, SEARCH_PROVIDER } from '../provider-ids.ts'
import type { SettingsModel } from '../settings-model.ts'
import { SectionCard } from '../components/SectionCard.tsx'
import { TestConsole, TestResult } from '../components/TestConsole.tsx'
import type { Translate } from '../components/Field.tsx'

export function OverviewTab({ model }: { model: SettingsModel }): React.ReactElement {
  const { t, status, currentSearch, currentFetch, query, setQuery, fetchUrl, setFetchUrl, testing, preview, runSearchTest, runFetchTest, setProvider, readOnly, onOpenTab } = model
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
            <Button size="sm" variant="primary" onClick={() => { onOpenTab('search') }}>{t('emptyAction')}</Button>
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
          onConfigure={() => { onOpenTab('search') }}
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
          onConfigure={() => { onOpenTab('fetch') }}
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
          onTest={() => { void runSearchTest() }}
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
          onTest={() => { void runFetchTest() }}
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
