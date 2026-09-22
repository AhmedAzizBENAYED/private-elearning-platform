import { Outlet } from 'react-router-dom'

import { useAuth } from '../../features/auth'
import { AppLoading } from '../../pages/AppLoading'

/**
 * Holds every route until the session is known.
 *
 * FE-02 starts from `unknown` and resolves to `authenticated` or
 * `unauthenticated` only after the refresh token has been traded for an access
 * token. Rendering the tree before that would show the login page for a moment
 * to someone who is in fact signed in, and then yank it away - so nothing
 * renders, and nothing redirects, until the answer is in.
 *
 * The router is still mounted underneath, so the URL the person arrived on is
 * preserved and honoured once bootstrap finishes.
 */
export function AuthBootstrapGate() {
  const { status } = useAuth()

  if (status === 'unknown') return <AppLoading />

  return <Outlet />
}
