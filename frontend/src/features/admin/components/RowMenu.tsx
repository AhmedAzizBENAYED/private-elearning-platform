import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { Icon, type IconName } from '../../../design-system'

import styles from './RowMenu.module.css'

export type RowMenuItem =
  | { kind: 'link'; label: string; icon: IconName; to: string; state?: unknown }
  | { kind: 'action'; label: string; icon: IconName; onSelect: () => void }
  | { kind: 'separator' }

export interface RowMenuProps {
  /** The trigger's accessible name, e.g. "More actions for Sarra Mansour". */
  label: string
  /** The menu's accessible name, e.g. "Actions for Sarra Mansour". */
  menuLabel: string
  items: readonly RowMenuItem[]
  /**
   * `plain` is the table's 44px icon button; `outlined` is the bordered one the
   * mobile cards draw (Admin-Mobile-Courses).
   */
  appearance?: 'plain' | 'outlined'
}

/** Room the menu needs below its trigger before it opens upwards instead. */
const MENU_ROOM = 200

/**
 * A row's "More actions" menu (Admin-Members-Menu, Admin-Courses).
 *
 * A small local menu, as the header's account menu is (the design system has
 * no menu primitive): focus moves to the first item on opening, Up and Down
 * move between items, Home and End jump, Escape closes and returns focus to
 * the trigger, a click outside dismisses, Tab leaves. It is placed `fixed`
 * next to its trigger because a table sits in a horizontal scroller that
 * would clip an absolutely placed menu; it closes on scroll and resize rather
 * than drifting away from the row.
 *
 * An action item closes the menu and puts focus back on the trigger before it
 * runs, so a dialog it opens returns focus to a control that still exists.
 */
export function RowMenu({ label, menuLabel, items, appearance = 'plain' }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Placed before paint, so the menu never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) return
    const rect = triggerRef.current.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - rect.right)
    setPosition(
      window.innerHeight - rect.bottom < MENU_ROOM
        ? { right, bottom: window.innerHeight - rect.top + 4 }
        : { right, top: rect.bottom + 4 },
    )
  }, [open])

  useEffect(() => {
    if (!open) return

    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close(true)
    }
    function onMove() {
      close(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, close])

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = entries.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (event.key === 'ArrowDown') next = entries[(index + 1) % entries.length]
    else if (event.key === 'ArrowUp') next = entries[(index - 1 + entries.length) % entries.length]
    else if (event.key === 'Home') next = entries[0]
    else if (event.key === 'End') next = entries.at(-1)
    else if (event.key === 'Tab') {
      // Leaving the menu closes it; focus carries on from the trigger.
      close(false)
      return
    } else return
    event.preventDefault()
    next?.focus()
  }

  return (
    <div className={styles.container}>
      <button
        ref={triggerRef}
        type="button"
        className={[
          styles.trigger,
          appearance === 'outlined' ? styles.outlined : undefined,
          open ? styles.triggerOpen : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name="more" size={20} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className={styles.menu}
          style={position}
          role="menu"
          aria-label={menuLabel}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => {
            if (item.kind === 'separator') {
              return <div key={`separator-${index}`} className={styles.separator} role="separator" />
            }
            const content = (
              <>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </>
            )
            return item.kind === 'link' ? (
              <Link
                key={item.label}
                to={item.to}
                state={item.state}
                role="menuitem"
                className={styles.item}
                onClick={() => close(false)}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  close(true)
                  item.onSelect()
                }}
              >
                {content}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
