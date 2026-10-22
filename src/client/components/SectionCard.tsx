/** Shared settings card: icon, title, description, optional aside, and body. */

import type { ReactNode } from 'react'

export function SectionCard({ icon, title, description, aside, children, className = '' }: {
  icon?: ReactNode
  title: string
  description?: string | undefined
  aside?: ReactNode
  children: ReactNode
  className?: string | undefined
}): React.ReactElement {
  return (
    <section className={`dshst-card ${className}`.trim()}>
      <div className="dshst-card-head">
        {icon === undefined ? null : <span className="dshst-card-icon" aria-hidden="true">{icon}</span>}
        <div className="dshst-card-copy">
          <h3 className="dshst-card-title">{title}</h3>
          {description === undefined ? null : <p className="dshst-card-desc">{description}</p>}
        </div>
        {aside === undefined ? null : <div className="dshst-card-aside">{aside}</div>}
      </div>
      <div className="dshst-card-body">{children}</div>
    </section>
  )
}
