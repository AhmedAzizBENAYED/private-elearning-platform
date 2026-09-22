import { LinkButton } from '../app/LinkButton'
import { landingPathFor } from '../app/routes'
import { Button } from '../design-system'
import { useAuth } from '../features/auth'

import { MessagePage } from './MessagePage'
import styles from './MessagePage.module.css'

export interface ServerErrorPageProps {
  /** Retries the request that failed; "Try again" calls it. */
  onRetry: () => void
}

/**
 * The server / network error card of the Access-States board (G35):
 * "Error 500", "Something went wrong", then "Try again" and a way out, "Back
 * to dashboard", as the 403 and 404 cards already offer one.
 *
 * Shared by the pages that fail as a whole when their first read fails - the
 * course details and the learning page - so the two cannot drift apart.
 */
export function ServerErrorPage({ onRetry }: ServerErrorPageProps) {
  const { user } = useAuth()

  return (
    <MessagePage
      icon="wifi-off"
      overline="Error 500"
      title="Something went wrong"
      body="We couldn’t reach the server. Check your connection and try again."
      action={
        <div className={styles.actions}>
          <Button iconLeft="refresh" onClick={onRetry}>
            Try again
          </Button>
          {user ? (
            <LinkButton variant="tertiary" to={landingPathFor(user.role)}>
              Back to dashboard
            </LinkButton>
          ) : null}
        </div>
      }
    />
  )
}
