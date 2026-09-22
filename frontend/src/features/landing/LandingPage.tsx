import styles from './Landing.module.css'
import { LandingFooter } from './LandingFooter'
import { LandingHeader } from './LandingHeader'
import { LandingHero } from './LandingHero'
import { LandingBenefits } from './sections/LandingBenefits'
import { LandingClosing } from './sections/LandingClosing'
import { LandingPlatform } from './sections/LandingPlatform'
import { LandingPreview } from './sections/LandingPreview'
import { LandingQuickAccess } from './sections/LandingQuickAccess'
import { LandingSteps } from './sections/LandingSteps'

/**
 * The public landing page, `/` (Data-Needs "Routing proposal": "/ - Landing
 * (public)").
 *
 * Open to everyone: a visitor sees "Sign in", a signed-in account sees "Go to
 * my dashboard" and its avatar, and nothing is read from the API beyond the
 * session the app already holds.
 *
 * The blocks, in the boards' order - the same at every width: hero, the
 * platform, quick access, the preview, the benefits, how it works, the closing
 * call to action, then the footer. LANDING-01 built the header, the hero and
 * the footer; LANDING-02 the six blocks between them; LANDING-03 their motion,
 * in CSS, none of it under `prefers-reduced-motion: reduce`.
 */
export function LandingPage() {
  return (
    <div id="top" className={styles.page}>
      {/* DS 09: "a skip link is the first focusable element". */}
      <a className="dsSkipLink" href="#main">
        Skip to content
      </a>
      {/* The page-load bar across the top; drawn only while it animates. */}
      <div className={styles.loadBar} aria-hidden="true" />
      <LandingHeader />
      <main id="main" tabIndex={-1} className={styles.main}>
        <LandingHero />
        <LandingPlatform />
        <LandingQuickAccess />
        <LandingPreview />
        <LandingBenefits />
        <LandingSteps />
        <LandingClosing />
      </main>
      <LandingFooter />
    </div>
  )
}
