// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AdapterListResponse, StatusResponse } from '../src/core/types.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'
import { en } from '../src/client/locales.ts'
import { SettingsPage, type WebSelection } from '../src/client/SettingsPage.tsx'
import { searxngManifest } from '../src/search/adapters/searxng/manifest.ts'
import { readableHttpManifest } from '../src/fetch/adapters/readable-http/manifest.ts'
import { fetchAdapters, fetchStatus, previewSearch, probeSearch } from '../src/client/api.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./helpers/primitives.tsx'))

vi.mock('../src/client/api.ts', () => ({
  fetchStatus: vi.fn(),
  fetchAdapters: vi.fn(),
  previewSearch: vi.fn(),
  previewFetch: vi.fn(),
  probeSearch: vi.fn(),
  clearCache: vi.fn(),
}))

const STATUS: StatusResponse = {
  version: '0.1.0',
  configPath: '/tmp/cordis.patch.yml',
  search: { enabled: true, registered: true, available: false, adapter: 'searxng', instances: 0 },
  fetch: { enabled: true, registered: true, adapter: 'readable-http' },
  research: { enabled: true, registered: true },
  credentials: {},
  cache: { size: 0, hits: 0, misses: 0 },
  lastErrors: [],
}

const ADAPTERS: AdapterListResponse = {
  search: [searxngManifest],
  fetch: [readableHttpManifest],
}

function translate(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
}

function createForm<T>(initial: T): { form: ConfigForm<T>; mutate: ReturnType<typeof vi.fn> } {
  let snapshot: ConfigFormSnapshot<T> = {
    status: 'ready',
    value: structuredClone(initial),
    base: structuredClone(initial),
    user: undefined,
    revision: 1,
    writable: true,
  }
  const listeners = new Set<() => void>()
  const mutate = vi.fn(async (ops: readonly unknown[]) => {
    const draft = structuredClone(snapshot.value) as Record<string, unknown>
    for (const raw of ops) {
      const op = raw as { op?: string; path?: readonly string[]; value?: unknown }
      const section = op.path?.[0]
      if (section === undefined || op.path === undefined || op.path.length !== 1) continue
      if (op.op === 'unset') delete draft[section]
      if (op.op === 'set') draft[section] = structuredClone(op.value)
    }
    snapshot = { ...snapshot, value: draft as T, revision: (snapshot.revision ?? 0) + 1 }
    for (const listener of listeners) listener()
    return true
  })
  return {
    form: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      mutate: mutate as unknown as ConfigForm<T>['mutate'],
      set: vi.fn(async () => true) as unknown as ConfigForm<T>['set'],
      unset: vi.fn(async () => true) as unknown as ConfigForm<T>['unset'],
    },
    mutate,
  }
}

function renderPage(): {
  form: ReturnType<typeof createForm<StoredConfig>>
  web: ReturnType<typeof createForm<WebSelection>>
  credentials: { describe: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; unset: ReturnType<typeof vi.fn> }
} {
  const form = createForm(DEFAULT_STORED_CONFIG)
  const web = createForm<WebSelection>({ searchProvider: '', fetchProvider: '' })
  const credentials = {
    describe: vi.fn(async (refs: string[]) => ({
      ok: true,
      value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    })),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
  const localeSnapshot = { active: 'en' }
  const locale = {
    resolveText: (value: string | { en: string }) => typeof value === 'string' ? value : value.en,
    getSnapshot: () => localeSnapshot,
    subscribe: () => () => {},
  }
  render(
    <SettingsPage
      form={form.form}
      web={web.form}
      credentials={credentials}
      t={translate}
      locale={locale}
    />,
  )
  return { form, web, credentials }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchStatus).mockResolvedValue(STATUS)
  vi.mocked(fetchAdapters).mockResolvedValue(ADAPTERS)
  vi.mocked(previewSearch).mockResolvedValue({ ok: true, sources: [{ url: 'https://example.com/a', title: 'Example' }] })
  vi.mocked(probeSearch).mockResolvedValue({ ok: true, latencyMs: 5 })
})

describe('SettingsPage', () => {
  it('renders the settings surface and saves an edited instance through the form', async () => {
    const { form } = renderPage()
    expect(await screen.findByRole('heading', { name: 'Search Tools' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Instances')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))
    fireEvent.change(screen.getByLabelText('Instance 1 URL'), { target: { value: 'https://searx.example.com' } })
    fireEvent.change(screen.getByLabelText('Instance 1 label'), { target: { value: 'Home' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }))
    await waitFor(() => expect(form.mutate).toHaveBeenCalled())
    expect(JSON.stringify(form.mutate.mock.calls)).toContain('https://searx.example.com')
  })

  it('writes bearer credentials through the credentials face, never through the form', async () => {
    const { credentials, form } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Instances')

    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'bearer' } })
    const secret = await screen.findByLabelText('Bearer token')
    fireEvent.change(secret, { target: { value: 'token-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }))

    await waitFor(() => expect(credentials.set).toHaveBeenCalledWith('SEARXNG_TOKEN', 'token-123'))
    expect(JSON.stringify(form.mutate.mock.calls)).not.toContain('token-123')
  })

  it('runs a search test before enabling search takeover', async () => {
    const { web } = renderPage()
    await screen.findByRole('heading', { name: 'Search Tools' })

    fireEvent.click(screen.getByRole('button', { name: 'Take over built-in search' }))
    await waitFor(() => expect(web.mutate).toHaveBeenCalled())

    expect(previewSearch).toHaveBeenCalledWith('searxng', 'DeepSeek Harness', expect.any(Object))
    expect(JSON.stringify(web.mutate.mock.calls)).toContain('dsh-search-tools')
  })

  it('localizes invalid adapter issues and blocks saving', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Instances')
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))

    const errors = await screen.findAllByText('An enabled instance needs a URL.')
    expect(errors.length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  })

  it('renders the agent-facing research settings and persists a changed budget', async () => {
    const { form } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Research' }))
    expect(await screen.findByText('Maximum pages to read')).toBeInTheDocument()

    const maxFetch = screen.getByRole('spinbutton', { name: 'Maximum pages to read' })
    fireEvent.change(maxFetch, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }))
    await waitFor(() => expect(form.mutate).toHaveBeenCalled())
    expect(JSON.stringify(form.mutate.mock.calls)).toContain('"maxFetch":5')
  })
})
