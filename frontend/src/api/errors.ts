/**
 * Typed failures from the API.
 *
 * The backend returns exactly two error shapes (see
 * `app/core/exceptions.py`):
 *
 *   {"detail": "Only DRAFT courses can be edited"}                   - most errors
 *   {"detail": [{"loc": [...], "msg": "...", "type": "..."}]}        - 422 only
 *
 * Both are preserved here rather than flattened into a generic message, so a
 * form can show a field-level error and a page can show the server's own text.
 *
 * Nothing in this module ever reads the *request* body. An error must never
 * carry a password, a refresh token or an Authorization header into a message,
 * a log or a crash report.
 */

/** One entry of a FastAPI 422 body. */
export interface ValidationIssue {
  loc: (string | number)[]
  msg: string
  type: string
}

/** The server answered with a status of 400 or above. */
export class ApiError extends Error {
  readonly status: number
  /** The server's own explanation, or a status-derived fallback. */
  readonly detail: string
  /** Field-level issues; empty for everything except 422. */
  readonly issues: readonly ValidationIssue[]
  /** The parsed response body, for callers that need more than `detail`. */
  readonly body: unknown

  constructor(
    status: number,
    detail: string,
    options: { issues?: readonly ValidationIssue[]; body?: unknown } = {},
  ) {
    // The message is built from the status and the server's detail only.
    super(`API ${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.issues = options.issues ?? []
    this.body = options.body
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  get isConflict(): boolean {
    return this.status === 409
  }

  get isValidation(): boolean {
    return this.status === 422
  }

  get isServerError(): boolean {
    return this.status >= 500
  }

  /** Field name -> first message, for wiring a 422 straight into a form. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const issue of this.issues) {
      // FastAPI reports ["body", "email"]; the field is the last segment.
      const field = issue.loc.at(-1)
      if (field === undefined) continue
      const key = String(field)
      if (!(key in errors)) errors[key] = issue.msg
    }
    return errors
  }
}

/** The request never reached the server, or the response never arrived. */
export class NetworkError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('The server could not be reached')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

/**
 * The session ended: the refresh token was rejected, so the caller is now
 * signed out. Thrown instead of a bare 401 so a caller can tell "you need to
 * sign in again" apart from "you may not do this".
 */
export class AuthSessionError extends Error {
  readonly cause: unknown

  constructor(message = 'Your session has expired', cause?: unknown) {
    super(message)
    this.name = 'AuthSessionError'
    this.cause = cause
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

const STATUS_FALLBACK: Record<number, string> = {
  400: 'Bad request',
  401: 'Invalid authentication credentials',
  403: 'Insufficient privileges',
  404: 'Not found',
  409: 'Conflict',
  413: 'The file is too large',
  415: 'Unsupported media type',
  422: 'Invalid request',
  503: 'The service is temporarily unavailable',
}

function fallbackDetail(status: number, statusText: string): string {
  return STATUS_FALLBACK[status] ?? (statusText || `Request failed with status ${status}`)
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.loc) &&
    typeof candidate.msg === 'string' &&
    typeof candidate.type === 'string'
  )
}

/**
 * Turns a parsed error body into an `ApiError`.
 *
 * Anything unrecognised falls back to a status-derived message rather than
 * stringifying an unknown payload, which could contain data worth not
 * repeating.
 */
export function toApiError(status: number, statusText: string, body: unknown): ApiError {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail

    if (typeof detail === 'string') {
      return new ApiError(status, detail, { body })
    }

    if (Array.isArray(detail)) {
      const issues = detail.filter(isValidationIssue)
      const first = issues[0]
      return new ApiError(status, first ? first.msg : fallbackDetail(status, statusText), {
        issues,
        body,
      })
    }
  }

  return new ApiError(status, fallbackDetail(status, statusText), { body })
}
