/** Lightweight stand-ins for the DSH primitives; component tests exercise page logic, not their CSS. */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string
  size?: string
  icon?: ReactNode
}>(({ variant: _variant, size: _size, icon, children, type = 'button', ...rest }, ref) => (
  <button ref={ref} type={type} {...rest}>{icon}{children}</button>
))
Button.displayName = 'TestButton'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  ({ icon: _icon, ...rest }, ref) => <input ref={ref} {...rest} />,
)
Input.displayName = 'TestInput'

export function Tag({ tone, children }: { tone?: string; className?: string; children?: ReactNode }): React.ReactElement {
  return <span data-tone={tone}>{children}</span>
}

export function StateDot({ state }: { state?: string; size?: number }): React.ReactElement {
  return <span data-state={state} />
}

export function Checkbox({ checked, label, disabled, onChange }: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={event => { onChange(event.target.checked) }}
      />
      {label}
    </label>
  )
}

export function Switch({ checked, label, disabled, onChange }: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => { onChange(!checked) }}
    />
  )
}

export function SegmentedTabs<Value extends string>({ items, value, onChange, label }: {
  items: readonly { value: Value; label: ReactNode; id: string; panelId: string }[]
  value: Value
  onChange: (value: Value) => void
  label: string
}): React.ReactElement {
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next === undefined) return
    event.preventDefault()
    const item = items[next]
    if (item === undefined) return
    onChange(item.value)
    queueMicrotask(() => { document.getElementById(item.id)?.focus() })
  }
  return (
    <div role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          id={item.id}
          aria-selected={value === item.value}
          aria-controls={item.panelId}
          tabIndex={value === item.value ? 0 : -1}
          onClick={() => { onChange(item.value) }}
          onKeyDown={event => { onKeyDown(event, index) }}
        >{item.label}</button>
      ))}
    </div>
  )
}

export function CodeBlock({ code }: { code: string }): React.ReactElement {
  return <pre>{code}</pre>
}

export function PathLabel({ path }: { path: string; className?: string }): React.ReactElement {
  return <span title={path}>{path}</span>
}

function Icon({ size = 16 }: { size?: number }): React.ReactElement {
  return <svg data-icon="true" width={size} height={size} />
}

export const IconSearchOutlineRegular = Icon
export const IconBrowseOutlineRegular = Icon
export const IconCloseCircleFillRegular = Icon
export const IconCopyOutlineRegular = Icon
export const IconGaugeOutlineRegular = Icon
export const IconInfoOutlineRegular = Icon
export const IconPlayOutlineRegular = Icon
export const IconRefreshOutlineRegular = Icon
export const IconSlidersTwoOutlineRegular = Icon
export const IconSparkleRegular = Icon
export const IconTrashOutlineRegular = Icon
export const IconWarningTriangleOutlineRegular = Icon
export const IconChevronDownOutlineRegular = Icon
export const IconChevronUpOutlineRegular = Icon
export const IconPlusOutlineRegular = Icon
export const IconCloseOutlineRegular = Icon
