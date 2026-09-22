import { LinkButton } from '../../../app/LinkButton'
import photo from '../../../assets/thumb-3.jpg'
import { useAuth } from '../../auth'
import landing from '../Landing.module.css'
import motion from '../motion.module.css'
import { primaryAction } from '../sections'

import { CheckList, SectionHeading } from './parts'
import styles from './Sections.module.css'

/**
 * The platform (`#platform`): what the platform is, three ticks and a call to
 * start, beside a photo with a caption band over a blue offset block. Side by
 * side from 1024px, stacked below (Landing-Tablet, Landing-Mobile).
 */
export function LandingPlatform() {
  const { user, isAuthenticated } = useAuth()
  const account = isAuthenticated ? user : null
  const action = primaryAction(account)

  return (
    <section id="platform" className={[styles.section, styles.white].join(' ')} aria-labelledby="platform-title">
      <div className={styles.split}>
        <div className={[styles.splitText, motion.reveal, motion.fromLeft].join(' ')}>
          <SectionHeading
            reveal={false}
            id="platform-title"
            overline="The platform"
            title="One private place to learn together"
          />
          <p className={styles.bodyLarge}>
            The JEENISo learning platform is where the members of the association follow their
            training. Every course is organised in modules and lessons — videos, texts, documents
            and links — and your progress is saved as you go.
          </p>
          <p className={styles.bodyMuted}>
            Administrators create the courses and the member accounts. You only need to sign in and
            start learning.
          </p>
          <CheckList
            items={[
              'Courses published by the association',
              'Lessons in a clear order, module by module',
              'Your progress always in sight',
            ]}
          />
          <div className={styles.platformAction}>
            <LinkButton
              to={action.to}
              variant="secondary"
              size="lg"
              iconRight="arrow-right"
              className={landing.lift}
            >
              {account === null ? 'Sign in to start' : action.label}
            </LinkButton>
          </div>
        </div>

        <div className={[styles.media, motion.reveal, motion.fromRight].join(' ')}>
          <div className={[styles.mediaBlock, motion.parallaxReverse].join(' ')} aria-hidden="true" />
          <div className={[styles.photo, motion.clip].join(' ')}>
            <img src={photo} alt="" />
            <div className={styles.photoCaption}>
              <p className={styles.photoOverline}>Courses · Lessons · Resources</p>
              <p className={styles.photoTitle}>Your courses, your pace</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
