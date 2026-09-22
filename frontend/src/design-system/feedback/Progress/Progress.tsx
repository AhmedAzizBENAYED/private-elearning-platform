import styles from './Progress.module.css'

/** Bar thicknesses used across the boards: 4 and 6 inline, 8 and 10 on pages. */
export type ProgressSize = 4 | 6 | 8 | 10

export interface ProgressProps {
  /** 0-100. Values outside the range are clamped rather than overflowing. */
  value: number
  size?: ProgressSize
  /**
   * Accessible name for the bar. Also shown above it when `showHeader` is set.
   * Required, because a bar with no name tells a screen reader nothing.
   */
  label: string
  /** Renders the label and the percentage above the track (DS 06). */
  showHeader?: boolean
  /**
   * Visible header text, when it should differ from the accessible name. The
   * cards show a plain "Progress" while the bar is still named after its
   * course, so a screen reader is told which course it belongs to.
   */
  headerLabel?: string
  /** Small line under the track, e.g. "5 of 11 videos completed". */
  caption?: string
  /**
   * The work is running but its extent is unknown.
   *
   * An upload before its first measurement, or one whose size the browser
   * cannot compute, can say that it is running and nothing more. The bar then
   * animates, drops `aria-valuenow`, as ARIA specifies for an indeterminate
   * state, and shows no percentage, rather than inventing one.
   */
  indeterminate?: boolean
  className?: string
}

/** Determinate progress bar (DS 06). */
export function Progress({
  value,
  size = 8,
  label,
  showHeader = false,
  headerLabel,
  caption,
  indeterminate = false,
  className,
}: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  const rounded = Math.round(clamped)
  const complete = clamped >= 100

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      {showHeader ? (
        <div className={styles.head}>
          <span className={styles.label}>{headerLabel ?? label}</span>
          {indeterminate ? null : <span className={styles.value}>{rounded}%</span>}
        </div>
      ) : null}

      <div
        className={styles.track}
        style={{ height: `${size}px` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : rounded}
        aria-label={label}
      >
        <div
          className={[
            styles.fill,
            indeterminate ? styles.indeterminate : undefined,
            !indeterminate && complete ? styles.complete : undefined,
          ]
            .filter(Boolean)
            .join(' ')}
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>

      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </div>
  )
}
