import { ApiError, AuthSessionError, NetworkError } from '../../api'

import type { AccessTokenStore } from './accessTokenStore'
import type { AuthApi } from './api'
import type { RefreshTokenStorage } from './refreshTokenStorage'
import type { AuthState, LoginRequest, User } from './types'

export interface AuthStoreDeps {
  authApi: AuthApi
  accessTokens: AccessTokenStore
  refreshTokens: RefreshTokenStorage
}

export interface AuthStore {
  getState: () => AuthState
  subscribe: (listener: () => void) => () => void

  /** Full sign-in: tokens, then the account behind them. */
  login: (credentials: LoginRequest) => Promise<User>
  /** Local sign-out. There is no backend revocation endpoint; see below. */
  logout: () => void
  /** Restores a session from the persisted refresh token. Idempotent. */
  bootstrap: () => Promise<void>
  /**
   * Single-flight access-token refresh. Resolves `null` when no refresh token
   * is held. This is what the API client calls on a 401.
   */
  refreshAccessToken: () => Promise<string | null>
  /**
   * Replaces the signed-in account with a fresher copy the server returned -
   * `PATCH /auth/me`'s answer - so the header shows a new name without another
   * `GET /auth/me`. Ignored unless it is the same account, signed in.
   */
  replaceUser: (user: User) => void
}

const UNAUTHENTICATED: AuthState = { status: 'unauthenticated', user: null }
const EXPIRED: AuthState = { status: 'unauthenticated', user: null, expired: true }
const UNKNOWN: AuthState = { status: 'unknown', user: null }

/**
 * A failure that says nothing about the credential: the server could not be
 * reached, or failed on its side. Only these keep a stored session alive.
 */
function isTransient(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.isServerError)
}

/**
 * The authentication session.
 *
 * Deliberately framework-free: a plain observable store with `getState` and
 * `subscribe`, which React consumes through `useSyncExternalStore`. That keeps
 * every rule in this file testable without rendering anything, and means the
 * session is not owned by the component tree.
 *
 * It is a factory rather than a module singleton so each test builds its own
 * isolated graph; the app's one instance is composed in `runtime.ts`.
 */
export function createAuthStore({
  authApi,
  accessTokens,
  refreshTokens,
}: AuthStoreDeps): AuthStore {
  let state: AuthState = UNKNOWN
  const listeners = new Set<() => void>()

  // One shared refresh promise. Five concurrent 401s await this, so the backend
  // sees exactly one POST /auth/refresh.
  let refreshInFlight: Promise<string | null> | null = null
  // Bootstrap is idempotent: StrictMode mounts effects twice in development.
  let bootstrapInFlight: Promise<void> | null = null

  function setState(next: AuthState): void {
    // Reference equality is enough: every transition builds a new object, and
    // useSyncExternalStore would loop on a fresh object for an unchanged state.
    if (state.status === next.status && state.user === next.user && state.expired === next.expired) {
      return
    }
    state = next
    for (const listener of listeners) listener()
  }

  /**
   * Drops every credential and the cached account, in one place.
   *
   * `expired` records that the server ended a session that was in use, which
   * the route guard turns into the login page's "Your session has expired"
   * notice. A sign-out, or a session that never got going, is not an expiry.
   */
  function clearSession(reason?: 'expired'): void {
    const wasSignedIn = state.status === 'authenticated'
    accessTokens.clear()
    refreshTokens.clear()
    setState(reason === 'expired' && wasSignedIn ? EXPIRED : UNAUTHENTICATED)
  }

  async function performRefresh(refreshToken: string): Promise<string> {
    let response
    try {
      response = await authApi.refresh(refreshToken)
    } catch (error) {
      // A rejected refresh token ends the session. A network failure or a 5xx
      // does not: the credentials are still good, the server is just
      // unreachable, and signing the user out would lose their place for a
      // transient problem.
      if (error instanceof ApiError && error.status === 401) {
        clearSession('expired')
        throw new AuthSessionError('Your session has expired', error)
      }
      throw error
    }

    accessTokens.set(response.access_token)
    return response.access_token
  }

  function refreshAccessToken(): Promise<string | null> {
    const refreshToken = refreshTokens.read()
    if (refreshToken === null) {
      // A 401 on a signed-in session that holds nothing to renew it with (the
      // storage was blocked or cleared): the session cannot recover, so it
      // ends here rather than leaving every later request to fail with the UI
      // still claiming someone is signed in.
      if (state.status === 'authenticated') clearSession('expired')
      return Promise.resolve(null)
    }

    refreshInFlight ??= performRefresh(refreshToken).finally(() => {
      refreshInFlight = null
    })

    return refreshInFlight
  }

  async function login(credentials: LoginRequest): Promise<User> {
    const tokens = await authApi.login(credentials)

    accessTokens.set(tokens.access_token)
    refreshTokens.write(tokens.refresh_token)

    let user: User
    try {
      user = await authApi.getCurrentUser(tokens.access_token)
    } catch (error) {
      // Never leave a half-authenticated session: tokens exist but no identity.
      clearSession()
      throw error
    }

    setState({ status: 'authenticated', user })
    return user
  }

  function logout(): void {
    // The refresh token is revoked server-side first, so the session ends for
    // real rather than only in this browser: `POST /auth/logout` records its
    // `jti` and the server refuses it from then on.
    //
    // The local session is cleared *regardless* of how that call ends. A
    // failed request must not leave someone signed in on the machine in front
    // of them - that is the worse of the two failures - so the token is read
    // before clearing and the request is left to settle on its own.
    const refreshToken = refreshTokens.read()
    clearSession()

    if (refreshToken === null) return
    // Deliberately not awaited and deliberately swallowed: there is nothing
    // the person can do about it, and the access token they hold expires on
    // its own within minutes.
    void authApi.logout(refreshToken).catch(() => undefined)
  }

  async function restore(): Promise<void> {
    // The access token is gone after a reload, so trade the refresh token for a
    // new one *before* calling /auth/me - calling it first would guarantee a
    // 401 and a pointless round trip.
    let accessToken: string | null
    try {
      accessToken = await refreshAccessToken()
    } catch (error) {
      // performRefresh already cleared the session on a 401. A transient
      // failure (network, 5xx) says nothing about the credential: nothing can
      // be shown now, but the stored refresh token is kept, so the session
      // comes back on the next load instead of being thrown away over an
      // outage - the same rule as a refresh during use.
      // A refused refresh token was cleared there already; clearing again
      // would only overwrite how the session ended.
      if (error instanceof AuthSessionError) return
      if (isTransient(error)) signOutForNow()
      else clearSession()
      return
    }

    if (accessToken === null) {
      setState(UNAUTHENTICATED)
      return
    }

    try {
      setState({ status: 'authenticated', user: await authApi.getCurrentUser(accessToken) })
    } catch (error) {
      if (isTransient(error)) signOutForNow()
      else clearSession()
    }
  }

  /** Nothing to show this time; the persisted refresh token is left alone. */
  function signOutForNow(): void {
    accessTokens.clear()
    setState(UNAUTHENTICATED)
  }

  function bootstrap(): Promise<void> {
    bootstrapInFlight ??= restore().finally(() => {
      bootstrapInFlight = null
    })
    return bootstrapInFlight
  }

  function replaceUser(user: User): void {
    // Only ever a newer copy of the same identity: never a way to sign
    // someone in, or to swap one account for another.
    if (state.status !== 'authenticated' || state.user?.id !== user.id) return
    setState({ status: 'authenticated', user })
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    login,
    logout,
    bootstrap,
    refreshAccessToken,
    replaceUser,
  }
}
