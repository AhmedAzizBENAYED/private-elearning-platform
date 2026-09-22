import { useCallback, useEffect, useRef, type ReactNode } from 'react'

import { Icon, type IconName } from '../../icons'
import { Button } from '../../primitives/Button'
import { useBottomBar } from '../BottomBar'

import styles from './Toast.module.css'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastProps {
  /** Shown while true. The live region itself is always in the document. */
  open: boolean
  kind?: ToastKind
  title: string
  body?: ReactNode
  onDismiss: () => void
  /** How long it stays, in milliseconds. DS 06: six seconds. */
  duration?: number
}

const glyph: Record<ToastKind, IconName> = {
  success: 'check-circle',
  error: 'alert',
  info: 'info',
}

/**
 * A short confirmation that something happened (DS 06).
 *
 * The board's rules, each of them here: bottom-right on desktop and full
 * width on a phone, above the bottom bar when the shell shows one; six seconds; the countdown pauses
 * while the pointer is over it or focus is inside it, so it cannot vanish
 * while someone is reading or reaching for Dismiss; announced with
 * `role="status"`, or `role="alert"` for an error; and never the only path to
 * anything - it only confirms what the page already shows.
 *
 * The live region stays mounted and only its content changes, because a
 * region inserted together with its text is not reliably announced.
 */
export function Toast({
  open,
  kind = 'success',
  title,
  body,
  onDismiss,
  duration = 6000,
}: ToastProps) {
  const remaining = useRef(duration)
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aboveBottomBar = useBottomBar()

  const stop = useCallback(() => {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
    remaining.current -= Date.now() - startedAt.current
  }, [])

  const start = useCallback(() => {
    if (timer.current !== null) return
    startedAt.current = Date.now()
    timer.current = setTimeout(onDismiss, Math.max(remaining.current, 0))
  }, [onDismiss])

  useEffect(() => {
    if (!open) return
    remaining.current = duration
    start()
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [open, duration, start])

  return (
    <div
      className={styles.region}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      data-bottom-bar={aboveBottomBar ? '' : undefined}
    >
      {open ? (
        <div
          className={[styles.toast, styles[kind]].join(' ')}
          onPointerEnter={stop}
          onPointerLeave={start}
          onFocus={stop}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) start()
          }}
        >
          <span className={styles.glyph} aria-hidden="true">
            <Icon name={glyph[kind]} size={20} />
          </span>
          <div className={styles.text}>
            <p className={styles.title}>{title}</p>
            {body ? <p className={styles.body}>{body}</p> : null}
          </div>
          <Button
            variant="tertiary"
            size="sm"
            iconOnly
            iconLeft="x"
            aria-label="Dismiss"
            onClick={onDismiss}
          />
        </div>
      ) : null}
    </div>
  )
}
