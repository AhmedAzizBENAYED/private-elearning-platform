import { NavLink } from 'react-router-dom'

import { memberNav } from '../../app/navigation'
import { routes } from '../../app/routes'
import logo from '../../assets/logo-color.png'

import styles from './MemberHeader.module.css'
import { UserMenu } from './UserMenu'

/**
 * The member header (DS 07): 72px bar, logo left, navigation, user menu right.
 *
 * The active link is bold navy with a 3px blue underline - weight and shape as
 * well as colour, per the accessibility rules - and carries `aria-current`,
 * which `NavLink` sets from the real route match rather than from a prop
 * someone has to remember to pass.
 */
export interface MemberHeaderProps {
  /**
   * Whether the header carries the navigation. On a phone it does not: the
   * bottom bar is the "Main" landmark there, and rendering both would leave
   * two identically-named landmarks in the accessibility tree.
   */
  showNav?: boolean
}

export function MemberHeader({ showNav = true }: MemberHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <NavLink to={routes.dashboard} className={styles.logoLink}>
          <img className={styles.logo} src={logo} alt="JEENISo — home" width={120} height={53} />
        </NavLink>

        {showNav ? (
          <nav className={styles.nav} aria-label="Main">
            {memberNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [styles.link, isActive ? styles.active : undefined].filter(Boolean).join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>

      <UserMenu />
    </header>
  )
}
