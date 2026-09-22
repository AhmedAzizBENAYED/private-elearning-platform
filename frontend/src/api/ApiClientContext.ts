import { createContext, useContext } from 'react'

import type { ApiClient } from './client'

/**
 * Publishes the API client to the tree.
 *
 * Feature hooks take their client from here rather than importing the runtime
 * singleton, for the same reason FE-02's session does: a component that reaches
 * for a module-level singleton cannot be given a different one, so it cannot be
 * tested without touching the network. The application provides the real client
 * once, in `App`; a test provides an isolated one.
 *
 * `null` means "no provider", which the hook turns into a loud error rather
 * than a silent fallback to the real backend.
 */
export const ApiClientContext = createContext<ApiClient | null>(null)

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext)

  if (client === null) {
    throw new Error('useApiClient must be used inside an <ApiClientProvider>')
  }

  return client
}
