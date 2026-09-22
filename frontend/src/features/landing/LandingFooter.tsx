import { Link } from 'react-router-dom'

import logo from '../../assets/logo-reverse.png'
import { Icon } from '../../design-system'
import { BrandStrip } from '../../layouts/components/BrandStrip'
import { useAuth } from '../auth'

import styles from './Landing.module.css'
import { CONTACT_EMAIL, footerPlatformSections, primaryAction } from './sections'

/**
 * The landing footer (Landing boards), which is also the page's `#contact`.
 *
 * Deep navy, the brand strip, then three columns - the association, the
 * "Platform" links, "Contact" - over a bar with the copyright and "Back to
 * top". Two columns on a tablet, one on a phone.
 *
 * Every link goes somewhere real: the Platform column repeats the section
 * anchors the board lists there, then the primary action. The boards draw no
 * legal links ("no content was provided"), so there are none.
 */
export function LandingFooter() {
  const { user, isAuthenticated } = useAuth()
  const action = primaryAction(isAuthenticated ? user : null)
  const year = new Date().getFullYear()

  return (
    <footer id="contact" className={styles.footer}>
      <BrandStrip className={styles.strip} />
      <div className={styles.footerColumns}>
        <div className={styles.footerBrand}>
          <img className={styles.footerLogo} src={logo} alt="JEENISo" width={140} height={62} />
          <p className={styles.footerAbout}>
            Junior Entreprise ENISo — private training platform for the members of the association.
          </p>
        </div>

        <nav className={styles.footerColumn} aria-labelledby="footer-platform">
          <h2 id="footer-platform" className={styles.footerHeading}>
            Platform
          </h2>
          {footerPlatformSections.map((section) => (
            <a key={section.id} className={styles.footerLink} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
          <Link className={styles.footerLink} to={action.to}>
            {action.label}
          </Link>
        </nav>

        <div className={styles.footerColumn}>
          <h2 className={styles.footerHeading}>Contact</h2>
          <a className={[styles.footerLink, styles.footerMail].join(' ')} href={`mailto:${CONTACT_EMAIL}`}>
            <Icon name="mail" size={18} />
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>

      <div className={styles.footerBar}>
        <p className={styles.footerCopy}>© {year} JEENISo — Junior Entreprise ENISo</p>
        <a className={styles.backToTop} href="#top">
          Back to top
          <Icon name="arrow-up" size={16} />
        </a>
      </div>
    </footer>
  )
}
