/**
 * The access token, held in memory and nowhere else.
 *
 * It is short-lived (15 minutes by backend default) and is the credential that
 * actually authorizes requests, so it never reaches `localStorage`,
 * `sessionStorage`, a cookie, IndexedDB or a URL. A page reload therefore loses
 * it - that is intended, and the session is rebuilt from the refresh token at
 * startup.
 *
 * The value lives in a closure rather than on the returned object, so it cannot
 * be reached by enumerating properties, by `JSON.stringify`, or by a devtools
 * inspection of application state.
 */

export interface AccessTokenStore {
  get: () => string | null
  set: (token: string) => void
  clear: () => void
}

export function createAccessTokenStore(): AccessTokenStore {
  let accessToken: string | null = null

  return {
    get: () => accessToken,
    set: (token: string) => {
      accessToken = token
    },
    clear: () => {
      accessToken = null
    },
  }
}
