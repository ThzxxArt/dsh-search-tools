// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AdapterListResponse, AdapterManifest, StatusResponse } from '../src/core/types.ts'
import { DEFAULT_STORED_CONFIG, type StoredConfig } from '../src/shared/defaults.ts'
import { en } from '../src/client/locales.ts'
import { SettingsPage, type WebSelection } from '../src/client/SettingsPage.tsx'
import { localDirectManifest } from '../src/search/adapters/local-direct/manifest.ts'
import { searxngManifest } from '../src/search/adapters/searxng/manifest.ts'
import { jinaReaderManifest } from '../src/fetch/adapters/jina-reader/manifest.ts'
import { readableHttpManifest } from '../src/fetch/adapters/readable-http/manifest.ts'
import { wireHttpManifest } from '../src/fetch/adapters/wire-http/manifest.ts'
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
  version: '0.1.8',
  configPath: '/tmp/cordis.patch.yml',
  search: { enabled: true, registered: true, available: false, adapter: 'searxng', instances: 0, sources: 0 },
  fetch: { enabled: true, registered: true, available: true, adapter: 'readable-http' },
  research: { enabled: true, registered: true },
  credentials: {},
  cache: { size: 0, hits: 0, misses: 0 },
  lastErrors: [],
}

const ADAPTERS: AdapterListResponse = {
  search: [searxngManifest, localDirectManifest],
  fetch: [readableHttpManifest, jinaReaderManifest, wireHttpManifest],
}

function translate(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
}

function createForm<T>(initial: T): {
  form: ConfigForm<T>
  mutate: ReturnType<typeof vi.fn>
  setSnapshot: (patch: Partial<ConfigFormSnapshot<T>>) => void
} {
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
  const setSnapshot = (patch: Partial<ConfigFormSnapshot<T>>): void => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  return {
    form: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      mutate: mutate as unknown as ConfigForm<T>['mutate'],
      set: vi.fn(async () => true) as unknown as ConfigForm<T>['set'],
      unset: vi.fn(async () => true) as unknown as ConfigForm<T>['unset'],
    },
    mutate,
    setSnapshot,
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

  it('shows a credential write failure at the field', async () => {
    const { credentials } = renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    await screen.findByText('Instances')
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'basic' } })
    const secret = await screen.findByLabelText('Basic username:password')
    fireEvent.change(secret, { target: { value: 'user:pass' } })
    credentials.set.mockRejectedValueOnce(new Error('vault locked'))
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }))

    expect(await screen.findByText('vault locked')).toBeInTheDocument()
    expect(screen.getByLabelText('Basic username:password')).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders the adapter picker as a radio group and switches backends', async () => {
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
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change backend' }))

    expect(await screen.findByRole('radiogroup', { name: 'Backend' })).toBeInTheDocument()
    const searxngCard = screen.getByRole('radio', { name: /SearXNG/ }).closest('label')
    expect(searxngCard).not.toBeNull()
    expect(within(searxngCard as HTMLElement).getByText('Needs setup')).toBeInTheDocument()
    const fixtureRadio = screen.getByRole('radio', { name: /Fixture/ })
    expect(fixtureRadio).not.toBeChecked()
    fireEvent.click(fixtureRadio)

    expect(fixtureRadio).toBeChecked()
    expect(await screen.findByLabelText('Endpoint')).toBeInTheDocument()
  })

  it('marks an adapter with an invalid instance as needing attention', async () => {
    const config: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      search: {
        adapter: 'searxng',
        adapters: { searxng: { instances: [{ url: 'ftp://invalid.example', enabled: true, label: '' }] } },
      },
    }
    renderPage(undefined, config)
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change backend' }))

    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /SearXNG/ })).toBeChecked()
  })

  it('keeps an orphaned adapter visible as not installed', async () => {
    const config: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      search: { adapter: 'ghost', adapters: { ghost: { endpoint: 'https://ghost.example' } } },
    }
    renderPage(undefined, config)
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))

    const ghost = await screen.findByRole('radio', { name: /ghost is not installed/ })
    expect(ghost).toBeChecked()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
  })

  it('reports a failed adapter refresh without dropping the current list', async () => {
    vi.mocked(fetchAdapters)
      .mockResolvedValueOnce(ADAPTERS)
      .mockRejectedValueOnce(new Error('offline'))
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change backend' }))
    await screen.findByRole('radiogroup', { name: 'Backend' })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh adapters' }))
    expect(await screen.findByText(/Could not refresh adapters: offline/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /SearXNG/ })).toBeInTheDocument()
  })

  it('refreshes the adapter list from the picker', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change backend' }))
    await screen.findByRole('radiogroup', { name: 'Backend' })
    expect(fetchAdapters).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh adapters' }))
    await waitFor(() => expect(fetchAdapters).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Adapters refreshed')).toBeInTheDocument()
  })

  it('previews the model-facing research prompt and updates its bounds', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Research' }))
    await screen.findByText('Maximum pages to read')

    const prompt = await screen.findByTestId('research-prompt')
    expect(prompt).toHaveTextContent('Search the web, fetch the top results')
    expect(prompt).toHaveTextContent('Default 8; range 1–8')
    expect(prompt).toHaveTextContent('Total content budget: 40,000 characters')

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum pages to read' }), { target: { value: '5' } })
    expect(prompt).toHaveTextContent('range 0–5')
  })

  it('shows the research prompt as disabled when web_research is off', async () => {
    const config: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      research: { ...DEFAULT_STORED_CONFIG.research, enabled: false },
    }
    renderPage(undefined, config)
    fireEvent.click(await screen.findByRole('tab', { name: 'Research' }))

    expect(await screen.findByText(/web_research is off/)).toBeInTheDocument()
    expect(screen.getByTestId('research-prompt')).toHaveTextContent('web_research')
  })

  it('runs a search test before enabling search takeover', async () => {
    const { web } = renderPage()
    await screen.findByRole('heading', { name: 'Search Tools' })

    fireEvent.click(screen.getByRole('switch', { name: 'Take over built-in search' }))
    await waitFor(() => expect(web.mutate).toHaveBeenCalled())

    expect(previewSearch).toHaveBeenCalledWith('searxng', 'DeepSeek Harness', expect.any(Object))
    expect(JSON.stringify(web.mutate.mock.calls)).toContain('dsh-search-tools')
  })

  it('surfaces unresponsive-engine notes in the search preview', async () => {
    vi.mocked(previewSearch).mockResolvedValue({
      ok: true,
      sources: [],
      notes: ['google: Suspended: access denied', 'duckduckgo: CAPTCHA'],
    })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test Enter a query' }))

    expect(await screen.findByText('Search notes')).toBeInTheDocument()
    expect(screen.getByText('google: Suspended: access denied')).toBeInTheDocument()
    expect(screen.getByText('duckduckgo: CAPTCHA')).toBeInTheDocument()
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

  it('uses the manifest instances key in the active takeover rule', async () => {
    const fixture: AdapterManifest = {
      kind: 'search',
      id: 'fixture',
      label: 'Fixture',
      description: 'A fixture adapter with a renamed instance field.',
      defaults: {},
      fields: [{ kind: 'instances', key: 'nodes', label: 'Nodes' }],
    }
    vi.mocked(fetchAdapters).mockResolvedValue({
      search: [searxngManifest, fixture],
      fetch: [readableHttpManifest],
    })
    const config: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      search: {
        adapter: 'fixture',
        adapters: { fixture: { nodes: [{ url: 'https://fixture.example', enabled: true, label: '' }] } },
      },
    }
    renderPage({ searchProvider: 'dsh-search-tools', fetchProvider: '' }, config)

    await screen.findByText('Search backend not configured')
    expect(screen.queryByText(/Cannot save without an enabled instance/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    expect(await screen.findByText('Configured')).toBeInTheDocument()
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

  it('shows a numeric field error immediately and blocks saving', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Search behavior' }))
    const pages = await screen.findByRole('spinbutton', { name: 'Pages' })
    fireEvent.change(pages, { target: { value: '4' } })

    expect((await screen.findAllByText('Pages cannot be larger than 3.')).length).toBeGreaterThan(0)
    expect(pages).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  })

  it('uses the live fetch availability in the hero status', async () => {
    renderPage()
    expect(await screen.findByText('Fetch: available')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Test Enter a query' }))
    await waitFor(() => expect(previewSearch).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: 'Example' })).toHaveAttribute('href', 'https://example.com/a')
    expect(screen.getByText('Test passed')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/a')).toBeInTheDocument()
  })

  it('renders fetch preview metadata and content', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Test Enter a URL' }))
    expect(await screen.findByText(/HTTP 200/)).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('renders fetch content in a copyable, collapsible reader', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Test Enter a URL' }))

    expect(await screen.findByText('Page content')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy content' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ok'))
    expect(await screen.findByRole('button', { name: 'Copy content' })).toHaveTextContent('Copied')

    fireEvent.click(screen.getByRole('button', { name: 'Hide content' }))
    expect(screen.queryByText('ok')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show content' }))
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('does not let an invalid search draft block the fetch test', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /^Search$/ }))
    await screen.findByText('Instances')
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))

    fireEvent.click(screen.getByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Test Enter a URL' }))
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

  it('shows a conflict notice when the form rejects a save', async () => {
    const { form } = renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable web_research' }))
    form.mutate.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }))

    expect((await screen.findAllByText(/Configuration changed elsewhere/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeEnabled()
  })

  it('renders unavailable and read-only states without hiding the page', async () => {
    const { form } = renderPage()
    act(() => { form.setSnapshot({ status: 'unavailable', writable: false }) })

    expect(await screen.findByText('Configuration service is unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()

    act(() => { form.setSnapshot({ status: 'ready', writable: false }) })
    expect(await screen.findByText(/Configuration is overridden by a higher layer/)).toBeInTheDocument()
  })

  it('copies a credential-free diagnostics summary from Diagnostics', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('dsh-search-tools 0.1.8')))
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('token-123')
    expect(screen.getByTestId('runtime-state')).toHaveTextContent('Fetch: available · Research: registered')
  })

  it('copies only the configuration path from the path action', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Copy configuration path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/tmp/cordis.patch.yml'))
  })

  it('groups adapter fields and keeps advanced settings collapsed', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))

    expect(await screen.findByRole('heading', { name: 'Connection' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Search behavior' }))
    expect(screen.getByRole('heading', { name: 'Search behavior' })).toBeInTheDocument()
    const advanced = screen.getByTestId('adapter-group-advanced')
    expect(advanced.tagName).toBe('DETAILS')
    expect(advanced).not.toHaveAttribute('open')
    expect(advanced).toHaveTextContent('11 fields')

    fireEvent.click(within(advanced).getByText('Advanced'))
    expect(advanced).toHaveAttribute('open')
    expect(within(advanced).getByLabelText('Request method')).toBeInTheDocument()
  })

  it('shows the projected research budget and copies the model-facing prompt', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Research' }))

    expect(await screen.findByText('36,000 / 40,000 chars')).toBeInTheDocument()
    expect(screen.getByText('30% of total')).toBeInTheDocument()
    expect(screen.getByText('4,000 chars remaining')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Search the web, fetch the top results')))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('keeps search validation out of the fetch tab while blocking save', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    await screen.findByText('Instances')
    fireEvent.click(screen.getByRole('button', { name: 'Add instance' }))
    expect((await screen.findAllByText('An enabled instance needs a URL.')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Fetch' }))
    expect(screen.queryByText('An enabled instance needs a URL.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
    expect(screen.getByText(/Some fields are invalid; fix them before saving\./)).toBeInTheDocument()
  })

  it('exposes tab semantics and arrow/Home/End navigation', async () => {
    renderPage()
    await screen.findByText('Search backend not configured')
    const search = screen.getByRole('tab', { name: 'Search' })
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'Fetch' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Fetch' })).toBeInTheDocument()

    const fetchTab = screen.getByRole('tab', { name: 'Fetch' })
    fireEvent.keyDown(fetchTab, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute('aria-selected', 'true')
    const diagnostics = screen.getByRole('tab', { name: 'Diagnostics' })
    fireEvent.keyDown(diagnostics, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Local Direct settings integration', () => {
  async function openLocalDirect(): Promise<void> {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change backend' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Local Direct/ }))
    await screen.findByText(/Runs locally/)
  }

  it('renders engine checkboxes, no instances, and the fixed public-engine boundary', async () => {
    await openLocalDirect()
    expect(screen.queryByText('Instances')).not.toBeInTheDocument()
    expect(screen.getByLabelText('DuckDuckGo')).toBeChecked()
    expect(screen.getByLabelText('Bing')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Test engines' })).toBeInTheDocument()
    expect(screen.getByText(/No SearXNG, Reader, API key, browser/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Search behavior' }))
    expect(screen.getByRole('spinbutton', { name: 'Results per host' })).toHaveValue(2)
    expect(screen.getByRole('combobox', { name: 'Safe search' })).toHaveValue('moderate')
  })

  it('probes engines without an instance and shows the reachable engines', async () => {
    vi.mocked(probeSearch).mockResolvedValue({
      ok: true,
      latencyMs: 7,
      engines: ['DuckDuckGo', 'Bing'],
    })
    await openLocalDirect()
    fireEvent.click(screen.getByRole('button', { name: 'Test engines' }))

    expect(await screen.findByText('Reachable engines')).toBeInTheDocument()
    expect(screen.getAllByText('DuckDuckGo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bing').length).toBeGreaterThan(0)
    expect(probeSearch).toHaveBeenCalledWith('local-direct', expect.any(Object))
  })

  it('shows a probe failure instead of silently accepting an empty engine list', async () => {
    vi.mocked(probeSearch).mockResolvedValue({
      ok: false,
      latencyMs: 12,
      code: 'LOCAL_DIRECT_ALL_FAILED',
      message: 'all local-direct engines failed',
    })
    await openLocalDirect()
    fireEvent.click(screen.getByRole('button', { name: 'Test engines' }))

    expect(await screen.findByText('No engine is available')).toBeInTheDocument()
    expect(screen.getByText('all local-direct engines failed')).toBeInTheDocument()
  })

  it('shows partial engine probe results and their notes', async () => {
    vi.mocked(probeSearch).mockResolvedValue({
      ok: true,
      latencyMs: 9,
      engines: ['DuckDuckGo'],
      message: 'Bing: engine request timed out',
    })
    await openLocalDirect()
    fireEvent.click(screen.getByRole('button', { name: 'Test engines' }))

    expect(await screen.findByText('Some engines are available')).toBeInTheDocument()
    expect(screen.getByText('Bing: engine request timed out')).toBeInTheDocument()
  })

  it('does not let a stale probe overwrite a newer draft', async () => {
    let resolveProbe!: (value: {
      ok: boolean
      latencyMs: number
      engines: string[]
    }) => void
    vi.mocked(probeSearch).mockReturnValue(new Promise((resolve) => {
      resolveProbe = resolve
    }))
    await openLocalDirect()
    fireEvent.click(screen.getByRole('button', { name: 'Test engines' }))
    fireEvent.click(screen.getByLabelText('Bing'))

    await act(async () => {
      resolveProbe({ ok: true, latencyMs: 7, engines: ['DuckDuckGo', 'Bing'] })
    })
    expect(screen.queryByText('Reachable engines')).not.toBeInTheDocument()
    expect(screen.queryByText('Some engines are available')).not.toBeInTheDocument()
  })

  it('uses sources rather than instance count for an engine-only backend', async () => {
    vi.mocked(fetchStatus).mockResolvedValue({
      ...STATUS,
      search: { ...STATUS.search, adapter: 'local-direct', sources: 2, available: true },
    })
    renderPage()
    expect(await screen.findByText('2 sources')).toBeInTheDocument()
    expect(screen.getByText('Search sources')).toBeInTheDocument()
  })

  it('treats an explicit empty adapter object as manifest defaults', async () => {
    const initial: StoredConfig = {
      ...DEFAULT_STORED_CONFIG,
      search: { adapter: 'local-direct', adapters: { 'local-direct': {} } },
    }
    renderPage(undefined, initial)
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    expect(await screen.findByLabelText('DuckDuckGo')).toBeChecked()
    expect(screen.getByLabelText('Bing')).toBeChecked()
    expect(screen.queryByText('Needs setup')).not.toBeInTheDocument()
  })

  it('saves a checkbox toggle and blocks saving with no engines', async () => {
    const { form } = renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Change backend' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Local Direct/ }))
    await screen.findByText(/Runs locally/)

    fireEvent.click(screen.getByLabelText('Bing'))
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }))
    await waitFor(() => expect(form.mutate).toHaveBeenCalled())
    expect(JSON.stringify(form.mutate.mock.calls)).toContain('"engines":["duckduckgo"]')

    fireEvent.click(screen.getByLabelText('DuckDuckGo'))
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
    expect(screen.getAllByText(/Enable at least one search engine/).length).toBeGreaterThan(0)
  })
})

describe('Wire HTTP settings integration', () => {
  async function openWire(): Promise<void> {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(await screen.findByRole('radio', { name: /Wire HTTP/ }))
    await screen.findByText(/Requests run locally/)
  }

  it('renders local-only notice, capabilities, and no secret field', async () => {
    await openWire()
    expect(screen.getByText('html')).toBeInTheDocument()
    expect(screen.getAllByText('pdf').length).toBeGreaterThan(0)
    expect(screen.getAllByText('readability').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Browser profile')).toHaveValue('chrome')
    expect(screen.getByLabelText('Local timeout (ms)')).toHaveValue(25000)
    expect(screen.getByLabelText('Extract PDF text')).toBeChecked()
    expect(screen.queryByLabelText('Jina API key')).not.toBeInTheDocument()
  })

  it('blocks save on an invalid article/body cap relationship', async () => {
    await openWire()
    fireEvent.change(screen.getByLabelText('Maximum article text characters'), { target: { value: '10000000' } })
    expect(await screen.findByLabelText('Maximum article text characters')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  })
})

describe('Jina Reader settings integration', () => {
  async function openJina(): Promise<void> {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(await screen.findByRole('radio', { name: /Jina Reader/ }))
    await screen.findByText(/The target URL leaves this machine/)
  }

  it('renders the manifest notice, browser/pdf capabilities, and Jina fields', async () => {
    await openJina()
    expect(screen.getByText('browser')).toBeInTheDocument()
    expect(screen.getAllByText('pdf').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Reader endpoint')).toHaveValue('https://r.jina.ai/')
    expect(screen.getByLabelText('Fetch engine')).toBeInTheDocument()
    expect(screen.getByLabelText('Response format')).toBeInTheDocument()
  })

  it('blocks save on an insecure remote endpoint', async () => {
    await openJina()
    fireEvent.change(screen.getByLabelText('Reader endpoint'), { target: { value: 'http://reader.example.com' } })
    expect(await screen.findByLabelText('Reader endpoint')).toHaveAttribute('aria-invalid', 'true')
    expect((await screen.findAllByText('A remote Reader endpoint must use HTTPS; only loopback may use HTTP.')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  })

  it('writes the Jina API key through credentials, not the config form', async () => {
    const { credentials, form } = renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /^Fetch$/ }))
    fireEvent.click(await screen.findByRole('radio', { name: /Jina Reader/ }))
    const secret = await screen.findByLabelText('Jina API key')
    fireEvent.change(secret, { target: { value: 'jina-token-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }))

    await waitFor(() => expect(credentials.set).toHaveBeenCalledWith('JINA_API_KEY', 'jina-token-123'))
    expect(JSON.stringify(form.mutate.mock.calls)).not.toContain('jina-token-123')
  })
})
