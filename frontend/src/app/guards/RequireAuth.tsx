import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../features/auth'
import { routes } from '../routes'

/**
 * Gate for every signed-in route.
 *
 * Reads FE-02's session state and nothing else: no token is touched, no
 * storage is read, and `/auth/me` is never called from here - FE-02 already
 * owns the bootstrap, and calling it again would be a second source of truth.
 *
 * The attempted URL is carried in location state so the login page can return
 * the person to where they were going. When the server ended the session (the
 * refresh token was refused), the redirect says so with `?expired=1`. This runs only after
 * `AuthBootstrapGate`, so `status` is never `unknown` here.
 */
export function RequireAuth() {
  const { isAuthenticated, sessionExpired } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    // A session the server ended - not a sign-out - arrives with `expired=1`,
    // which the login page already turns into "Your session has expired".
    const to = sessionExpired ? { pathname: routes.login, search: '?expired=1' } : routes.login
    return <Navigate to={to} state={{ from: location }} replace />
  }

  return <Outlet />
}
