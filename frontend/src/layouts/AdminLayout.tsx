import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { routes } from '../app/routes'
import { Button } from '../design-system'
import { media, useMediaQuery } from '../shared/useMediaQuery'

import { AdminSidebar } from './components/AdminSidebar'
import { BrandStrip } from './components/BrandStrip'
import { UserMenu } from './components/UserMenu'
import styles from './AdminLayout.module.css'

/**
 * The administration shell (DS 07).
 *
 * The sidebar has three shapes and they are genuinely different structures, so
 * exactly one is mounted at a time rather than all three being hidden with CSS:
 *
 *   >= 1024   expanded 248px
 *   600-1023  icon rail 72px
 *   < 600     drawer 300px, opened from the header's menu button
 *
 * To the right sits the 72px white bar the board puts above the content; it
 * holds the breadcrumb slot the feature tickets will fill.
 */
export interface AdminLayoutProps {
  /**
   * Rendered instead of the routed outlet, so a shell-level page (404) can keep
   * the administration navigation around it.
   */
  children?: ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const isPhone = useMediaQuery(media.belowSm)
  const isLaptopUp = useMediaQuery(media.mdAndUp)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Captured from the click rather than through a ref, so the design system's
  // Button needs no ref forwarding for the shell's sake.
  const triggerRef = useRef<HTMLElement | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const closeDrawer = useCallback((returnFocus: boolean) => {
    setDrawerOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const openDrawer = useCallback((event: MouseEvent<HTMLElement>) => {
    triggerRef.current = event.currentTarget
    setDrawerOpen(true)
  }, [])

  // The drawer exists on phones only, so a resize past the breakpoint closes
  // it. Derived during render rather than synchronised in an effect: an effect
  // would render the open drawer once at the wrong width and then correct it.
  const showDrawer = isPhone && drawerOpen

  useEffect(() => {
    if (!showDrawer) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer(true)
    }
    document.addEventListener('keydown', onKeyDown)
    // Move focus into the panel so the keyboard follows the eye.
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus()

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showDrawer, closeDrawer])

  return (
    <div className={styles.shell}>
      {/* First thing in the tab order, so the sidebar can be skipped instead
          of traversed on every route (WCAG 2.4.1). */}
      <a className="dsSkipLink" href="#main">
        Skip to content
      </a>
      <BrandStrip />

      <div className={styles.body}>
        {isPhone ? null : <AdminSidebar variant={isLaptopUp ? 'expanded' : 'rail'} />}

        <div className={styles.content}>
          <div className={styles.topBar}>
            {isPhone ? (
              <Button
                variant="tertiary"
                iconOnly
                iconLeft="menu"
                aria-label="Open menu"
                aria-expanded={showDrawer}
                onClick={openDrawer}
              />
            ) : null}
            {/* Breadcrumb slot: filled by the feature tickets that own the pages. */}
            {isPhone || isLaptopUp ? null : (
              // Admin-Tablet: the rail has no room for the identity block, so
              // the account chip sits at the right of the top bar and opens
              // My profile / Sign out, as the member header's does.
              <div className={styles.account}>
                <UserMenu profilePath={routes.adminProfile} />
              </div>
            )}
          </div>

          <main id="main" tabIndex={-1} className={styles.main}>
            <div className={styles.container}>{children ?? <Outlet />}</div>
          </main>
        </div>
      </div>

      {showDrawer ? (
        <>
          <div
            className={styles.scrim}
            aria-hidden="true"
            onPointerDown={() => closeDrawer(false)}
          />
          <div
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Administration menu"
          >
            <AdminSidebar
              variant="drawer"
              onNavigate={() => closeDrawer(false)}
              closeButton={
                <Button
                  variant="ghost-dark"
                  iconOnly
                  iconLeft="x"
                  aria-label="Close menu"
                  onClick={() => closeDrawer(true)}
                />
              }
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
