/** Generic field renderer for adapter manifests. */

import { useState } from 'react'
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdapterField, JsonValue } from '../../core/types.ts'

export interface FieldProps {
  field: AdapterField
  value: unknown
  disabled?: boolean | undefined
  error?: string | undefined
  secretConfigured?: boolean | undefined
  secretWritable?: boolean | undefined
  onChange: (value: JsonValue) => void
}

export function Field({ field, value, disabled = false, error, secretConfigured, secretWritable, onChange }: FieldProps) {
  if (field.kind === 'instances') return null
  if (field.kind === 'boolean') {
    return (
      <div className="dshst-row">
        <label>{field.label}</label>
        <div>
          <Switch checked={value === true} label={field.label} disabled={disabled} onChange={onChange} />
          {field.description === undefined ? null : <p className="dshst-hint">{field.description}</p>}
          {error === undefined ? null : <p className="dshst-error">{error}</p>}
        </div>
      </div>
    )
  }
  if (field.kind === 'select') {
    return (
      <div className="dshst-row">
        <label htmlFor={`dshst-${field.key}`}>{field.label}</label>
        <div>
          <select
            id={`dshst-${field.key}`}
            value={typeof value === 'string' ? value : String(field.default ?? '')}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
          >
            {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {field.description === undefined ? null : <p className="dshst-hint">{field.description}</p>}
          {error === undefined ? null : <p className="dshst-error">{error}</p>}
        </div>
      </div>
    )
  }
  if (field.kind === 'number') {
    return (
      <div className="dshst-row">
        <label htmlFor={`dshst-${field.key}`}>{field.label}</label>
        <div>
          <Input
            id={`dshst-${field.key}`}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === 'number' ? String(value) : ''}
            disabled={disabled}
            onChange={(event) => {
              const next = Number(event.target.value)
              onChange(Number.isFinite(next) ? next : (field.default ?? 0))
            }}
          />
          {field.description === undefined ? null : <p className="dshst-hint">{field.description}</p>}
          {error === undefined ? null : <p className="dshst-error">{error}</p>}
        </div>
      </div>
    )
  }
  if (field.kind === 'tags') {
    return <TagsField field={field} value={value} disabled={disabled} error={error} onChange={onChange} />
  }
  return (
    <div className="dshst-row">
      <label htmlFor={`dshst-${field.key}`}>{field.label}</label>
      <div>
        <Input
          id={`dshst-${field.key}`}
          type={field.kind === 'password' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
          autoComplete={field.kind === 'password' ? 'new-password' : undefined}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled || (field.kind === 'password' && field.secretRef !== undefined && secretWritable === false)}
          onChange={event => onChange(event.target.value)}
        />
        {field.kind === 'password' && field.secretRef !== undefined ? (
          <p className="dshst-hint">
            {secretConfigured === true ? '已配置；输入新值会覆盖。' : '未配置；保存后写入 DSH 凭据存储，不写入 YAML。'}
          </p>
        ) : null}
        {field.description === undefined ? null : <p className="dshst-hint">{field.description}</p>}
        {error === undefined ? null : <p className="dshst-error">{error}</p>}
      </div>
    </div>
  )
}

function TagsField({ field, value, disabled, error, onChange }: FieldProps): React.ReactElement {
  const [draft, setDraft] = useState('')
  const tags = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  const add = (): void => {
    const next = draft.trim()
    if (next.length === 0) return
    if (!tags.includes(next)) onChange([...tags, next])
    setDraft('')
  }
  return (
    <div className="dshst-row">
      <label>{field.label}</label>
      <div>
        <div className="dshst-tags">
          {tags.map(tag => (
            <span key={tag} className="dshst-badge">
              <Tag>{tag}</Tag>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(tags.filter(entry => entry !== tag))}>×</Button>
            </span>
          ))}
        </div>
        <div className="dshst-actions">
          <Input
            value={draft}
            placeholder={'placeholder' in field ? field.placeholder : undefined}
            disabled={disabled}
            onChange={event => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); add() }
            }}
          />
          <Button size="sm" variant="outline" disabled={disabled} onClick={add}>添加</Button>
        </div>
        {field.description === undefined ? null : <p className="dshst-hint">{field.description}</p>}
        {error === undefined ? null : <p className="dshst-error">{error}</p>}
      </div>
    </div>
  )
}

export interface InstanceValue {
  url: string
  label: string
  enabled: boolean
}

export function InstanceEditor({ value, disabled, onChange }: {
  value: unknown
  disabled?: boolean
  onChange: (value: InstanceValue[]) => void
}): React.ReactElement {
  const instances = Array.isArray(value)
    ? value.filter((entry): entry is InstanceValue => typeof entry === 'object' && entry !== null && typeof (entry as InstanceValue).url === 'string')
    : []
  const update = (index: number, patch: Partial<InstanceValue>): void => {
    onChange(instances.map((entry, current) => current === index ? { ...entry, ...patch } : entry))
  }
  return (
    <div>
      {instances.length === 0 ? <p className="dshst-hint">还没有实例。</p> : null}
      {instances.map((instance, index) => (
        <div className="dshst-instance" key={`${instance.url}-${index}`}>
          <div className="dshst-instance-main">
            <Input
              aria-label={`实例 ${index + 1} 地址`}
              placeholder="https://searxng.example.com"
              value={instance.url}
              disabled={disabled}
              onChange={event => update(index, { url: event.target.value })}
            />
            <Input
              aria-label={`实例 ${index + 1} 备注`}
              placeholder="备注名"
              value={instance.label}
              disabled={disabled}
              onChange={event => update(index, { label: event.target.value })}
            />
          </div>
          <div className="dshst-actions">
            <Switch checked={instance.enabled} label={`启用实例 ${index + 1}`} disabled={disabled ?? false} onChange={checked => update(index, { enabled: checked })} />
            <Button size="sm" variant="ghost" disabled={disabled || index === 0} onClick={() => onChange(swap(instances, index, index - 1))}>↑</Button>
            <Button size="sm" variant="ghost" disabled={disabled || index === instances.length - 1} onClick={() => onChange(swap(instances, index, index + 1))}>↓</Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(instances.filter((_entry, current) => current !== index))}>×</Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...instances, { url: '', label: '', enabled: true }])}>添加实例</Button>
    </div>
  )
}

function swap(items: readonly InstanceValue[], left: number, right: number): InstanceValue[] {
  const copy = [...items]
  const item = copy[left]
  if (item === undefined) return copy
  copy[left] = copy[right] as InstanceValue
  copy[right] = item
  return copy
}
