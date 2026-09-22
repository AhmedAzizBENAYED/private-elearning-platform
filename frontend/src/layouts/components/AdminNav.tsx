import { NavLink } from 'react-router-dom'

import { adminNav } from '../../app/navigation'
import { Icon } from '../../design-system'

import styles from './AdminNav.module.css'

export interface AdminNavProps {
  /**
   * `rail` renders icons only, so each link carries its label as `aria-label`
   * (DS 07: "Rail 72 px - icons + aria-label").
   */
  variant: 'expanded' | 'rail' | 'drawer'
  onNavigate?: () => void
}

/**
 * The admin navigation links, shared by all three sidebar shapes.
 *
 * One component and one config, so the rail cannot drift from the expanded
 * sidebar. The active item is a white pill with navy bold text - shape and
 * weight, not colour alone - and `NavLink` derives both that and `aria-current`
 * from the real route match.
 */
export function AdminNav({ variant, onNavigate }: AdminNavProps) {
  const isRail = variant === 'rail'

  return (
    // The name is the same in every shape, including the rail, where the
    // items themselves are icons and rely on their own aria-label.
    <nav className={[styles.nav, styles[variant]].join(' ')} aria-label="Admin">
      {adminNav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          aria-label={isRail ? item.label : undefined}
          className={({ isActive }) =>
            [styles.item, isActive ? styles.active : undefined].filter(Boolean).join(' ')
          }
        >
          <Icon name={item.icon} size={variant === 'expanded' ? 20 : 22} />
          {isRail ? null : <span className={styles.label}>{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  )
}
