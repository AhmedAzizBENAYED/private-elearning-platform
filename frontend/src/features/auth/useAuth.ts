import { useCallback, useContext, useSyncExternalStore } from 'react'

import { AuthContext } from './AuthContext'
import type { LoginRequest, User } from './types'
import type { AuthStatus } from './types'

export interface AuthContextValue {
  user: User | null
  status: AuthStatus
  isAuthenticated: boolean
  /** The server ended the session that was in use (see `AuthState.expired`). */
  sessionExpired: boolean
  login: (credentials: LoginRequest) => Promise<User>
  logout: () => void
  /** Forces an access-token renewal. Rarely needed: the client does it on 401. */
  refresh: () => Promise<void>
  /** Publishes the account the server just returned after a profile update. */
  replaceUser: (user: User) => void
}

/**
 * Reads the session.
 *
 * Exposes only what a page needs. The token stores, the in-flight refresh
 * promise and the storage keys stay private to the feature - a component can
 * neither read a token nor reach around the store to change one.
 */
export function useAuth(): AuthContextValue {
  const store = useContext(AuthContext)

  if (store === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>')
  }

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  const refresh = useCallback(async () => {
    // The token itself is never surfaced to the UI.
    await store.refreshAccessToken()
  }, [store])

  return {
    user: state.user,
    status: state.status,
    isAuthenticated: state.status === 'authenticated',
    sessionExpired: state.expired === true,
    login: store.login,
    logout: store.logout,
    refresh,
    replaceUser: store.replaceUser,
  }
}
