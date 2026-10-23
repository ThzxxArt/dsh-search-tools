/** Diagnostics tab: runtime facts, config path, maintenance, and recent errors. */

import {
  Button, IconCopyOutlineRegular, IconGaugeOutlineRegular, IconTrashOutlineRegular,
  IconWarningTriangleOutlineRegular, PathLabel, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsModel } from '../settings-model.ts'
import { SectionCard } from '../components/SectionCard.tsx'

export function DiagnosticsTab({ model }: { model: SettingsModel }): React.ReactElement {
  const { t, status, copyDiagnostics, copyPath, clearCache, clearDiagnostics } = model
  return (
    <div className="dshst-stack">
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
        <p className="dshst-field-hint" data-testid="runtime-state">
          {`${t('fetch')}: ${status?.fetch.available ? t('available') : t('notAvailable')} · ${t('research')}: ${status?.research.registered ? t('registered') : t('notRegistered')}`}
        </p>
        <div className="dshst-actions">
          <Button size="sm" variant="outline" disabled={status === undefined} onClick={() => { void copyDiagnostics() }}>{t('copyDiagnostics')}</Button>
          <Button size="sm" variant="ghost" disabled={status === undefined} onClick={() => { void clearCache() }}>{t('clearCache')}</Button>
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
        ) : <p className="dshst-field-hint">{t('noErrors')}</p>}
        <div className="dshst-actions">
          <Button size="sm" variant="ghost" icon={<IconTrashOutlineRegular size={13} />} disabled={status?.lastErrors.length === 0} onClick={() => { void clearDiagnostics() }}>{t('clearErrors')}</Button>
        </div>
      </SectionCard>
    </div>
  )
}
