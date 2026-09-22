/**
 * The refresh token, persisted in `sessionStorage` and only here.
 *
 * `sessionStorage` rather than `localStorage`: the token is valid for seven
 * days server-side and cannot be revoked (the backend exposes no revocation
 * endpoint), so it must not outlive the browser tab. Not a cookie either - the
 * backend reads the token from the request body and sets
 * `allow_credentials=False`, so a cookie would never be sent.
 *
 * This is the single module allowed to touch web storage for credentials.
 * Nothing else in the app calls `sessionStorage` directly, so "where can a
 * token be persisted?" has exactly one answer.
 */

/** Namespaced so it cannot collide with another app on the same origin. */
export const REFRESH_TOKEN_KEY = 'jeeniso.auth.refresh_token'

export interface RefreshTokenStorage {
  read: () => string | null
  write: (token: string) => void
  clear: () => void
}

/**
 * Web storage throws rather than returning null when it is unavailable
 * (Safari private mode, disabled site data, a sandboxed iframe). Every access
 * is guarded so a blocked storage degrades to "no persisted session" instead of
 * crashing the app on boot.
 */
function safely<T>(operation: () => T, fallback: T): T {
  try {
    return operation()
  } catch {
    return fallback
  }
}

export function createRefreshTokenStorage(
  // Resolved lazily by the caller so importing this module never touches
  // storage at module-evaluation time.
  getStorage: () => Storage | undefined = () => globalThis.sessionStorage,
): RefreshTokenStorage {
  return {
    read: () =>
      safely(() => {
        const value = getStorage()?.getItem(REFRESH_TOKEN_KEY) ?? null
        // Treat an empty string as absent; the backend rejects it anyway.
        return value === '' ? null : value
      }, null),

    write: (token: string) =>
      safely(() => {
        getStorage()?.setItem(REFRESH_TOKEN_KEY, token)
      }, undefined),

    clear: () =>
      safely(() => {
        getStorage()?.removeItem(REFRESH_TOKEN_KEY)
      }, undefined),
  }
}
