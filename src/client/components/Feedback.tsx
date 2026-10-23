/** Small shared feedback surfaces for the settings page. */

import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

export function StatusChip({ tone, loading, label, title }: {
  tone: 'neutral' | 'success' | 'warning'
  loading: boolean
  label: string
  title?: string | undefined
}): React.ReactElement {
  const dot = loading ? 'ongoing' : tone === 'success' ? 'done' : tone === 'warning' ? 'warning' : 'idle'
  return (
    <span className="dshst-status-chip" data-tone={tone} title={title}>
      <StateDot state={dot} size={10} />
      <span>{label}</span>
    </span>
  )
}

export function Notice({ tone, icon, title, children }: {
  tone: 'info' | 'warning' | 'error'
  icon: React.ReactNode
  title?: string | undefined
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="dshst-notice" data-tone={tone} role={tone === 'error' ? 'status' : undefined}>
      <span className="dshst-notice-icon" aria-hidden="true">{icon}</span>
      <div className="dshst-notice-copy">
        {title === undefined ? null : <p><strong>{title}</strong></p>}
        {children}
      </div>
    </div>
  )
}
