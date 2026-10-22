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

export function StateDot({ state }: { state?: string }): React.ReactElement {
  return <span data-state={state} />
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
