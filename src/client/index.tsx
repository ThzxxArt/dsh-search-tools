/** Client half: Settings → Search Tools and the `web_research` tool card. */

import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings-section slot and `ctx.configForms`.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
// Type-only: the Plugins page slots used by the status/takeover entry.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { StoredConfig } from '../shared/defaults.ts'
import { ActivationHint } from './ActivationHint.tsx'
import { ResearchCard } from './ResearchCard.tsx'
import { SettingsPage, type WebSelection } from './SettingsPage.tsx'
import { TakeoverWarning } from './TakeoverWarning.tsx'
import { NS, en, zh } from './locales.ts'
import { STYLES } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-search-tools': keyof typeof zh
  }
}

/** Cordis plugin name for the browser half. */
export const name = 'dsh-search-tools'

/** Services this browser half consumes. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-search-tools: dictionaries')
  const t = ctx.locale.bind(NS) as (key: string, params?: Record<string, unknown>) => string

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-search-tools'
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-search-tools: styles')

  const form = ctx.configForms.get<StoredConfig>('dsh-search-tools') as ConfigForm<StoredConfig>
  const web = ctx.configForms.get<WebSelection>('web') as ConfigForm<WebSelection>

  ctx.effect(() => ctx.configForms.whileServed(['dsh-search-tools'], () =>
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({
        name: 'settings.section',
        id: 'search-tools',
        order: 16,
        label: () => t('nav'),
        locale: NS,
      }, () => createElement(SettingsPage, {
        form, web, t, locale: ctx.locale, credentials: ctx.remote.credentials,
      })))), 'dsh-search-tools: settings page')

  ctx.slots.inject('plugins.bundle.activation', () =>
    ctx.slots.register({
      name: 'plugins.bundle.activation',
      key: 'dsh-search-tools',
      locale: NS,
    }, ActivationHint))

  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register({
      name: 'plugins.detail.section',
      id: 'search-tools-takeover',
      locale: NS,
    }, (props) => createElement(TakeoverWarning, { ...props, form, web })))

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'web_research',
      locale: NS,
    }, ResearchCard))
}
