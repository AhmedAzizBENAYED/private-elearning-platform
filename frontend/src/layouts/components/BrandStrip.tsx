import styles from './BrandStrip.module.css'

/**
 * The charte brand strip that opens every screen.
 *
 * Purely decorative, so it is hidden from assistive technology. `className`
 * lets a screen whose boards draw it differently at a width - the landing
 * header's 6px strip on tablet - adjust it without a second strip.
 */
export function BrandStrip({ className }: { className?: string }) {
  return (
    <div className={[styles.strip, className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className={styles.accent} />
      <div className={styles.muted} />
    </div>
  )
}
