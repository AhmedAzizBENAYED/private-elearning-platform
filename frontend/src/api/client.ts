import { ApiError } from './errors'
import type { HttpClient, RequestOptions } from './http'

/**
 * What the API client needs from the session, without importing it.
 *
 * Keeping this an injected contract rather than a direct import means `api/`
 * has no dependency on `features/auth/`, so there is no import cycle and a test
 * can drive the retry logic with a two-line stub.
 */
export interface AuthBridge {
  /** The current access token, or `null` when there is none. */
  getAccessToken: () => string | null
  /**
   * Obtains a fresh access token.
   *
   * Resolves with the new token on success, or with `null` when no refresh
   * token is held and refreshing is therefore impossible. Rejects when a
   * refresh was attempted and failed - by then the session has been cleared.
   *
   * Implementations must be single-flight: concurrent callers share one
   * request to `POST /auth/refresh`.
   */
  refreshAccessToken: () => Promise<string | null>
}

export interface ApiClient {
  request: <T>(path: string, options?: RequestOptions) => Promise<T>
  /**
   * The same request, read as binary.
   *
   * Used only for `GET /lessons/{id}/resource/content` on a DOCUMENT lesson,
   * whose URL carries no token of its own and therefore cannot be handed to the
   * browser directly. It refreshes and replays on a 401 exactly as `request`
   * does, so a document opened after a long idle is not a spurious failure.
   */
  blob: (path: string, options?: RequestOptions) => Promise<Blob>
  /**
   * The API origin (no version prefix), for the one case a URL must be handed
   * to the browser rather than fetched: a media element's `src`. Everything
   * else goes through `request`.
   */
  readonly baseUrl: string
}

function withAuthorization(
  options: RequestOptions,
  accessToken: string | null,
): RequestOptions {
  // No token means no header at all - never `Bearer null`, never `Bearer `.
  if (accessToken === null) return options
  return {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
  }
}

/**
 * The authenticated API client every feature uses.
 *
 * On a 401 it refreshes once and replays the request:
 *
 *   request -> 401 -> refresh (shared) -> retry once -> result
 *
 * The retry calls the transport directly rather than re-entering `request`, so
 * a second 401 cannot start another refresh. That makes an infinite refresh
 * loop structurally impossible rather than merely guarded against by a counter.
 *
 * An upload that reports progress (`onUploadProgress`) goes through this very
 * function: the option travels in `options` to both attempts, so it shares the
 * one refresh and the one replay, and reports the replay's bytes too.
 */
export function createApiClient(http: HttpClient, auth: AuthBridge): ApiClient {
  /**
   * Runs one transport call under the session, refreshing once on a 401.
   *
   * `send` is handed the options to use and is invoked at most twice, so the
   * JSON and binary readers share one definition of the retry rather than two
   * that could drift apart.
   */
  async function authenticated<R>(
    options: RequestOptions,
    send: (options: RequestOptions) => Promise<R>,
  ): Promise<R> {
    try {
      return await send(withAuthorization(options, auth.getAccessToken()))
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error

      // No refresh token: nothing to try, so the caller sees the real 401.
      const accessToken = await auth.refreshAccessToken()
      if (accessToken === null) throw error

      // Exactly one replay. A 401 here propagates as-is.
      return await send(withAuthorization(options, accessToken))
    }
  }

  return {
    request: <T,>(path: string, options: RequestOptions = {}) =>
      authenticated(options, (resolved) => http.request<T>(path, resolved)),
    blob: (path: string, options: RequestOptions = {}) =>
      authenticated(options, (resolved) => http.blob(path, resolved)),
    baseUrl: http.baseUrl,
  }
}
