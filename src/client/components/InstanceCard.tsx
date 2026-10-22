/** Per-instance editor: one card per backend endpoint, with inline connection test. */

import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconPlusOutlineRegular,
  IconTrashOutlineRegular, Input, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './Field.tsx'

export interface InstanceValue {
  url: string
  label: string
  enabled: boolean
}

export interface InstanceTestResult {
  ok: boolean
  message?: string
  latencyMs?: number
}

export function InstanceEditor({ value, disabled, invalid, t, onTest, testingUrl, results = {}, onChange }: {
  value: unknown
  disabled?: boolean
  invalid?: boolean | undefined
  t: Translate
  onTest?: ((instance: InstanceValue) => void) | undefined
  testingUrl?: string | undefined
  results?: Record<string, InstanceTestResult> | undefined
  onChange: (value: InstanceValue[]) => void
}): React.ReactElement {
  const instances = Array.isArray(value)
    ? value.filter((entry): entry is InstanceValue => typeof entry === 'object' && entry !== null && typeof (entry as InstanceValue).url === 'string')
    : []
  const update = (index: number, patch: Partial<InstanceValue>): void => {
    onChange(instances.map((entry, current) => current === index ? { ...entry, ...patch } : entry))
  }
  return (
    <div className="dshst-instances">
      {instances.length === 0 ? <p className="dshst-field-hint">{t('noInstanceRows')}</p> : null}
      {instances.map((instance, index) => {
        const result = results[instance.url]
        const testing = testingUrl === instance.url
        return (
          <div
            className="dshst-instance-card"
            key={index}
            data-enabled={instance.enabled}
            data-invalid={invalid === true || result?.ok === false ? 'true' : undefined}
          >
            <div className="dshst-instance-head">
              <span className="dshst-instance-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="dshst-instance-name">{instance.label.trim().length > 0 ? instance.label : t('instanceNLabel', { n: index + 1 })}</span>
              <span className="dshst-instance-state">
                <span className="dshst-instance-state-dot" aria-hidden="true" />
                {t(instance.enabled ? 'on' : 'off')}
              </span>
              <Switch
                checked={instance.enabled}
                label={t('enableInstanceN', { n: index + 1 })}
                disabled={disabled ?? false}
                onChange={checked => update(index, { enabled: checked })}
              />
            </div>
            <div className="dshst-instance-fields">
              <label className="dshst-instance-field">
                <span className="dshst-instance-field-label">{t('instanceUrl')}</span>
                <Input
                  className="dshst-input"
                  aria-label={t('instanceNAddress', { n: index + 1 })}
                  placeholder="https://searxng.example.com"
                  value={instance.url}
                  disabled={disabled}
                  aria-invalid={invalid === true}
                  onChange={event => update(index, { url: event.target.value })}
                />
              </label>
              <label className="dshst-instance-field">
                <span className="dshst-instance-field-label">{t('label')}</span>
                <Input
                  className="dshst-input"
                  aria-label={t('instanceNLabel', { n: index + 1 })}
                  placeholder={t('instanceLabelPlaceholder')}
                  value={instance.label}
                  disabled={disabled}
                  onChange={event => update(index, { label: event.target.value })}
                />
              </label>
            </div>
            <div className="dshst-instance-foot">
              <div className="dshst-instance-actions">
                {onTest === undefined ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${testing ? t('testing') : t('testInstance')} ${index + 1}`}
                    disabled={disabled || testingUrl !== undefined || instance.url.trim().length === 0}
                    onClick={() => { onTest(instance) }}
                  >{testing ? t('testing') : t('testInstance')}</Button>
                )}
                {result === undefined ? null : (
                  <span title={result.message}>
                    <Tag tone={result.ok ? 'success' : 'danger'}>
                      {result.ok ? t('instanceTestOk', { ms: result.latencyMs ?? 0 }) : t('instanceTestFail')}
                    </Tag>
                  </span>
                )}
              </div>
              <div className="dshst-instance-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('moveUp')}
                  icon={<IconChevronUpOutlineRegular size={14} />}
                  disabled={disabled || index === 0}
                  onClick={() => onChange(swap(instances, index, index - 1))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('moveDown')}
                  icon={<IconChevronDownOutlineRegular size={14} />}
                  disabled={disabled || index === instances.length - 1}
                  onClick={() => onChange(swap(instances, index, index + 1))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="dshst-icon-danger"
                  aria-label={t('remove')}
                  icon={<IconTrashOutlineRegular size={14} />}
                  disabled={disabled}
                  onClick={() => onChange(instances.filter((_entry, current) => current !== index))}
                />
              </div>
            </div>
          </div>
        )
      })}
      <button
        type="button"
        className="dshst-add-instance"
        disabled={disabled}
        onClick={() => onChange([...instances, { url: '', label: '', enabled: true }])}
      >
        <IconPlusOutlineRegular size={14} />
        {t('addInstance')}
      </button>
    </div>
  )
}

function swap(items: readonly InstanceValue[], left: number, right: number): InstanceValue[] {
  const copy = [...items]
  const value = copy[left]
  copy[left] = copy[right] as InstanceValue
  copy[right] = value as InstanceValue
  return copy
}
