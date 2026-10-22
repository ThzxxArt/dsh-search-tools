// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AdapterListResponse, AdapterManifest, StatusResponse } from '../src/core/types.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'
import { en } from '../src/client/locales.ts'
import { SettingsPage, type WebSelection } from '../src/client/SettingsPage.tsx'
import { searxngManifest } from '../src/search/adapters/searxng/manifest.ts'
import { readableHttpManifest } from '../src/fetch/adapters/readable-http/manifest.ts'
import { fetchAdapters, fetchStatus, previewFetch, previewSearch, probeSearch } from '../src/client/api.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./helpers/primitives.tsx'))

vi.mock('../src/client/api.ts', () => ({
  fetchStatus: vi.fn(),
  fetchAdapters: vi.fn(),
  previewSearch: vi.fn(),
  previewFetch: vi.fn(),
  probeSearch: vi.fn(),
  clearCache: vi.fn(),
  clearDiagnostics: vi.fn(),
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

function renderPage(
  webInitial: WebSelection = { searchProvider: '', fetchProvider: '' },
  formInitial: StoredConfig = DEFAULT_STORED_CONFIG,
): {
  form: ReturnType<typeof createForm<StoredConfig>>
  web: ReturnType<typeof createForm<WebSelection>>
  credentials: { describe: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; unset: ReturnType<typeof vi.fn> }
} {
  const form = createForm(formInitial)
  const web = createForm<WebSelection>(webInitial)
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
  vi.mocked(previewFetch).mockResolvedValue({ ok: true, url: 'https://example.com', statusCode: 200, kind: 'text', content: 'ok', chars: 2 })
  vi.mocked(probeSearch).mockResolvedValue({ ok: true, latencyMs: 5 })
})

describe('SettingsPage', () => {
  it('renders the settings surface and saves an edited instance through the form', async () => {
    const { form } = renderPage()
    expect(await screen.findByRole('heading', { name: 'Search Tools' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
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

  it('requires an enabled instance for the active instance-based adapter', async () => {
    renderPage({ searchProvider: 'dsh-search-tools', fetchProvider: '' })
    expect((await screen.findAllByText(/Cannot save without an enabled instance while takeover is active/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  })

  it('does not require instances for a non-instance external adapter', async () => {
    const fixture: AdapterManifest = {
      kind: 'search',
      id: 'fixture',
      label: 'Fixture',
      description: 'A fixture adapter without instance rows.',
      defaults: {},
      fields: [{ kind: 'text', key: 'endpoint', label: 'Endpoint' }],
    }
    vi.mocked(fetchAdapters).mockResolvedValue({
      search: [searxngManifest, fixture],
      fetch: [readableHttpManifest],
    })
    const config: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      search: { adapter: 'fixture', adapters: { fixture: { endpoint: 'https://fixture.example' } } },
    }
    renderPage({ searchProvider: 'dsh-search-tools', fetchProvider: '' }, config)

    await screen.findByText('Search backend not configured')
    expect(screen.queryByText(/Cannot save without an enabled instance/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /^Search$/ }))
    fireEvent.change(await screen.findByLabelText('Endpoint'), { target: { value: 'https://fixture.example/v2' } })
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeEnabled()
  })

  it('localizes invalid adapter issues and blocks saving', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    await screen.findByText('Instances')
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))

    const errors = await screen.findAllByText('An enabled instance needs a URL.')
    expect(errors.length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Instance 1 URL')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  })

  it('renders the agent-facing research settings and persists a changed budget', async () => {
    const { form } = renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Research' }))
    expect(await screen.findByText('Maximum pages to read')).toBeInTheDocument()

    const maxFetch = screen.getByRole('spinbutton', { name: 'Maximum pages to read' })
    fireEvent.change(maxFetch, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }))
    await waitFor(() => expect(form.mutate).toHaveBeenCalled())
    expect(JSON.stringify(form.mutate.mock.calls)).toContain('"maxFetch":5')
  })

  it('runs a search test from the Search tab and renders structured sources', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    await screen.findByText('Instances')

    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    await waitFor(() => expect(previewSearch).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: 'Example' })).toHaveAttribute('href', 'https://example.com/a')
    expect(screen.getByText('Test passed')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/a')).toBeInTheDocument()
  })

  it('renders fetch preview metadata and content', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Test$/ }))
    expect(await screen.findByText(/HTTP 200/)).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('does not let an invalid search draft block the fetch test', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /^Search$/ }))
    await screen.findByText('Instances')
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))

    fireEvent.click(screen.getByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Test$/ }))
    await waitFor(() => expect(previewFetch).toHaveBeenCalled())
    expect(await screen.findByText('Test passed')).toBeInTheDocument()
  })

  it('saves with Ctrl+S while the draft is valid and dirty', async () => {
    const { form } = renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    await screen.findByText('Instances')
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))
    fireEvent.change(screen.getByLabelText('Instance 1 URL'), { target: { value: 'https://searx.example.com' } })

    fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    await waitFor(() => expect(form.mutate).toHaveBeenCalled())
  })

  it('copies a credential-free diagnostics summary from Advanced', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('dsh-search-tools 0.1.0')))
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('token-123')
  })

  it('exposes tab semantics and arrow-key navigation', async () => {
    renderPage()
    await screen.findByText('Search backend not configured')
    const search = screen.getByRole('tab', { name: 'Search' })
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'Fetch' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Fetch' })).toBeInTheDocument()
  })
})
