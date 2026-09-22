import { createContext } from 'react'

import type { AuthStore } from './authStore'

/**
 * Carries the session store down the tree.
 *
 * The context holds the store itself, not a state snapshot, so a component that
 * only calls `login` never re-renders when the status changes - subscription is
 * `useAuth`'s job, through `useSyncExternalStore`.
 *
 * `null` means "no provider", which `useAuth` turns into a loud error.
 */
export const AuthContext = createContext<AuthStore | null>(null)
