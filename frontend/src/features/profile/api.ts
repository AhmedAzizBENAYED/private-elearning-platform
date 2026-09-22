import type { ApiClient } from '../../api'
import type { User } from '../auth'

/**
 * `app.schemas.member.ProfileUpdate`, mirrored.
 *
 * The names only, each optional; the backend refuses anything else
 * (`extra="forbid"`), so no email, role or status can travel here.
 */
export interface ProfileUpdateInput {
  first_name?: string
  last_name?: string
}

/**
 * `app.schemas.member.PasswordChange`, mirrored.
 *
 * The confirmation is not part of it: it exists on the page only, to catch a
 * typing slip before the request is sent.
 */
export interface PasswordChangeInput {
  current_password: string
  new_password: string
}

/** The signed-in account's own writes (BE-PROFILE-01). */
export interface ProfileApi {
  /** `PATCH /auth/me` -> the updated `UserResponse`. */
  updateProfile: (input: ProfileUpdateInput, signal?: AbortSignal) => Promise<User>
  /**
   * `POST /auth/change-password` -> 204.
   *
   * A wrong current password is a 400, not a 401: the session is valid, so the
   * client's refresh-and-replay never runs for it.
   */
  changePassword: (input: PasswordChangeInput, signal?: AbortSignal) => Promise<void>
}

export function createProfileApi(client: ApiClient): ProfileApi {
  return {
    updateProfile: (input, signal) =>
      client.request<User>('/auth/me', { method: 'PATCH', json: input, signal }),

    changePassword: (input, signal) =>
      client.request<void>('/auth/change-password', { method: 'POST', json: input, signal }),
  }
}
