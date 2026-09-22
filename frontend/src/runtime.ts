/**
 * Composition root.
 *
 * Every module in `api/` and `features/auth/` is a factory taking its
 * dependencies as arguments, which is what makes them testable in isolation.
 * This is the single place where those factories are wired into the one graph
 * the running application uses.
 *
 * The wiring is acyclic by construction:
 *
 *   httpClient -> authApi -> authStore -> apiClient
 *
 * `authStore` talks to the transport directly (its three endpoints are either
 * unauthenticated or take an explicit token), so the authenticated client can
 * depend on the store's refresh without the store depending back on the client.
 */

import { createApiClient, createHttpClient, resolveApiBaseUrl } from './api'
import { createAccessTokenStore } from './features/auth/accessTokenStore'
import { createAuthApi } from './features/auth/api'
import { createAuthStore } from './features/auth/authStore'
import { createRefreshTokenStorage } from './features/auth/refreshTokenStorage'

/** Raw transport. No credentials, no retry. */
export const httpClient = createHttpClient({ baseUrl: resolveApiBaseUrl() })

export const accessTokenStore = createAccessTokenStore()
export const refreshTokenStorage = createRefreshTokenStorage()

export const authApi = createAuthApi(httpClient)

export const authStore = createAuthStore({
  authApi,
  accessTokens: accessTokenStore,
  refreshTokens: refreshTokenStorage,
})

/**
 * The client every feature endpoint should use from FE-04 onwards: it attaches
 * the bearer token and performs the single-flight refresh-and-retry on a 401.
 */
export const apiClient = createApiClient(httpClient, {
  getAccessToken: accessTokenStore.get,
  refreshAccessToken: authStore.refreshAccessToken,
})
