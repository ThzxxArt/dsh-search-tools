// @vitest-environment jsdom

import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActivationHint } from '../src/client/ActivationHint.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./helpers/primitives.tsx'))

function translate(key: string): string {
  return (en as Record<string, string>)[key] ?? key
}

describe('ActivationHint', () => {
  it('renders the adapter-neutral guidance and dismisses', () => {
    const onDismiss = vi.fn()
    const props = { t: translate, onDismiss } as unknown as Parameters<typeof ActivationHint>[0]
    const { container } = render(createElement(ActivationHint, props))

    expect(screen.getByText('Search Tools is enabled')).toBeInTheDocument()
    expect(screen.getByText(/choose a backend, finish its configuration, and test it/i)).toBeInTheDocument()
    expect(container.querySelector('.dshst-activation')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
