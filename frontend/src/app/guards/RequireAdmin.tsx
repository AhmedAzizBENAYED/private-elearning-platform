import { Outlet } from 'react-router-dom'

import { useAuth } from '../../features/auth'
import { ForbiddenPage } from '../../pages/ForbiddenPage'

/**
 * Gate for `/admin/*`.
 *
 * A member who reaches an admin URL is shown the designed 403 page rather than
 * being bounced somewhere else: the Access-States board specifies a page with
 * its own copy and a "Back to dashboard" action, so silently redirecting would
 * drop a screen the design asked for.
 *
 * This is a UX boundary only. Every admin endpoint is independently enforced by
 * the backend's `require_role(UserRole.ADMIN)`; hiding a route here protects
 * nobody's data on its own.
 */
export function RequireAdmin() {
  const { user } = useAuth()

  if (user?.role !== 'ADMIN') return <ForbiddenPage />

  return <Outlet />
}
