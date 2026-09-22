import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { LinkButton } from '../../app/LinkButton'
import { routes } from '../../app/routes'
import logo from '../../assets/logo-color.png'
import { Avatar, Button, Icon } from '../../design-system'
import { BrandStrip } from '../../layouts/components/BrandStrip'
import { media, useMediaQuery } from '../../shared/useMediaQuery'
import { useAuth } from '../auth'

import styles from './Landing.module.css'
import { CONTACT_EMAIL, landingSections, primaryAction, profilePathFor } from './sections'
import { useActiveSection } from './useActiveSection'

const SECTION_IDS = landingSections.map((section) => section.id)

const roleLabel = { ADMIN: 'Administrator', MEMBER: 'Member' } as const

/**
 * The landing header (Landing, Landing-Tablet, Landing-Mobile,
 * Landing-Mobile-Menu and DS 09 "Landing header" boards).
 *
 * Brand strip, then a 76px white bar (68px on a phone), kept at the top while
 * the page scrolls. From 1024px: logo, the in-page anchors and the primary
 * action. Below: logo, the primary action and a menu button that opens the
 * anchors in a panel under the bar.
 *
 * Signed in, the action becomes "Go to my dashboard" ("Dashboard" on a phone)
 * and, on desktop, the avatar links to My profile.
 *
 * The link of the section being read is marked (DS 09 "mark the current
 * one"), in the bar and in the menu. While the page scrolls, a thin bar under
 * the header shows how far, and the header tightens - both in CSS.
 */
export function LandingHeader() {
  const { user, isAuthenticated } = useAuth()
  const account = isAuthenticated ? user : null
  const isDesktop = useMediaQuery(media.mdAndUp)
  const isPhone = useMediaQuery(media.belowSm)
  const action = primaryAction(account)
  const current = useActiveSection(SECTION_IDS)

  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLElement | null>(null)
  const menuId = useId()
  // The menu exists below 1024px only: widening the window closes it.
  const showMenu = !isDesktop && menuOpen

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuOpen(false)
    if (returnFocus) toggleRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!showMenu) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showMenu, closeMenu])

  return (
    <header className={styles.header}>
      <BrandStrip className={styles.strip} />
      <div className={styles.bar}>
        <div className={styles.barStart}>
          <Link to={routes.home} className={styles.logoLink}>
            <img className={styles.logo} src={logo} alt="JEENISo — home" width={124} height={55} />
          </Link>

          {isDesktop ? (
            <nav className={styles.nav} aria-label="Main">
              {landingSections.map((section) => (
                <a
                  key={section.id}
                  className={[styles.navLink, section.id === current ? styles.navLinkCurrent : undefined]
                    .filter(Boolean)
                    .join(' ')}
                  href={`#${section.id}`}
                  aria-current={section.id === current ? 'true' : undefined}
                >
                  {section.label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        <div className={styles.barEnd}>
          <LinkButton
            to={action.to}
            iconLeft={account === null ? 'login' : undefined}
            iconRight={account !== null && !isPhone ? 'arrow-right' : undefined}
            className={styles.lift}
          >
            {isPhone ? action.shortLabel : action.label}
          </LinkButton>

          {isDesktop && account !== null ? (
            <Link
              to={profilePathFor(account)}
              className={styles.account}
              aria-label={`My profile — ${account.first_name} ${account.last_name}`}
            >
              <Avatar name={`${account.first_name} ${account.last_name}`} size={40} tone="brand" />
              <span className={styles.accountText}>
                <span className={styles.accountName}>
                  {account.first_name} {account.last_name}
                </span>
                <span className={styles.accountRole}>{roleLabel[account.role]}</span>
              </span>
              <Icon name="chevron-down" size={18} className={styles.accountChevron} />
            </Link>
          ) : null}

          {isDesktop ? null : (
            <Button
              variant="tertiary"
              iconOnly
              iconLeft={showMenu ? 'x' : 'menu'}
              aria-label={showMenu ? 'Close menu' : 'Open menu'}
              className={styles.lift}
              aria-expanded={showMenu}
              aria-controls={showMenu ? menuId : undefined}
              onClick={(event) => {
                toggleRef.current = event.currentTarget
                setMenuOpen((open) => !open)
              }}
            />
          )}
        </div>
        <div className={styles.scrollBar} aria-hidden="true" />
      </div>

      {showMenu ? (
        <>
          <div className={styles.menu} id={menuId}>
            <nav aria-label="Main">
              {landingSections.map((section) => (
                <a
                  key={section.id}
                  className={[styles.menuItem, section.id === current ? styles.menuItemCurrent : undefined]
                    .filter(Boolean)
                    .join(' ')}
                  href={`#${section.id}`}
                  aria-current={section.id === current ? 'true' : undefined}
                  onClick={() => closeMenu(false)}
                >
                  <span>{section.label}</span>
                  <Icon name="chevron-right" size={20} />
                </a>
              ))}
            </nav>
            <div className={styles.menuFoot}>
              <LinkButton
                to={action.to}
                size="lg"
                iconLeft={account === null ? 'login' : undefined}
                className={[styles.fullWidth, styles.lift].join(' ')}
              >
                {action.label}
              </LinkButton>
              {account === null ? (
                <p className={styles.menuNote}>
                  Accounts are created by an administrator. Need access?{' '}
                  <a className={styles.menuMail} href={`mailto:${CONTACT_EMAIL}`}>
                    {CONTACT_EMAIL}
                  </a>
                </p>
              ) : null}
            </div>
          </div>
          <div className={styles.scrim} aria-hidden="true" onPointerDown={() => closeMenu(false)} />
        </>
      ) : null}
    </header>
  )
}
