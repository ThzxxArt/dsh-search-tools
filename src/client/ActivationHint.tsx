/** Guidance shown after the bundle is enabled from the Plugins page. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

type ActivationHintProps = PropsRuntime<'plugins.bundle.activation'> & PropsLocale<'dsh-search-tools'>

export function ActivationHint({ t, onDismiss }: ActivationHintProps): React.ReactElement {
  return (
    <section className="dshst-card">
      <div className="dshst-card-title">{t('activationTitle')}</div>
      <p className="dshst-card-desc">{t('activationHint')}</p>
      <div className="dshst-actions">
        <Button size="sm" variant="outline" onClick={onDismiss}>{t('activationDismiss')}</Button>
      </div>
    </section>
  )
}
