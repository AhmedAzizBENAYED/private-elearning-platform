import { useNavigate } from 'react-router-dom'

import { routes } from '../app/routes'
import { Button } from '../design-system'
import { MemberLayout } from '../layouts/MemberLayout'

import { MessagePage } from './MessagePage'

/**
 * The 403 page (Access-States board), shown when a member reaches an admin URL.
 *
 * Rendered inside the member shell so the person keeps their navigation rather
 * than landing on a dead end. This is a UX boundary: the backend enforces the
 * same rule independently on every admin endpoint.
 */
export function ForbiddenPage() {
  const navigate = useNavigate()

  return (
    <MemberLayout>
      <MessagePage
        icon="lock"
        overline="Error 403"
        title="You don’t have access to this page"
        body="This area is reserved for administrators. If you think this is a mistake, contact the association."
        action={
          <Button iconLeft="arrow-left" onClick={() => navigate(routes.dashboard)}>
            Back to dashboard
          </Button>
        }
      />
    </MemberLayout>
  )
}
