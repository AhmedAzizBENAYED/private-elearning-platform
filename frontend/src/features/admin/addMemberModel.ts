import { isApiError } from '../../api'
import { EMAIL_PATTERN } from '../../shared/validation'

import type { MemberCreateInput } from './api'

export interface AddMemberValues {
  firstName: string
  lastName: string
  email: string
  password: string
}

export type AddMemberErrors = Partial<Record<keyof AddMemberValues, string>>

export const emptyAddMember: AddMemberValues = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
}

/**
 * `app.schemas.member.MemberCreate`, mirrored.
 *
 * `Name` is 1..100 after stripping, the email is at most 320, and `Password`
 * is 12..1024 - the platform's one password policy, the same minimum
 * `/auth/setup-password` has always used. The board's "Use at least 8
 * characters" was a placeholder its Backend-Gaps page marks "to confirm with
 * the API"; the API says twelve, so twelve is what is shown and checked.
 */
export const MEMBER_LIMITS = {
  name: 100,
  email: 320,
  passwordMin: 12,
  passwordMax: 1024,
} as const

/**
 * Client-side checks, for the person filling the form.
 *
 * Every rule restates one the backend enforces, so a form that passes cannot
 * be stricter than the server, and the server's answer still decides. The
 * password is measured exactly as typed - the backend does not strip it, so
 * neither does this.
 */
export function validateAddMember(values: AddMemberValues): AddMemberErrors {
  const errors: AddMemberErrors = {}
  const firstName = values.firstName.trim()
  const lastName = values.lastName.trim()
  const email = values.email.trim()

  if (firstName === '') errors.firstName = 'Enter the member’s first name'
  else if (firstName.length > MEMBER_LIMITS.name) {
    errors.firstName = `Use at most ${MEMBER_LIMITS.name} characters`
  }

  if (lastName === '') errors.lastName = 'Enter the member’s last name'
  else if (lastName.length > MEMBER_LIMITS.name) {
    errors.lastName = `Use at most ${MEMBER_LIMITS.name} characters`
  }

  if (email === '' || !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address'
  else if (email.length > MEMBER_LIMITS.email) {
    errors.email = `Use at most ${MEMBER_LIMITS.email} characters`
  }

  if (values.password.length < MEMBER_LIMITS.passwordMin) {
    errors.password = `Use at least ${MEMBER_LIMITS.passwordMin} characters`
  } else if (values.password.length > MEMBER_LIMITS.passwordMax) {
    errors.password = `Use at most ${MEMBER_LIMITS.passwordMax} characters`
  }

  return errors
}

/**
 * The request body: exactly the four fields `MemberCreate` accepts.
 *
 * Names and address are trimmed, as the backend would; the password is sent
 * as typed. No role, no status - the server sets both, and its schema would
 * refuse them.
 */
export function createMemberBody(values: AddMemberValues): MemberCreateInput {
  return {
    first_name: values.firstName.trim(),
    last_name: values.lastName.trim(),
    email: values.email.trim(),
    password: values.password,
  }
}

/** Why a creation failed, in the terms the dialog shows. */
export type AddMemberFailure =
  | { kind: 'duplicate' }
  | { kind: 'invalid'; fieldErrors: AddMemberErrors }
  | { kind: 'session' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }

/** The backend's field names, as `ApiError.fieldErrors()` keys them. */
const FIELD_OF: Record<string, keyof AddMemberValues> = {
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  password: 'password',
}

/** What a field the server refused is told, in the form's own words. */
const SERVER_FIELD_MESSAGE: Record<keyof AddMemberValues, string> = {
  firstName: `Enter a first name of at most ${MEMBER_LIMITS.name} characters`,
  lastName: `Enter a last name of at most ${MEMBER_LIMITS.name} characters`,
  email: 'Enter a valid email address',
  password: `Use ${MEMBER_LIMITS.passwordMin} to ${MEMBER_LIMITS.passwordMax} characters`,
}

/**
 * Sorts a failure into something the dialog can say.
 *
 * Only the status and the field names are read - never the server's free
 * text, which is written for developers, and never the request, which holds
 * the password.
 */
export function classifyCreateError(error: unknown): AddMemberFailure {
  if (!isApiError(error)) return { kind: 'unavailable' }
  if (error.isConflict) return { kind: 'duplicate' }
  if (error.isUnauthorized) return { kind: 'session' }
  if (error.isForbidden) return { kind: 'forbidden' }
  if (error.isValidation) {
    const fieldErrors: AddMemberErrors = {}
    for (const name of Object.keys(error.fieldErrors())) {
      const field = FIELD_OF[name]
      // The local message for that field: the server's own wording is
      // Pydantic's, and the rule it enforces is the one described locally.
      if (field !== undefined) fieldErrors[field] = SERVER_FIELD_MESSAGE[field]
    }
    return { kind: 'invalid', fieldErrors }
  }
  return { kind: 'unavailable' }
}

/** The banner copy for each failure. The duplicate wording is the board's. */
export const FAILURE_MESSAGE: Record<AddMemberFailure['kind'], { title: string; body: string }> = {
  duplicate: {
    title: 'This email is already used',
    body: 'A member with this email address already exists. Use another address.',
  },
  invalid: {
    title: 'Your changes can’t be saved yet',
    body: 'Check the details you entered, then try again.',
  },
  session: {
    title: 'Your session has expired',
    body: 'Sign in again to continue.',
  },
  forbidden: {
    title: 'You can’t create members',
    body: 'Your administrator access may have changed. Sign in again.',
  },
  unavailable: {
    title: 'We couldn’t create the member',
    body: 'Your details are still here. Check your connection and try again in a moment.',
  },
}
