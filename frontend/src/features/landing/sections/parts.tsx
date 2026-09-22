import type { ReactNode } from 'react'

import { Icon } from '../../../design-system'

import motion from '../motion.module.css'

import styles from './Sections.module.css'

export interface SectionHeadingProps {
  /** Id of the h2, which the section is labelled by. */
  id: string
  overline: string
  title: string
  lede?: ReactNode
  /** Rises as it scrolls in; off where the whole column already does. */
  reveal?: boolean
}

/**
 * The head every landing section opens with (Landing boards): an uppercase
 * overline, the section's h2, the short two-tone rule, and an optional lede.
 */
export function SectionHeading({ id, overline, title, lede, reveal = true }: SectionHeadingProps) {
  return (
    <div className={[styles.heading, reveal ? motion.reveal : undefined].filter(Boolean).join(' ')}>
      <p className={styles.overline}>{overline}</p>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      <div className={[styles.rule, motion.line].join(' ')} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>
      {lede === undefined ? null : <p className={styles.lede}>{lede}</p>}
    </div>
  )
}

/**
 * The three hover zones that tilt a card towards the third under the pointer
 * (Landing boards). Transparent, and only laid out where there is a pointer.
 */
export function TiltZones() {
  return (
    <span className={styles.tiltZones} aria-hidden="true">
      <span className={styles.zoneLeft} />
      <span className={styles.zoneCentre} />
      <span className={styles.zoneRight} />
    </span>
  )
}

/** A short list of ticked statements (Platform, and each preview panel). */
export function CheckList({ items, size = 'md' }: { items: readonly string[]; size?: 'md' | 'sm' }) {
  return (
    <ul className={[styles.checks, size === 'sm' ? styles.checksSm : undefined].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <li key={item} className={styles.check}>
          <Icon name="check-circle" size={size === 'sm' ? 20 : 22} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
