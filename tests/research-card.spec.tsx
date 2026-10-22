// @vitest-environment jsdom

import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResearchCard } from '../src/client/ResearchCard.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./helpers/primitives.tsx'))

function translate(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
}

function renderCard(phase: 'preparing' | 'start' | 'result', block: Record<string, unknown>): void {
  const props = {
    t: translate,
    phase,
    block,
  } as unknown as React.ComponentProps<typeof ResearchCard>
  render(createElement(ResearchCard, props))
}

describe('ResearchCard', () => {
  it('renders the settled research card from presentation meta', () => {
    renderCard('result', {
      args: { query: 'DeepSeek Harness' },
      meta: {
        query: 'DeepSeek Harness',
        sourceCount: 2,
        sources: [
          { url: 'https://example.com/a', title: 'Example result', domain: 'example.com' },
          { url: 'https://example.com/b', title: 'Second result', domain: 'example.com' },
        ],
        fetched: [
          { url: 'https://example.com/a', title: 'Fetched page', chars: 1200 },
          { url: 'https://example.com/b', title: 'Failed page', chars: 0, error: 'HTTP 404' },
        ],
        truncated: true,
      },
    })

    expect(screen.getByText('DeepSeek Harness')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Example result' })).toHaveAttribute('href', 'https://example.com/a')
    expect(screen.getByText('2 sources')).toBeInTheDocument()
    expect(screen.getByText('1/2 fetched')).toBeInTheDocument()
    expect(screen.getByText('truncated')).toBeInTheDocument()
    expect(screen.getByText('External content untrusted')).toBeInTheDocument()
    expect(screen.getByText(/Fetched page/)).toBeInTheDocument()
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument()
  })

  it('reports a clean fetched count when every page succeeded', () => {
    renderCard('result', {
      args: { query: 'all good' },
      meta: {
        query: 'all good',
        sources: [{ url: 'https://example.com/a', title: 'A' }],
        fetched: [
          { url: 'https://example.com/a', title: 'A', chars: 1200 },
          { url: 'https://example.com/b', title: 'B', chars: 800 },
        ],
      },
    })
    expect(screen.getByText('2 fetched')).toBeInTheDocument()
    expect(screen.queryByText(/\/2 fetched/)).not.toBeInTheDocument()
  })

  it('falls back to the compact row before the result', () => {
    renderCard('start', { args: { query: 'still running' } })
    expect(screen.getByText('still running')).toBeInTheDocument()
    expect(screen.getByText('Search + fetch')).toBeInTheDocument()
  })

  it('falls back when presentation meta is missing or malformed', () => {
    renderCard('result', { args: { query: 'no meta' }, meta: 'not-an-object' })
    expect(screen.getByText('no meta')).toBeInTheDocument()
    expect(screen.getByText('Search + fetch')).toBeInTheDocument()
  })

  it('drops malformed source entries without throwing', () => {
    renderCard('result', {
      args: { query: 'partial meta' },
      meta: {
        query: 'partial meta',
        sources: [null, { url: 42, title: true }, { url: 'https://example.com/ok', title: 'OK' }],
        fetched: 'not-an-array',
      },
    })
    expect(screen.getByText('partial meta')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OK' })).toHaveAttribute('href', 'https://example.com/ok')
    expect(screen.getByText('1 sources')).toBeInTheDocument()
  })

  it('never renders a non-http source as a link', () => {
    renderCard('result', {
      args: { query: 'unsafe meta' },
      meta: {
        query: 'unsafe meta',
        sources: [{ url: 'javascript:alert(1)', title: 'Unsafe source' }],
      },
    })
    expect(screen.getByText('Unsafe source')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Unsafe source' })).not.toBeInTheDocument()
  })
})
