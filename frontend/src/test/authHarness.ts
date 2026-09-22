import { createApiClient, createHttpClient } from '../api'
import { createAccessTokenStore } from '../features/auth/accessTokenStore'
import { createAuthApi } from '../features/auth/api'
import { createAuthStore } from '../features/auth/authStore'
import { createRefreshTokenStorage } from '../features/auth/refreshTokenStorage'
import type { User } from '../features/auth/types'

import { createFetchMock, type FetchMock } from './fetchMock'

export const TEST_BASE_URL = 'http://localhost:8000'

/** A `UserResponse` exactly as the backend serialises it. */
export const testUser: User = {
  id: '4f6c1d0a-9b6e-4a2f-8f3c-2c1f0d5b7a11',
  email: 'iyed@example.org',
  first_name: 'Iyed',
  last_name: 'Belghith',
  is_active: true,
  role: 'MEMBER',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
}

export const testAdmin: User = {
  ...testUser,
  id: 'b21f8e33-1c44-4a55-9d66-7e8f9a0b1c2d',
  email: 'amal@example.org',
  first_name: 'Amal',
  last_name: 'Dridi',
  role: 'ADMIN',
}

/**
 * Builds the same object graph as `src/runtime.ts`, but isolated per test and
 * fed by a controlled `fetch`. Nothing here is a module singleton, so no test
 * can leak a token or a cached state into the next one.
 */
export function createAuthHarness() {
  const http = createFetchMock()
  const httpClient = createHttpClient({ baseUrl: TEST_BASE_URL, fetchImpl: http.fetch, xhrImpl: http.xhr })

  const accessTokens = createAccessTokenStore()
  // A private Storage per harness: never the shared jsdom sessionStorage, so
  // the security assertions about real web storage stay meaningful.
  const storage = new Map<string, string>()
  const refreshTokens = createRefreshTokenStorage(() => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  }))

  const authApi = createAuthApi(httpClient)
  const authStore = createAuthStore({ authApi, accessTokens, refreshTokens })
  const apiClient = createApiClient(httpClient, {
    getAccessToken: accessTokens.get,
    refreshAccessToken: authStore.refreshAccessToken,
  })

  return {
    http,
    httpClient,
    apiClient,
    authApi,
    authStore,
    accessTokens,
    refreshTokens,
    storage,
  }
}

export type AuthHarness = ReturnType<typeof createAuthHarness>

/** Routes a successful login + /auth/me pair. */
export function stubSignIn(
  http: FetchMock,
  {
    accessToken = 'access-1',
    refreshToken = 'refresh-1',
    user = testUser,
  }: { accessToken?: string; refreshToken?: string; user?: User } = {},
): void {
  http.on('/auth/login', {
    json: { access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer' },
  })
  http.on('/auth/me', { json: user })
}
