import { type ReactNode, useEffect } from 'react'

import { authStore as defaultAuthStore } from '../../runtime'

import { AuthContext } from './AuthContext'
import type { AuthStore } from './authStore'

export interface AuthProviderProps {
  children: ReactNode
  /** Injectable so a test can supply an isolated store. */
  store?: AuthStore
}

/**
 * Publishes the session to the tree and restores it once on mount.
 *
 * The provider holds no state of its own; it only owns the startup effect.
 * `bootstrap` is idempotent, so StrictMode's double-invoked effect in
 * development still results in a single `POST /auth/refresh`.
 */
export function AuthProvider({ children, store = defaultAuthStore }: AuthProviderProps) {
  useEffect(() => {
    // Restoring a session cannot fail in a way the caller must handle: the
    // store records the outcome as `unauthenticated`.
    void store.bootstrap()
  }, [store])

  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>
}
