import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { routes } from '../../app/routes'
import logo from '../../assets/logo-reverse.png'
import { Avatar, Button } from '../../design-system'
import { useAuth } from '../../features/auth'

import { AdminNav } from './AdminNav'
import styles from './AdminSidebar.module.css'

export interface AdminSidebarProps {
  /** DS 07: expanded 248px (>= 1024), rail 72px (600-1023), drawer 300px (< 600). */
  variant: 'expanded' | 'rail' | 'drawer'
  onNavigate?: () => void
  /** Rendered in the drawer only, to close it. */
  closeButton?: ReactNode
}

const roleLabel = { ADMIN: 'Administrator', MEMBER: 'Member' } as const

/** The navy administration sidebar (DS 07), in its three shapes. */
export function AdminSidebar({ variant, onNavigate, closeButton }: AdminSidebarProps) {
  const { user, logout } = useAuth()
  const isRail = variant === 'rail'
  const name = user ? `${user.first_name} ${user.last_name}` : ''
  // Admin-Mobile-Nav names the drawer's identity block by where it leads -
  // "My profile" - where the expanded sidebar names the role.
  const inDrawer = variant === 'drawer'

  return (
    <div className={[styles.sidebar, styles[variant]].join(' ')}>
      {isRail ? null : (
        <div className={styles.head}>
          <NavLink to={routes.admin} className={styles.logoLink} onClick={onNavigate}>
            <img
              className={styles.logo}
              src={logo}
              alt="JEENISo — administration home"
              width={124}
              height={55}
            />
          </NavLink>
          {closeButton}
        </div>
      )}

      {isRail ? null : <p className={styles.overline}>ADMINISTRATION</p>}

      <AdminNav variant={variant} onNavigate={onNavigate} />

      {isRail ? (
        // Admin-Tablet: the rail ends with an icon-only Sign out; the identity
        // and My profile live in the top bar's account chip at this width.
        <div className={styles.railFoot}>
          <Button variant="ghost-dark" iconOnly iconLeft="logout" aria-label="Sign out" onClick={logout} />
        </div>
      ) : (
        <div className={styles.foot}>
          {user ? (
            // Account-Menus: "the user block in the sidebar is a link to My
            // profile; Sign out stays visible under it". Current on the
            // profile pages, drawn as a white block.
            <NavLink
              to={routes.adminProfile}
              onClick={onNavigate}
              aria-label={inDrawer ? `My profile — ${name}` : `My profile — ${name}, ${roleLabel[user.role]}`}
              className={({ isActive }) =>
                [styles.identity, styles.identityLink, isActive ? styles.identityCurrent : undefined]
                  .filter(Boolean)
                  .join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Avatar name={name} size={40} tone={isActive ? 'brand' : 'accent'} />
                  <span className={styles.identityText}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.role}>{inDrawer ? 'My profile' : roleLabel[user.role]}</span>
                  </span>
                </>
              )}
            </NavLink>
          ) : null}
          <div className={styles.signOut}>
            <Button variant="ghost-dark" iconLeft="logout" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
