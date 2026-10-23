/** Non-adapter setting rows used by the Research tab. */

import { useId } from 'react'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './Field.tsx'

export function BooleanRow({ t, label, hint, checked, disabled, onChange }: {
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

export function NumberRow({ label, value, min, max, step, unit, hint, disabled, onChange }: {
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
