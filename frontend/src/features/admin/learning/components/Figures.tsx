import type { ReactNode } from 'react'

import type { LearningCounts } from '../api'

import styles from '../Learning.module.css'

/**
 * The figure cards and the status split (DS 11 "Figures", "Charts").
 *
 * Every number here is one the backend returned. Nothing is summed over the
 * page that happens to be loaded: `counts` covers the whole filtered set.
 */

export function Stat({
  label,
  value,
  caption,
}: {
  label: string
  value: ReactNode
  caption?: string
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {caption === undefined ? null : <span className={styles.statCaption}>{caption}</span>}
    </div>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className={styles.stats}>{children}</div>
}

/**
 * Completed / in progress / not started as one bar plus its legend.
 *
 * A table of the same three numbers always sits beside it on these screens, and
 * each part carries its words in the legend, so nothing depends on colour.
 */
export function StatusSplit({ counts, label }: { counts: LearningCounts; label: string }) {
  const total = Math.max(1, counts.all)
  const parts = [
    { key: 'completed', label: 'Completed', value: counts.completed, className: styles.splitCompleted },
    {
      key: 'in_progress',
      label: 'In progress',
      value: counts.in_progress,
      className: styles.splitInProgress,
    },
    {
      key: 'not_started',
      label: 'Not started',
      value: counts.not_started,
      className: styles.splitNotStarted,
    },
  ]

  return (
    <div>
      <div className={styles.split} role="img" aria-label={label}>
        {parts.map((part) =>
          part.value === 0 ? null : (
            <span
              key={part.key}
              className={[styles.splitPart, part.className].join(' ')}
              style={{ width: `${(part.value / total) * 100}%` }}
            />
          ),
        )}
      </div>
      <ul className={styles.legend}>
        {parts.map((part) => (
          <li key={part.key} className={styles.legendItem}>
            <span className={[styles.legendSwatch, part.className].join(' ')} aria-hidden="true" />
            {part.label} {part.value}
          </li>
        ))}
      </ul>
    </div>
  )
}
