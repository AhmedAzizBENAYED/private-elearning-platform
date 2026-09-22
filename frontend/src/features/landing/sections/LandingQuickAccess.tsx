import { Link } from 'react-router-dom'

import { LinkButton } from '../../../app/LinkButton'
import { routes } from '../../../app/routes'
import { Icon, type IconName } from '../../../design-system'
import { useAuth, type User } from '../../auth'
import landing from '../Landing.module.css'
import motion from '../motion.module.css'
import { primaryAction, profilePathFor } from '../sections'

import { SectionHeading, TiltZones } from './parts'
import styles from './Sections.module.css'

interface Shortcut {
  icon: IconName
  title: string
  body: string
  /** Where the card deep-links once signed in, and the name it then shows. */
  destination: (account: User) => { to: string; label: string }
}

/**
 * The four cards, as drawn. Signed in, DS 09: "cards deep-link to their page"
 * and "the label 'Sign in to open' becomes the destination name". The last
 * lesson and the progress per course are both on the member dashboard.
 */
const shortcuts: readonly Shortcut[] = [
  {
    icon: 'compass',
    title: 'Course catalogue',
    body: 'Browse every course published by the association and enroll in one click.',
    destination: () => ({ to: routes.courses, label: 'Courses' }),
  },
  {
    icon: 'play',
    title: 'Continue learning',
    body: 'Return to your last lesson and pick up right where you stopped.',
    destination: () => ({ to: routes.dashboard, label: 'Dashboard' }),
  },
  {
    icon: 'trending-up',
    title: 'My progress',
    body: 'See how many videos you completed in each course.',
    destination: () => ({ to: routes.dashboard, label: 'Dashboard' }),
  },
  {
    icon: 'user',
    title: 'My profile',
    body: 'Update your name and photo whenever you need to.',
    destination: (account) => ({ to: profilePathFor(account), label: 'My profile' }),
  },
]

/**
 * Quick access (no anchor on the boards): four one-link cards - the whole card
 * is the link - then the band for administrators. Four columns, two on a
 * tablet, one on a phone.
 */
export function LandingQuickAccess() {
  const { user, isAuthenticated } = useAuth()
  const account = isAuthenticated ? user : null
  const action = primaryAction(account)

  return (
    <section className={[styles.section, styles.gray].join(' ')} aria-labelledby="quick-access-title">
      <SectionHeading
        id="quick-access-title"
        overline="Quick access"
        title="Go straight to what you need"
        lede="Sign in once, then everything is one click away."
      />

      <div className={styles.quickGrid}>
        {shortcuts.map((shortcut) => {
          const target = account === null ? { to: routes.login, label: 'Sign in to open' } : shortcut.destination(account)
          return (
            <Link
              key={shortcut.title}
              to={target.to}
              className={[styles.quickCard, styles.tilt, motion.reveal, motion.pop].join(' ')}
            >
              <span className={[styles.roundTile, motion.draw].join(' ')} aria-hidden="true">
                <Icon name={shortcut.icon} size={24} drawable />
              </span>
              <h3 className={styles.cardTitle}>{shortcut.title}</h3>
              <p className={styles.cardBody}>{shortcut.body}</p>
              <span className={styles.quickFoot}>
                {account === null ? <Icon name="lock" size={14} /> : null}
                <span className={styles.quickLabel}>{target.label}</span>
                <Icon name="arrow-right" size={16} className={styles.quickArrow} />
              </span>
              <TiltZones />
            </Link>
          )
        })}
      </div>

      <div className={[styles.adminBand, motion.reveal].join(' ')}>
        <span className={styles.adminIcon} aria-hidden="true">
          <Icon name="shield" size={24} />
        </span>
        <div className={styles.adminText}>
          <h3 className={styles.cardTitle}>You are an administrator?</h3>
          <p className={styles.cardBody}>
            Use the same sign-in. The admin area opens automatically for administrator accounts:
            manage members, build courses, upload lessons and publish them.
          </p>
        </div>
        <LinkButton to={action.to} variant="secondary" iconRight="arrow-right" className={landing.lift}>
          {action.label}
        </LinkButton>
      </div>
    </section>
  )
}
