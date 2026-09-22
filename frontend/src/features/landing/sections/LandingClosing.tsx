import { LinkButton } from '../../../app/LinkButton'
import banner from '../../../assets/banner.jpg'
import { useAuth } from '../../auth'
import landing from '../Landing.module.css'
import motion from '../motion.module.css'
import { CONTACT_EMAIL, primaryAction } from '../sections'

import styles from './Sections.module.css'

/**
 * The closing call to action (no anchor on the boards): "Ready to start
 * learning?" on the banner photo under the navy band, with the one primary
 * action and, for a visitor, who to ask for an account. Side by side from
 * 1024px, stacked below.
 */
export function LandingClosing() {
  const { user, isAuthenticated } = useAuth()
  const account = isAuthenticated ? user : null
  const action = primaryAction(account)

  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <img className={styles.closingPhoto} src={banner} alt="" />
      <div className={styles.closingShade} aria-hidden="true" />
      <div className={[styles.closingSquare, landing.float2].join(' ')} aria-hidden="true" />
      <div className={styles.closingContent}>
        <div className={[styles.closingText, motion.reveal].join(' ')}>
          <h2 id="closing-title" className={styles.closingTitle}>
            Ready to start learning?
          </h2>
          <p className={styles.closingLede}>Sign in with your account to open your courses.</p>
        </div>
        <div className={[styles.closingActions, motion.reveal].join(' ')}>
          <LinkButton
            to={action.to}
            variant="on-dark"
            size="lg"
            iconLeft={account === null ? 'login' : undefined}
            iconRight={account === null ? undefined : 'arrow-right'}
            className={[styles.closingButton, landing.lift, landing.glow].join(' ')}
          >
            {action.label}
          </LinkButton>
          {account === null ? (
            <p className={styles.closingNote}>
              No account yet? Ask an administrator:{' '}
              <a className={styles.closingMail} href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
