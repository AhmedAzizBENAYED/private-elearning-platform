import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BottomBarContext } from '../BottomBar'
import { Toast } from './Toast'

/** DS 06: bottom-right, six seconds, paused on hover/focus, role status/alert. */
describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces a success politely and an error assertively', () => {
    const { rerender } = render(<Toast open title="Member created" onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Member created')

    rerender(<Toast open kind="error" title="We couldn’t archive the course" onDismiss={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t archive the course')
  })

  it('keeps its live region in the document while closed', () => {
    // A region inserted together with its text is not reliably announced.
    render(<Toast open={false} title="Member created" onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('dismisses itself after six seconds', () => {
    const onDismiss = vi.fn()
    render(<Toast open title="Member created" body="Sarra can now sign in." onDismiss={onDismiss} />)

    act(() => vi.advanceTimersByTime(5999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses while the pointer is over it, and resumes with the time left', () => {
    const onDismiss = vi.fn()
    render(<Toast open title="Member created" onDismiss={onDismiss} />)
    const card = screen.getByText('Member created').closest('div')!.parentElement!

    act(() => vi.advanceTimersByTime(4000))
    fireEvent.pointerEnter(card)
    act(() => vi.advanceTimersByTime(20_000))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.pointerLeave(card)
    act(() => vi.advanceTimersByTime(1999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses while focus is inside it, so Dismiss can be reached', () => {
    const onDismiss = vi.fn()
    render(<Toast open title="Member created" onDismiss={onDismiss} />)
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })

    act(() => dismiss.focus())
    act(() => vi.advanceTimersByTime(30_000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('closes on Dismiss', () => {
    const onDismiss = vi.fn()
    render(<Toast open title="Member created" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

/**
 * FE-MOBILE-01 (G29) - DS 06: "Toasts appear bottom-right (desktop) / above the
 * bottom bar (mobile)". The member shell says when its bar is mounted; jsdom
 * evaluates no media query, so the placement is read from the rule the
 * attribute selects.
 */
describe('Toast - above the bottom bar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const region = () => screen.getByRole('status')

  it('keeps the desktop placement where no bottom bar is showing', () => {
    render(<Toast open title="Member created" onDismiss={() => {}} />)

    expect(region()).not.toHaveAttribute('data-bottom-bar')
    expect(getComputedStyle(region()).bottom).toBe('calc(var(--space-6) + env(safe-area-inset-bottom, 0px))')
  })

  it('rises above the bar, and its safe area, while the shell shows one', () => {
    render(
      <BottomBarContext.Provider value>
        <Toast open title="Member created" onDismiss={() => {}} />
      </BottomBarContext.Provider>,
    )

    expect(region()).toHaveAttribute('data-bottom-bar')
    expect(getComputedStyle(region()).bottom).toBe(
      'calc(var(--bottom-nav-h) + var(--space-4) + env(safe-area-inset-bottom, 0px))',
    )
  })

  it('stays the same toast above the bar: role, content, Dismiss and timing', () => {
    const onDismiss = vi.fn()
    render(
      <BottomBarContext.Provider value>
        <Toast open title="Profile updated" body="Your changes have been saved." onDismiss={onDismiss} />
      </BottomBarContext.Provider>,
    )

    expect(region()).toHaveAttribute('aria-live', 'polite')
    expect(region()).toHaveTextContent('Profile updated')
    expect(region()).toHaveTextContent('Your changes have been saved.')
    act(() => vi.advanceTimersByTime(5999))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('places an error toast, and every toast of the page, the same way', () => {
    render(
      <BottomBarContext.Provider value>
        <Toast open title="Profile updated" onDismiss={() => {}} />
        <Toast open kind="error" title="We couldn’t archive the course" onDismiss={() => {}} />
      </BottomBarContext.Provider>,
    )

    expect(screen.getByRole('status')).toHaveAttribute('data-bottom-bar')
    expect(screen.getByRole('alert')).toHaveAttribute('data-bottom-bar')
  })
})
