import type { HttpClient } from '../../api'

import type {
  AccessTokenResponse,
  LoginRequest,
  RefreshRequest,
  TokenResponse,
  User,
} from './types'

/**
 * The three authentication endpoints, typed against the real backend.
 *
 * Built on the raw transport, not on the authenticated client: `login` and
 * `refresh` are unauthenticated, and `getCurrentUser` takes its token as an
 * argument. That keeps this module completely outside the 401-retry machinery,
 * so a failing refresh can never recurse into itself.
 *
 * No React here - this is callable from a test, from the session store, and
 * from anything added later.
 */
export interface AuthApi {
  login: (credentials: LoginRequest, signal?: AbortSignal) => Promise<TokenResponse>
  refresh: (refreshToken: string, signal?: AbortSignal) => Promise<AccessTokenResponse>
  /** Revokes one refresh token server-side. Resolves to nothing; 204 on success. */
  logout: (refreshToken: string, signal?: AbortSignal) => Promise<void>
  getCurrentUser: (accessToken: string, signal?: AbortSignal) => Promise<User>
}

export function createAuthApi(http: HttpClient): AuthApi {
  return {
    /** `POST /auth/login` -> access + refresh token. 401 on bad or inactive credentials. */
    login: (credentials, signal) =>
      http.request<TokenResponse>('/auth/login', {
        method: 'POST',
        json: credentials,
        signal,
      }),

    /**
     * `POST /auth/refresh` -> a new access token only.
     *
     * The backend does not rotate the refresh token and does not extend its
     * lifetime, so the caller keeps the token it already has.
     */
    refresh: (refreshToken, signal) =>
      http.request<AccessTokenResponse>('/auth/refresh', {
        method: 'POST',
        json: { refresh_token: refreshToken } satisfies RefreshRequest,
        signal,
      }),

    /**
     * `POST /auth/logout` -> 204, and the refresh token is revoked.
     *
     * The token travels in the body, exactly as it does on `/auth/refresh`: a
     * URL reaches logs, proxies and referrer headers.
     *
     * Always answers 204 - revoking an invalid or already-revoked token is not
     * an error a client could act on - so the only failure a caller can see is
     * the network itself.
     */
    logout: (refreshToken, signal) =>
      http.request<void>('/auth/logout', {
        method: 'POST',
        json: { refresh_token: refreshToken } satisfies RefreshRequest,
        signal,
      }),

    /** `GET /auth/me` -> the account behind this access token. */
    getCurrentUser: (accessToken, signal) =>
      http.request<User>('/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      }),
  }
}
