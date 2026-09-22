import motion from '../motion.module.css'

import { SectionHeading } from './parts'
import styles from './Sections.module.css'

const steps: readonly { title: string; body: string }[] = [
  { title: 'Sign in', body: 'Use the account your administrator created for you.' },
  { title: 'Choose a course', body: 'Browse the catalogue and enroll in the course you want.' },
  { title: 'Learn lesson by lesson', body: 'Watch videos, read texts and open documents from the course outline.' },
  { title: 'Reach 100%', body: 'When every video is completed, the course is marked as finished.' },
]

/**
 * How it works (`#how`): a rail, then four numbered steps. Four columns, two on
 * a tablet; on a phone the rail goes and the steps become rows with the number
 * beside them (Landing-Mobile).
 *
 * The board fills the rail as the section scrolls into view; that is
 * LANDING-03. Still, it is drawn filled - the state the animation ends on.
 */
export function LandingSteps() {
  return (
    <section id="how" className={[styles.section, styles.gray].join(' ')} aria-labelledby="how-title">
      <SectionHeading id="how-title" overline="How it works" title="Four steps to 100%" />
      <div className={styles.rail} aria-hidden="true">
        <div className={[styles.railFill, motion.fill].join(' ')} />
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.title} className={[styles.step, motion.reveal].join(' ')}>
            {/* The list gives the order; the big number is its visual form. */}
            <div className={styles.stepNumberBox} aria-hidden="true">
              <span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className={styles.stepText}>
              <h3 className={[styles.cardTitle, styles.stepTitle].join(' ')}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
