/** Bundle-page warning shown while this plugin owns a built-in provider. */

import { useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StoredConfig } from '../shared/defaults.ts'
import { FETCH_PROVIDER, SEARCH_PROVIDER, type WebSelection } from './SettingsPage.tsx'

type TakeoverWarningProps = PropsRuntime<'plugins.detail.section'>
  & PropsLocale<'dsh-search-tools'>
  & { form: ConfigForm<StoredConfig>; web: ConfigForm<WebSelection> }

export function TakeoverWarning({ subject, form, web, t }: TakeoverWarningProps): React.ReactElement | null {
  const [busy, setBusy] = useState<'search' | 'fetch' | undefined>()
  const [error, setError] = useState<string | undefined>()
  const webSnapshot = useSyncExternalStore(
    listener => web.subscribe(listener),
    () => web.getSnapshot(),
    () => web.getSnapshot(),
  )
  const formSnapshot = useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  )
  if (subject.kind !== 'bundle' || !isThisPackage(subject.pkg.name)) return null
  const search = webSnapshot.value?.searchProvider === SEARCH_PROVIDER
  const fetch = webSnapshot.value?.fetchProvider === FETCH_PROVIDER
  if (!search && !fetch) return null

  const disable = async (kind: 'search' | 'fetch'): Promise<void> => {
    if (webSnapshot.writable === false || busy !== undefined) return
    setBusy(kind)
    setError(undefined)
    const activation = formSnapshot.value?.activation
    const previous = kind === 'search'
      ? activation?.previousSearchProvider ?? ''
      : activation?.previousFetchProvider ?? ''
    const key = kind === 'search' ? 'searchProvider' : 'fetchProvider'
    try {
      const ok = await web.mutate(
        previous.length === 0
          ? [{ op: 'unset', path: [key] }]
          : [{ op: 'set', path: [key], value: previous }],
        webSnapshot.revision,
      )
      if (!ok) setError(t('conflict'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('conflict'))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <section className="dshst-card">
      <div className="dshst-card-title">{t('takeoverWarningTitle')}</div>
      <p className="dshst-card-desc">{t('takeoverWarningText')}</p>
      <div className="dshst-actions">
        {search ? <Button size="sm" variant="outline" disabled={busy !== undefined} onClick={() => { void disable('search') }}>{t('disableSearchTakeover')}</Button> : null}
        {fetch ? <Button size="sm" variant="outline" disabled={busy !== undefined} onClick={() => { void disable('fetch') }}>{t('disableFetchTakeover')}</Button> : null}
      </div>
      {error === undefined ? null : <p className="dshst-field-error" role="alert">{error}</p>}
    </section>
  )
}

function isThisPackage(name: string): boolean {
  return name === 'dsh-search-tools' || name.endsWith('/dsh-search-tools')
}
