import { NavLink } from 'react-router-dom'

import { memberNav } from '../../app/navigation'
import { routes } from '../../app/routes'
import { Icon, type IconName } from '../../design-system'

import styles from './MemberBottomNav.module.css'

/**
 * The mobile bottom bar (DS 07): 64px, "Dashboard · Courses · Account".
 *
 * The first two are the same routes the desktop header renders, read from the
 * one navigation config. "Account" opens the profile page (Account-Menus
 * board: "the Account tab opens the profile page, which ends with a Sign out
 * button"). It used to be a sign-out disclosure because no profile page
 * existed; BE-PROFILE-01 made one possible.
 *
 * The bar is hidden on the learning page, which the layout decides from the
 * route - see `MemberLayout`.
 */
const items: readonly { to: string; label: string; icon: IconName; end?: boolean }[] = [
  ...memberNav,
  { to: routes.profile, label: 'Account', icon: 'user' },
]

export function MemberBottomNav() {
  return (
    <div className={styles.container}>
      <nav className={styles.bar} aria-label="Main">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [styles.item, isActive ? styles.active : undefined].filter(Boolean).join(' ')
            }
          >
            <Icon name={item.icon} size={22} />
            <span className={styles.label}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
