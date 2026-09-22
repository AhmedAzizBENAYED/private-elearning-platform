import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Avatar, Icon } from '../../design-system'
import { useAuth } from '../../features/auth'

import styles from './UserMenu.module.css'

export interface UserMenuProps {
  /** `dark` is the navy sidebar/drawer; `light` is the white member header. */
  tone?: 'light' | 'dark'
  /**
   * Where "My profile" leads. The member header keeps the default; the
   * administration shell passes its own profile page (Admin-Tablet top bar).
   */
  profilePath?: string
  /**
   * The avatar alone, at every width: the learning page's tablet bar has no
   * room for the name and role (Learning-Tablet draws the chip only). Below
   * 600px the light chip is already avatar-only.
   */
  compact?: boolean
}

const roleLabel = { ADMIN: 'Administrator', MEMBER: 'Member' } as const

/**
 * The header's identity control (DS 07, Account-Menus board).
 *
 * The avatar chip opens a menu with "My profile" and "Sign out". It used to
 * offer Sign out only, because the Backend-Gaps board recorded no profile
 * endpoint; BE-PROFILE-01 added one, so the board's own menu is built.
 *
 * A minimal local menu rather than the design system's `Menu`: that primitive
 * is still deferred, and the shell needs one trigger with two items. It keeps
 * the behaviour the board requires - opening moves focus to the first item,
 * Up and Down move between items, Esc closes and returns focus to the chip, a
 * click outside dismisses.
 */
export function UserMenu({
  tone = 'light',
  profilePath = routes.profile,
  compact = false,
}: UserMenuProps) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close(true)
    }

    // The menu is a real `role="menu"`, so focus goes to its first item.
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  if (!user) return null

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  }

  const name = `${user.first_name} ${user.last_name}`

  return (
    <div
      className={[
        styles.container,
        tone === 'dark' ? styles.dark : undefined,
        compact ? styles.compact : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
      ref={containerRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Avatar name={name} size={40} tone={tone === 'dark' ? 'accent' : 'brand'} />
        <span className={styles.identity}>
          <span className={styles.name}>{name}</span>
          <span className={styles.role}>{roleLabel[user.role]}</span>
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} className={styles.chevron} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          className={styles.menu}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
        >
          <Link
            to={profilePath}
            role="menuitem"
            className={styles.item}
            onClick={() => close(false)}
          >
            <Icon name="user" size={18} />
            <span>My profile</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              logout()
            }}
          >
            <Icon name="logout" size={18} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
