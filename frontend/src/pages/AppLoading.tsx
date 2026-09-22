import logo from '../assets/logo-color.png'
import { Icon } from '../design-system'

import styles from './AppLoading.module.css'

/**
 * The bootstrap screen, shown while FE-02 restores the session.
 *
 * `role="status"` announces the wait once rather than leaving a screen reader
 * on a silent page; the spinner itself is decorative and stops under
 * `prefers-reduced-motion`.
 */
export function AppLoading() {
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <img className={styles.logo} src={logo} alt="JEENISo" width={148} height={66} />
      <Icon name="spinner" size={24} className={styles.spinner} />
      <p className={styles.label}>Loading your session…</p>
    </div>
  )
}
