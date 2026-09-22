import { landingPathFor, routes } from '../../app/routes'
import type { User } from '../auth'
import { profilePaths } from '../profile'

/**
 * The landing page's in-page anchors, in the order the header, the mobile menu
 * and the footer draw them (Landing boards).
 *
 * Every id is an element on the page: the four content sections
 * (LANDING-02) and the footer, which is `#contact` (LANDING-01).
 */
export interface LandingSection {
  id: string
  label: string
}

export const landingSections: readonly LandingSection[] = [
  { id: 'platform', label: 'Platform' },
  { id: 'preview', label: 'Preview' },
  { id: 'benefits', label: 'Benefits' },
  { id: 'how', label: 'How it works' },
  { id: 'contact', label: 'Contact' },
]

/**
 * The footer's "Platform" column, as drawn: Preview, Benefits, How it works -
 * not Platform itself, and not Contact, which is its own column.
 */
export const footerPlatformSections = landingSections.filter(
  (section) => section.id !== 'platform' && section.id !== 'contact',
)

export const CONTACT_EMAIL = 'contact@jeeniso.com'

/**
 * Where the one primary action leads (DS 09 "Landing page rules"): "Sign in"
 * when signed out; once signed in, "Go to my dashboard" - the role's own
 * landing, the same one sign-in uses.
 */
export function primaryAction(user: User | null) {
  return user === null
    ? { to: routes.login, label: 'Sign in', shortLabel: 'Sign in' }
    : { to: landingPathFor(user.role), label: 'Go to my dashboard', shortLabel: 'Dashboard' }
}

/** "Avatar links to My profile": the profile in the account's own shell. */
export function profilePathFor(user: User): string {
  return profilePaths[user.role === 'ADMIN' ? 'admin' : 'member'].view
}
