import { useNavigate } from 'react-router-dom'

import { landingPathFor, routes } from '../app/routes'
import { Button } from '../design-system'
import { useAuth } from '../features/auth'
import { AdminLayout } from '../layouts/AdminLayout'
import { MemberLayout } from '../layouts/MemberLayout'

import { MessagePage } from './MessagePage'
import styles from './NotFoundPage.module.css'

/**
 * The 404 page (Access-States board).
 *
 * A signed-in person keeps their shell, so they can navigate away; a signed-out
 * one gets the bare card, because there is no navigation to offer them and
 * showing one would leak the application's structure.
 */
export function NotFoundPage() {
  const { isAuthenticated, user } = useAuth()
  const card = <NotFoundCard />

  if (!isAuthenticated || !user) {
    return <div className={styles.bare}>{card}</div>
  }

  // An administrator keeps the administration shell they were browsing in.
  return user.role === 'ADMIN' ? (
    <AdminLayout>{card}</AdminLayout>
  ) : (
    <MemberLayout>{card}</MemberLayout>
  )
}

/**
 * The card alone, for a route that already sits inside a shell: an unknown
 * path under `/admin` is rendered by the admin subtree, so it goes through
 * the same guards as every other admin URL (sign-in, then the 403 for a
 * member) instead of escaping them to the catch-all.
 */
export function NotFoundCard() {
  const { isAuthenticated, user } = useAuth()
  const navigate = useNavigate()

  return (
    <MessagePage
      icon="search"
      overline="Error 404"
      title="We can’t find this page"
      body="The link may be outdated or the course may no longer be available."
      action={
        isAuthenticated && user ? (
          <Button iconRight="arrow-right" onClick={() => navigate(landingPathFor(user.role))}>
            {user.role === 'ADMIN' ? 'Back to dashboard' : 'Browse courses'}
          </Button>
        ) : (
          <Button iconRight="arrow-right" onClick={() => navigate(routes.login)}>
            Go to sign in
          </Button>
        )
      }
    />
  )
}
