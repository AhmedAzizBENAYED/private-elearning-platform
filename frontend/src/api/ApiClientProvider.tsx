import type { ReactNode } from 'react'

import { ApiClientContext } from './ApiClientContext'
import type { ApiClient } from './client'

export interface ApiClientProviderProps {
  client: ApiClient
  children: ReactNode
}

/** Makes one API client available to every feature hook below it. */
export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>
}
