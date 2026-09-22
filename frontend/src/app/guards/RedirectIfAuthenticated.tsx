import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '../../features/auth'
import { landingPathFor } from '../routes'

/**
 * Keeps a signed-in account off the login page.
 *
 * The destination follows the Flows board: an administrator lands on the admin
 * dashboard, a member on theirs.
 */
export function RedirectIfAuthenticated() {
  const { isAuthenticated, user } = useAuth()

  if (isAuthenticated && user) {
    return <Navigate to={landingPathFor(user.role)} replace />
  }

  return <Outlet />
}
