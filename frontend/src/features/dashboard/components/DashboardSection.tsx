import type { ReactNode } from 'react'

import styles from './DashboardSection.module.css'

export interface DashboardSectionProps {
  /** The large blue numeral the board prefixes each section with ("01"). */
  index: string
  title: string
  /** Optional right-hand action, e.g. "Browse all courses". */
  action?: ReactNode
  children: ReactNode
}

/**
 * One numbered dashboard section.
 *
 * The numeral is decorative: it is a visual index, not information, so it is
 * hidden from assistive technology and the heading carries the meaning.
 */
export function DashboardSection({ index, title, action, children }: DashboardSectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <div className={styles.heading}>
          <span className={styles.index} aria-hidden="true">
            {index}
          </span>
          <h2 className={styles.title}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
