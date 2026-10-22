// @vitest-environment jsdom

import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TakeoverWarning } from '../src/client/TakeoverWarning.tsx'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./helpers/primitives.tsx'))

function translate(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
}

function createForm<T>(value: T): { form: ConfigForm<T>; mutate: ReturnType<typeof vi.fn> } {
  const snapshot = { status: 'ready' as const, value, base: value, user: undefined, revision: 1, writable: true }
  const mutate = vi.fn(async () => true)
  return {
    form: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      mutate: mutate as unknown as ConfigForm<T>['mutate'],
      set: vi.fn(async () => true) as unknown as ConfigForm<T>['set'],
      unset: vi.fn(async () => true) as unknown as ConfigForm<T>['unset'],
    },
    mutate,
  }
}

describe('TakeoverWarning', () => {
  it('recognizes a scoped package and restores the previous search provider', async () => {
    const form = createForm<StoredConfig>({
      ...DEFAULT_STORED_CONFIG,
      activation: { previousSearchProvider: 'deepseek-official', previousFetchProvider: '' },
    })
    const web = createForm({ searchProvider: 'dsh-search-tools', fetchProvider: '' })
    const props = {
      subject: { kind: 'bundle', pkg: { name: '@thzxxart/dsh-search-tools' } },
      form: form.form,
      web: web.form,
      t: translate,
    } as unknown as React.ComponentProps<typeof TakeoverWarning>

    render(createElement(TakeoverWarning, props))
    expect(screen.getByText('Search Tools is taking over')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Disable search takeover' }))

    await waitFor(() => expect(web.mutate).toHaveBeenCalled())
    expect(web.mutate).toHaveBeenCalledWith(
      [{ op: 'set', path: ['searchProvider'], value: 'deepseek-official' }],
      1,
    )
  })
})
