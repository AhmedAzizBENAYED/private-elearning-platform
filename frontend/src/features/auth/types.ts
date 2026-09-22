/**
 * The authentication contracts, transcribed from the live backend
 * (`app/schemas/auth.py`, `app/api/v1/auth.py`).
 *
 * Field names are the backend's own `snake_case`, so these types are a literal
 * mirror of the JSON on the wire and any drift shows up as a type error rather
 * than as a silently undefined property.
 */

/**
 * The backend's role vocabulary (`app.models.user.UserRole`). This is the only
 * role system in the frontend - the design system's `Role` token is the same
 * union, and a test asserts the two stay identical.
 */
export type UserRole = 'ADMIN' | 'MEMBER'

/** `UserResponse` - what `GET /auth/me` returns. No password material. */
export interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  role: UserRole
  created_at: string
  updated_at: string
}

/** Body of `POST /auth/login`. */
export interface LoginRequest {
  email: string
  password: string
}

/** Body of `POST /auth/refresh`. The backend forbids extra fields. */
export interface RefreshRequest {
  refresh_token: string
}

/** `AccessTokenResponse` - what `POST /auth/refresh` returns. */
export interface AccessTokenResponse {
  access_token: string
  token_type: 'bearer'
}

/**
 * `TokenResponse` - what `POST /auth/login` returns.
 *
 * Login is the only endpoint that issues a refresh token. Refresh deliberately
 * does not rotate it, so the session still ends when the original expires.
 */
export interface TokenResponse extends AccessTokenResponse {
  refresh_token: string
}

/** Where the session is, as far as the frontend knows. */
export type AuthStatus = 'unknown' | 'unauthenticated' | 'authenticated'

export interface AuthState {
  status: AuthStatus
  user: User | null
  /**
   * Set when a signed-in session ended on its own - the server refused to
   * renew it - rather than by signing out, so the login page can say so
   * (Login-States "Session expired"). Absent otherwise.
   */
  expired?: true
}
