/**
 * Where the backend lives.
 *
 * `VITE_API_BASE_URL` is the server origin only (e.g. `http://localhost:8000`).
 * The version prefix is owned here, not by the environment, so a deployment
 * cannot silently point the app at an unversioned or wrong-version API.
 *
 * Leaving the variable unset resolves to an empty origin, i.e. same-origin
 * requests to `/api/v1/...`. That is the correct production shape when the SPA
 * is served by the API host, and it is what the backend's own CORS comment
 * describes ("an empty origin list registers no middleware at all, which is
 * correct for a same-origin deployment").
 */

/** The only API version this client speaks. */
export const API_VERSION_PREFIX = '/api/v1'

/** Strips a trailing slash so joining never produces a double slash. */
export function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return ''
  return trimmed.replace(/\/+$/, '')
}

export function resolveApiBaseUrl(): string {
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)
}

/**
 * Builds the absolute request URL.
 *
 * `path` is always API-relative and starts with a slash (`/auth/login`). Tokens
 * and other credentials are never placed in a URL - they travel in headers or,
 * for the two unauthenticated auth endpoints, in the request body.
 */
export function buildUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${API_VERSION_PREFIX}${suffix}`
}
