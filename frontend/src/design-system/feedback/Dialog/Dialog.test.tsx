import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { setViewport } from '../../../test/viewport'
import { BottomBarContext } from '../BottomBar'
import { Dialog } from './Dialog'

/**
 * FE-MOBILE-01 (G29) - the modal shell's placement. Centred from 600px, as
 * before; a bottom sheet on a phone, as Admin-Member-Reset-Mobile draws it,
 * resting above the member shell's bottom bar when one is showing.
 *
 * jsdom evaluates no media query: the component decides the placement and
 * says so in `data-placement`, and the geometry is read from the rules that
 * attribute selects.
 */

function Harness({ long = false, onClose }: { long?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        labelledBy="dialog-title"
        onClose={() => {
          onClose?.()
          setOpen(false)
        }}
      >
        <h2 id="dialog-title">Reset password for this user?</h2>
        {long ? <p style={{ height: 2000 }}>A long explanation.</p> : null}
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button">Reset password</button>
      </Dialog>
    </>
  )
}

async function openAt(width: number, options: { bottomBar?: boolean; long?: boolean; onClose?: () => void } = {}) {
  setViewport(width)
  render(
    <BottomBarContext.Provider value={options.bottomBar ?? false}>
      <Harness long={options.long} onClose={options.onClose} />
    </BottomBarContext.Provider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  const dialog = screen.getByRole('dialog', { name: 'Reset password for this user?' })
  return { dialog, positioner: dialog.parentElement! }
}

describe('Dialog - placement', () => {
  it.each([
    ['1440', 1440],
    ['1024', 1024],
    ['768', 768],
    ['600', 600],
  ])('stays centred at %spx, as before', async (_name, width) => {
    const { dialog, positioner } = await openAt(width)

    expect(positioner).toHaveAttribute('data-placement', 'center')
    expect(getComputedStyle(positioner).alignItems).toBe('center')
    expect(getComputedStyle(positioner).justifyContent).toBe('center')
    // The desktop panel keeps its 6px corners and is not stretched.
    expect(getComputedStyle(dialog).borderRadius).toBe('var(--radius-md)')
    expect(getComputedStyle(dialog).width).not.toBe('100%')
  })

  it.each([
    ['599', 599],
    ['390', 390],
    ['375', 375],
  ])('is a bottom sheet at %spx', async (_name, width) => {
    const { dialog, positioner } = await openAt(width)

    expect(positioner).toHaveAttribute('data-placement', 'sheet')
    expect(getComputedStyle(positioner).alignItems).toBe('flex-end')
    // 16px gutters, 24px above the bottom edge and its safe area.
    expect(getComputedStyle(positioner).paddingLeft).toBe('var(--space-4)')
    expect(getComputedStyle(positioner).paddingRight).toBe('var(--space-4)')
    expect(getComputedStyle(positioner).paddingBottom).toBe(
      'calc(var(--space-6) + env(safe-area-inset-bottom, 0px))',
    )
    expect(getComputedStyle(dialog).width).toBe('100%')
    expect(getComputedStyle(dialog).borderRadius).toBe('var(--radius-lg)')
  })

  it('rests above the bottom bar on a phone while the shell shows one', async () => {
    const { positioner } = await openAt(390, { bottomBar: true })

    expect(positioner).toHaveAttribute('data-bottom-bar')
    expect(getComputedStyle(positioner).paddingBottom).toBe(
      'calc(var(--bottom-nav-h) + var(--space-6) + env(safe-area-inset-bottom, 0px))',
    )
  })

  it('ignores the bottom bar from 600px, where there is none to clear', async () => {
    const { positioner } = await openAt(600, { bottomBar: true })

    expect(positioner).not.toHaveAttribute('data-bottom-bar')
  })

  it('scrolls a panel taller than the screen inside itself', async () => {
    const { dialog } = await openAt(390, { long: true })

    expect(getComputedStyle(dialog).overflowY).toBe('auto')
    expect(getComputedStyle(dialog).maxHeight).toBe('100%')
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument()
  })
})

describe('Dialog - the same behaviour as a sheet', () => {
  it('moves focus in on open, to the first button', async () => {
    await openAt(390, { bottomBar: true })

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('keeps Tab inside the panel', async () => {
    await openAt(390)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Reset password' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to what opened it', async () => {
    const onClose = vi.fn()
    await openAt(390, { bottomBar: true, onClose })

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })
})
