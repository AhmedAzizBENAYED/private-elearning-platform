import { useEffect, useRef, type ReactNode } from 'react'

import { media, useMediaQuery } from '../../responsive'
import { useBottomBar } from '../BottomBar'
import styles from './Dialog.module.css'

export interface DialogProps {
  /** Rendered only while true; the dialog holds no state of its own. */
  open: boolean
  /** Escape and a press on the scrim call this - unless `busy`. */
  onClose: () => void
  /**
   * A request is in flight: Escape and the scrim do nothing, so the dialog
   * cannot be dismissed out from under an operation it started.
   */
  busy?: boolean
  /** The id of the element that names the dialog - its heading. */
  labelledBy: string
  /** The id of the element that explains it, when there is one. */
  describedBy?: string
  /**
   * Where focus lands on open, as a selector inside the panel. Defaults to
   * the first button, which for a confirmation is the cancelling one; a form
   * passes its first field instead.
   */
  initialFocus?: string
  /** `narrow` (480px) for a confirmation, `wide` (520px) for a form. */
  width?: 'narrow' | 'wide'
  children: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The modal shell (DS 06 "Modal / ConfirmDialog").
 *
 * The design system names one component for both, and this is the part they
 * share: the scrim, the centred panel, and the behaviour the Handoff board
 * requires of every modal - `role="dialog"` with `aria-modal`, named by its
 * heading, focus moved in on open and returned to whatever opened it on close,
 * Escape closes, Tab cannot walk out into the page behind.
 *
 * `ConfirmDialog` is this shell with a title, a body and two buttons. A form
 * dialog is this shell with a form. Neither re-implements the focus handling.
 *
 * On a phone the panel is a bottom sheet, as Admin-Member-Reset-Mobile draws
 * it: full width inside a 16px gutter, 24px above the bottom edge - or above
 * the bottom bar, when the shell shows one - and scrolling inside itself when
 * it is taller than the screen. Only the placement changes; the behaviour is
 * the same at every width.
 */
export function Dialog({
  open,
  onClose,
  busy = false,
  labelledBy,
  describedBy,
  initialFocus = 'button',
  width = 'narrow',
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const sheet = useMediaQuery(media.belowSm)
  const aboveBottomBar = useBottomBar()

  // Opening and closing only. `busy` is deliberately NOT a dependency here:
  // it flips the moment an action starts, and re-running this effect would
  // fire the cleanup below - sending focus back to the trigger *behind* the
  // open dialog, mid-operation - and then capture a control inside the panel
  // as the "opener", so the eventual close would restore focus to a node
  // that no longer exists.
  useEffect(() => {
    if (!open) return

    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>(initialFocus)?.focus()

    return () => {
      // The opener may have gone - an empty state replaced by the row it
      // produced. Focusing a detached node does nothing useful.
      if (opener?.isConnected) opener.focus()
    }
    // `initialFocus` is a constant selector at every call site, so listing it
    // never re-runs this effect while the dialog is open.
  }, [open, initialFocus])

  // The key handler reads `busy`, so it is re-registered when `busy` changes.
  // Adding and removing a listener has no side effect; moving focus does,
  // which is why the two are separate effects.
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return

      // Wrap at both ends, so Tab cannot walk out into the page behind.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <>
      {/* Decorative: closing from the keyboard is Escape, and the scrim is
          not a control a screen reader should find. */}
      <div className={styles.scrim} aria-hidden="true" onPointerDown={busy ? undefined : onClose} />

      <div
        className={styles.positioner}
        data-placement={sheet ? 'sheet' : 'center'}
        data-bottom-bar={sheet && aboveBottomBar ? '' : undefined}
      >
        <div
          ref={panelRef}
          className={[styles.panel, width === 'wide' ? styles.wide : undefined]
            .filter(Boolean)
            .join(' ')}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
        >
          {children}
        </div>
      </div>
    </>
  )
}
