import { AuthSessionError, isApiError } from '../../api'
import type { User } from '../auth'

import type { PasswordChangeInput, ProfileUpdateInput } from './api'

/**
 * The backend's limits (`app/schemas/member.py`).
 *
 * `Name` is 1..100 after stripping. `Password` is 12..1024 - the platform's
 * one password policy, with no composition rule. The board's "At least 8
 * characters", "Contains a letter and a number" and "Different from your
 * current password" are a proposal it marks "to confirm with the API"; the API
 * enforces length only, so length is the one requirement shown and checked.
 */
export const PROFILE_LIMITS = {
  name: 100,
  passwordMin: 12,
  passwordMax: 1024,
} as const

// ------------------------------------------------------------------ profile

export interface ProfileValues {
  firstName: string
  lastName: string
}

export type ProfileErrors = Partial<Record<keyof ProfileValues, string>>

/**
 * Whose names these are. The same rules serve the signed-in account's own
 * profile and an administrator editing a member (Admin-Member-Edit), so the
 * two forms cannot drift apart; only the wording of an empty field differs.
 */
type Named = Pick<User, 'first_name' | 'last_name'>

export function profileValuesFrom(user: Named): ProfileValues {
  return { firstName: user.first_name, lastName: user.last_name }
}

/**
 * Whether anything would actually change. Compared after trimming, as the
 * backend stores the names, so adding a trailing space is not a change.
 */
export function isProfileDirty(values: ProfileValues, user: Named): boolean {
  return values.firstName.trim() !== user.first_name || values.lastName.trim() !== user.last_name
}

/** Profile-States "Edit - validation errors": one message per empty field. */
export function validateProfile(values: ProfileValues, subject: 'self' | 'member' = 'self'): ProfileErrors {
  const errors: ProfileErrors = {}
  const firstName = values.firstName.trim()
  const lastName = values.lastName.trim()
  // "Enter your first name" is the board's copy for one's own profile; said to
  // an administrator about someone else's, "your" would be wrong.
  const whose = subject === 'self' ? 'your' : 'the member’s'

  if (firstName === '') errors.firstName = `Enter ${whose} first name`
  else if (firstName.length > PROFILE_LIMITS.name) {
    errors.firstName = `Use at most ${PROFILE_LIMITS.name} characters`
  }

  if (lastName === '') errors.lastName = `Enter ${whose} last name`
  else if (lastName.length > PROFILE_LIMITS.name) {
    errors.lastName = `Use at most ${PROFILE_LIMITS.name} characters`
  }

  return errors
}

/**
 * The PATCH body: only the names that changed, trimmed.
 *
 * Nothing else is ever put in it - the backend would refuse an email, a role
 * or a status, and this form has no way to produce one.
 */
export function profilePatch(values: ProfileValues, user: Named): ProfileUpdateInput {
  const patch: ProfileUpdateInput = {}
  const firstName = values.firstName.trim()
  const lastName = values.lastName.trim()
  if (firstName !== user.first_name) patch.first_name = firstName
  if (lastName !== user.last_name) patch.last_name = lastName
  return patch
}

export type ProfileFailure =
  | { kind: 'invalid'; fieldErrors: ProfileErrors }
  | { kind: 'session' }
  | { kind: 'unavailable' }

const PROFILE_FIELD_OF: Record<string, keyof ProfileValues> = {
  first_name: 'firstName',
  last_name: 'lastName',
}

/**
 * Sorts a failed save into what the page can say. Only the status and the
 * field names are read - never the server's free text.
 */
export function classifyProfileError(error: unknown): ProfileFailure {
  if (error instanceof AuthSessionError) return { kind: 'session' }
  if (!isApiError(error)) return { kind: 'unavailable' }
  if (error.isUnauthorized) return { kind: 'session' }
  if (error.isValidation) {
    const fieldErrors: ProfileErrors = {}
    for (const name of Object.keys(error.fieldErrors())) {
      const field = PROFILE_FIELD_OF[name]
      if (field !== undefined) {
        fieldErrors[field] = `Enter a name of 1 to ${PROFILE_LIMITS.name} characters`
      }
    }
    return { kind: 'invalid', fieldErrors }
  }
  return { kind: 'unavailable' }
}

/** Banner copy. "Validation" and "server error" are the board's own words. */
export const PROFILE_MESSAGES = {
  validation: {
    title: 'Your changes can’t be saved yet',
    body: 'Fill in the two fields below, then try again.',
  },
  invalid: {
    title: 'Your changes can’t be saved yet',
    body: 'Check the fields below, then try again.',
  },
  session: {
    title: 'Your session has expired',
    body: 'Sign in again to continue.',
  },
  unavailable: {
    title: 'We couldn’t save your changes',
    body: 'Your changes are still on this page. Try again in a moment.',
  },
} as const

// ----------------------------------------------------------------- password

export interface PasswordValues {
  current: string
  next: string
  confirm: string
}

export type PasswordErrors = Partial<Record<keyof PasswordValues, string>>

export const emptyPassword: PasswordValues = { current: '', next: '', confirm: '' }

/**
 * Password-States' meter: "Strength: Weak / Fair / Strong", with the board's
 * own caveat beside it, "A guide only. The requirements above are what count."
 *
 * The backend has no strength rule (length only), so this is a heuristic and
 * never gates anything: below the required length is weak; a long password,
 * or a long-enough one mixing three kinds of character, is strong; the rest is
 * fair. A long single-kind passphrase is not punished for being all letters.
 */
export type PasswordStrength = 'weak' | 'fair' | 'strong'

export function passwordStrength(password: string): PasswordStrength | null {
  if (password === '') return null
  if (password.length < PROFILE_LIMITS.passwordMin) return 'weak'
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length
  if (password.length >= 20 || (password.length >= 16 && kinds >= 3)) return 'strong'
  if (kinds === 1) return 'weak'
  return 'fair'
}

/** The one requirement the backend has, measured exactly as typed. */
export function meetsLength(password: string): boolean {
  return password.length >= PROFILE_LIMITS.passwordMin && password.length <= PROFILE_LIMITS.passwordMax
}

/**
 * Password-States: "Update password" stays disabled until the three fields
 * are filled, every requirement is met and both entries match.
 */
export function isPasswordReady(values: PasswordValues): boolean {
  return (
    values.current !== '' &&
    meetsLength(values.next) &&
    values.confirm !== '' &&
    values.confirm === values.next
  )
}

/** The line next to the button, which says why it is disabled. */
export function passwordReason(values: PasswordValues): string {
  return isPasswordReady(values)
    ? 'Ready to update'
    : 'Fill in all fields and meet every requirement to continue.'
}

/** Only the confirmation is judged while typing; the board draws no other live error. */
export function confirmError(values: PasswordValues): string | undefined {
  if (values.confirm === '' || values.confirm === values.next) return undefined
  return 'The two passwords don’t match'
}

/** The request body: the two passwords, as typed. Never the confirmation. */
export function passwordBody(values: PasswordValues): PasswordChangeInput {
  return { current_password: values.current, new_password: values.next }
}

export type PasswordFailure =
  | { kind: 'wrong-current' }
  | { kind: 'invalid'; fieldErrors: PasswordErrors }
  | { kind: 'session' }
  | { kind: 'unavailable' }

const PASSWORD_FIELD_MESSAGE: Record<string, [keyof PasswordValues, string]> = {
  current_password: ['current', 'Enter your current password'],
  new_password: [
    'next',
    `Use ${PROFILE_LIMITS.passwordMin} to ${PROFILE_LIMITS.passwordMax} characters`,
  ],
}

/**
 * Sorts a failed change. A 400 is the wrong current password - a form error,
 * reported on that field, and nothing to do with the session.
 */
export function classifyPasswordError(error: unknown): PasswordFailure {
  if (error instanceof AuthSessionError) return { kind: 'session' }
  if (!isApiError(error)) return { kind: 'unavailable' }
  if (error.status === 400) return { kind: 'wrong-current' }
  if (error.isUnauthorized) return { kind: 'session' }
  if (error.isValidation) {
    const fieldErrors: PasswordErrors = {}
    for (const name of Object.keys(error.fieldErrors())) {
      const entry = PASSWORD_FIELD_MESSAGE[name]
      if (entry !== undefined) fieldErrors[entry[0]] = entry[1]
    }
    return { kind: 'invalid', fieldErrors }
  }
  return { kind: 'unavailable' }
}

/** Password-States copy, word for word where the board has it. */
export const PASSWORD_MESSAGES: Record<PasswordFailure['kind'], { title: string; body: string }> = {
  'wrong-current': {
    title: 'We couldn’t update your password',
    body: 'Check your current password and try again.',
  },
  invalid: {
    title: 'We couldn’t update your password',
    body: 'Check the fields below, then try again.',
  },
  session: {
    title: 'Your session has expired',
    body: 'Sign in again to continue.',
  },
  unavailable: {
    title: 'We couldn’t update your password',
    body: 'Nothing was changed. Your entries are still here. Try again in a moment.',
  },
}

export const WRONG_CURRENT_FIELD = 'Your current password is incorrect'
