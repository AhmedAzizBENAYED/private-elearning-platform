/**
 * A plausible email address: something, an `@`, something, a dot, something,
 * and no whitespace anywhere.
 *
 * Deliberately loose. The backend validates with `EmailStr` and is the
 * authority; this only catches the obvious slip before a round trip, so it
 * must never be stricter than the server. One definition, shared by every
 * form that asks for an address.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
