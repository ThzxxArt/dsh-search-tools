/** Radio-card adapter picker with per-adapter configured state. */

import { useId } from 'react'
import { Button, IconRefreshOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdapterManifest, JsonObject, LocalizedText } from '../../core/types.ts'
import { adapterState } from '../settings-utils.ts'
import type { Translate } from './Field.tsx'

export function AdapterPicker({ manifests, value, configs, refreshing, text, t, onRefresh, onChange }: {
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
            <input type="radio" name={groupName} value={value} checked onChange={() => { onChange(value) }} />
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
              <input type="radio" name={groupName} value={manifest.id} checked={value === manifest.id} onChange={() => { onChange(manifest.id) }} />
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
