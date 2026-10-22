/** Generic field renderer for adapter manifests. */

import { useId, useState } from 'react'
import { Button, IconCloseOutlineRegular, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdapterField, JsonValue, LocalizedText } from '../../core/types.ts'

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface FieldProps {
  field: AdapterField
  value: unknown
  disabled?: boolean | undefined
  error?: string | undefined
  secretConfigured?: boolean | undefined
  secretWritable?: boolean | undefined
  text: (value: LocalizedText) => string
  t: Translate
  onChange: (value: JsonValue) => void
}

export function Field({
  field, value, disabled = false, error, secretConfigured, secretWritable, text, t, onChange,
}: FieldProps) {
  if (field.kind === 'instances') return null
  const id = useId()
  const label = text(field.label)
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [field.description === undefined ? undefined : hintId, error === undefined ? undefined : errorId]
    .filter((entry): entry is string => entry !== undefined)
    .join(' ') || undefined
  const hint = field.description === undefined
    ? null
    : <p className="dshst-field-hint" id={hintId}>{text(field.description)}</p>
  const errorLine = error === undefined
    ? null
    : <p className="dshst-field-error" id={errorId} role="alert">{error}</p>

  if (field.kind === 'boolean') {
    return (
      <div className="dshst-field" data-kind="switch" data-invalid={error === undefined ? undefined : 'true'}>
        <div className="dshst-field-copy">
          <div className="dshst-field-label">{label}</div>
          {hint}
          {errorLine}
        </div>
        <div className="dshst-switch-line">
          <span className="dshst-switch-state" aria-hidden="true">{t(value === true ? 'on' : 'off')}</span>
          <Switch checked={value === true} label={label} disabled={disabled} onChange={onChange} />
        </div>
      </div>
    )
  }

  return (
    <div className="dshst-field" data-kind={field.kind} data-invalid={error === undefined ? undefined : 'true'}>
      <label className="dshst-field-label" htmlFor={`${id}-input`}>{label}</label>
      {field.kind === 'select' ? (
        <select
          id={`${id}-input`}
          className="dshst-select"
          value={typeof value === 'string' ? value : String(field.default ?? '')}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          onChange={event => onChange(event.target.value)}
        >
          {field.options.map(option => <option key={option.value} value={option.value}>{text(option.label)}</option>)}
        </select>
      ) : field.kind === 'number' ? (
        <div className="dshst-unit-wrap">
          <Input
            id={`${id}-input`}
            className="dshst-input"
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === 'number' ? String(value) : ''}
            disabled={disabled}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              const next = Number(event.target.value)
              onChange(Number.isFinite(next) ? next : (field.default ?? 0))
            }}
          />
          {field.unit === undefined ? null : <span className="dshst-unit">{field.unit}</span>}
        </div>
      ) : field.kind === 'tags' ? (
        <TagsField
          field={field}
          value={value}
          disabled={disabled}
          error={error}
          text={text}
          t={t}
          describedBy={describedBy}
          onChange={onChange}
        />
      ) : (
        <Input
          id={`${id}-input`}
          className="dshst-input"
          type={field.kind === 'password' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
          autoComplete={field.kind === 'password' ? 'new-password' : undefined}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled || (field.kind === 'password' && field.secretRef !== undefined && secretWritable === false)}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          onChange={event => onChange(event.target.value)}
        />
      )}
      {field.kind === 'password' && field.secretRef !== undefined ? (
        <p className="dshst-field-hint">
          {secretConfigured === true ? t('secretConfiguredHint') : t('secretUnsetHint')}
        </p>
      ) : null}
      {hint}
      {errorLine}
    </div>
  )
}

function TagsField({ field, value, disabled, error, text, t, describedBy, onChange }: FieldProps & {
  describedBy?: string | undefined
}): React.ReactElement {
  const [draft, setDraft] = useState('')
  const tags = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  const add = (): void => {
    const next = draft.trim()
    if (next.length === 0) return
    if (!tags.includes(next)) onChange([...tags, next])
    setDraft('')
  }
  return (
    <div>
      <div className="dshst-tags">
        {tags.map(tag => (
          <span key={tag} className="dshst-tag-chip">
            <Tag tone="neutral">{tag}</Tag>
            <button
              type="button"
              className="dshst-tag-remove"
              aria-label={`${t('remove')} ${tag}`}
              disabled={disabled}
              onClick={() => onChange(tags.filter(entry => entry !== tag))}
            ><IconCloseOutlineRegular size={11} /></button>
          </span>
        ))}
      </div>
      <div className="dshst-tag-add" style={{ marginTop: tags.length === 0 ? 0 : 8 }}>
        <Input
          className="dshst-input"
          value={draft}
          aria-label={`${text(field.label)} ${t('add')}`}
          aria-describedby={describedBy}
          placeholder={'placeholder' in field ? field.placeholder : undefined}
          disabled={disabled}
          aria-invalid={error !== undefined}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); add() }
          }}
        />
        <Button size="sm" variant="outline" disabled={disabled} onClick={add}>{t('add')}</Button>
      </div>
    </div>
  )
}
