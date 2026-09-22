import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { routes } from '../../../../app/routes'

import styles from '../Learning.module.css'

/**
 * The three tabs of the learning-progress screens (Admin-Progress).
 *
 * Real links, not a tablist: each tab is its own route, so it can be shared,
 * bookmarked and reached with Back. `aria-current="page"` is what says which
 * one is open - the same way the admin sidebar marks the current section.
 */
const TABS = [
  { to: routes.adminLearning, label: 'Progress', end: true },
  { to: routes.adminLearningActivity, label: 'Activity', end: false },
  { to: routes.adminLearningCourses, label: 'By course', end: false },
]

export interface LearningShellProps {
  /** The board's one-line description under the title. */
  lede: string
  /** Rendered at the right of the title row (the Matrix/List switch). */
  action?: ReactNode
  children: ReactNode
}

/** Title, rule and tabs - the frame the three tab screens share. */
export function LearningShell({ lede, action, children }: LearningShellProps) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Learning progress</h1>
          <p className={styles.subtitle}>{lede}</p>
        </div>
        {action}
      </header>
      <div className={styles.rule} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>

      <nav className={styles.tabs} aria-label="Learning progress views">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [styles.tab, isActive ? styles.tabCurrent : undefined].filter(Boolean).join(' ')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  )
}
