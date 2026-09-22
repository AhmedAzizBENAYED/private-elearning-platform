import { Icon, type IconName } from '../../../design-system'

import motion from '../motion.module.css'

import { SectionHeading, TiltZones } from './parts'
import styles from './Sections.module.css'

const benefits: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'video',
    title: 'Video lessons',
    body: 'Watch each lesson in a clean player and come back to it whenever you want.',
  },
  {
    icon: 'doc',
    title: 'Documents and resources',
    body: 'Read text lessons, open documents and follow the links your instructors selected.',
  },
  {
    icon: 'layers',
    title: 'A clear course outline',
    body: 'Every course is split into modules and lessons, with the current lesson always highlighted.',
  },
  {
    icon: 'trending-up',
    title: 'Visible progress',
    body: 'Completed videos are counted for you. Reach 100% to finish a course.',
  },
  {
    icon: 'shield',
    title: 'Private by design',
    body: 'Access is reserved for the accounts created by the association’s administrators.',
  },
  {
    icon: 'smartphone',
    title: 'On every screen',
    body: 'Follow your lessons on a computer, a tablet or a phone with the same clear layout.',
  },
]

/**
 * The benefits (`#benefits`): six feature cards - statements, not links.
 * Three columns, two on a tablet, one on a phone.
 */
export function LandingBenefits() {
  return (
    <section id="benefits" className={[styles.section, styles.white].join(' ')} aria-labelledby="benefits-title">
      <SectionHeading
        id="benefits-title"
        overline="Why the platform"
        title="Everything you need to learn, nothing you don’t"
      />
      <ul className={styles.featureGrid}>
        {benefits.map((benefit) => (
          <li key={benefit.title} className={[styles.featureCard, styles.tilt, motion.reveal].join(' ')}>
            <span className={[styles.squareTile, motion.draw].join(' ')} aria-hidden="true">
              <Icon name={benefit.icon} size={26} drawable />
            </span>
            <h3 className={[styles.cardTitle, styles.featureTitle].join(' ')}>{benefit.title}</h3>
            <p className={styles.cardBody}>{benefit.body}</p>
            <TiltZones />
          </li>
        ))}
      </ul>
    </section>
  )
}
