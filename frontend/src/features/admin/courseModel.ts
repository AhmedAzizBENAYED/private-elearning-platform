import type { CourseStatus } from '../../api'

import type { AdminCourse, CourseCreateInput } from './api'
import type { CourseWriteFailure } from './useAdminCourse'

/**
 * The course lifecycle, exactly as `CourseService._transition` enforces it.
 *
 *   DRAFT --publish--> PUBLISHED --archive--> ARCHIVED
 *
 * One direction, one step at a time. There is no transition out of ARCHIVED and
 * none back from PUBLISHED: the service computes the *required* source status
 * for a target and answers 409 for anything else, so "unpublish" is not a
 * capability the API withholds - it does not exist. Both transitions are
 * idempotent: asking for the status a course already has changes nothing and
 * still answers 200.
 */
export type CourseTransition = 'publish' | 'archive'

/** The transition a course may make next, or `null` when it is at the end. */
export function nextTransition(status: CourseStatus): CourseTransition | null {
  if (status === 'DRAFT') return 'publish'
  if (status === 'PUBLISHED') return 'archive'
  return null
}

/**
 * Whether the backend will accept an edit.
 *
 * `CourseService.update` calls `require_draft`, which answers 409 "Only DRAFT
 * courses can be edited" for anything else. The action is hidden rather than
 * offered and then refused - but the edit page still handles the 409, because
 * a course can be published in another tab between the two.
 */
export function isEditable(course: Pick<AdminCourse, 'status'>): boolean {
  return course.status === 'DRAFT'
}

export const STATUS_LABEL: Record<CourseStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
}

// ------------------------------------------------------------------ the form

/**
 * The one sentence shown above the form when the server refuses the whole
 * write. Shared by the course form and the editor's Course information card.
 */
export const FORM_ERROR: Record<CourseWriteFailure, string> = {
  'slug-taken': 'Another course already uses that address. Choose a different one.',
  'not-draft': 'This course is no longer a draft, so it can’t be edited any more.',
  lifecycle: 'The course is no longer in a state that allows this change.',
  invalid: 'Some of the details were rejected. Check the fields below.',
  'not-found': 'This course no longer exists.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  unavailable: 'The course could not be saved. Check your connection and try again.',
}


/**
 * What `PUT /admin/courses/{id}/thumbnail` accepts (`app/services/image_rules.py`).
 *
 * Checked here only so an obviously wrong file is refused without sending it;
 * the server checks the same two rules again, and also that the bytes really
 * are an image, which only it can do.
 */
export const THUMBNAIL_TYPES = ['image/png', 'image/jpeg'] as const
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024

/** Why a thumbnail upload did not happen, in the card's vocabulary. */
export type ThumbnailFailure =
  | 'type'
  | 'too-large'
  | 'empty'
  | 'invalid'
  | 'dimensions'
  | 'not-draft'
  | 'not-found'
  | 'forbidden'
  | 'network'
  | 'unavailable'

export const THUMBNAIL_ERROR: Record<ThumbnailFailure, string> = {
  type: 'Choose a PNG or JPEG image.',
  'too-large': 'Choose an image of 5 MB or less.',
  empty: 'That file is empty. Choose another image.',
  invalid: 'That file isn’t a valid PNG or JPEG image. Choose another one.',
  dimensions: 'That image is too large. Use one at most 16,384 pixels on a side.',
  'not-draft': FORM_ERROR['not-draft'],
  'not-found': FORM_ERROR['not-found'],
  forbidden: FORM_ERROR.forbidden,
  network: 'The image could not be uploaded. Check your connection and try again.',
  unavailable: 'The image could not be uploaded. Try again in a moment.',
}

/** The same rules as the server's type and size checks, or `null` to send it. */
export function checkThumbnail(file: File): ThumbnailFailure | null {
  if (!(THUMBNAIL_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > THUMBNAIL_MAX_BYTES) return 'too-large'
  if (file.size === 0) return 'empty'
  return null
}

export interface CourseFormValues {
  title: string
  description: string
  slug: string
  thumbnailUrl: string
}

export type CourseFieldErrors = Partial<Record<keyof CourseFormValues, string>>

/** `app.schemas.content` and `app.schemas.course`, mirrored for the field hints. */
export const LIMITS = {
  title: 200,
  description: 20_000,
  slug: 200,
  thumbnailUrl: 2048,
} as const

/** `app.schemas.course.Slug`. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const emptyCourseForm: CourseFormValues = {
  title: '',
  description: '',
  slug: '',
  thumbnailUrl: '',
}

export function formFromCourse(course: AdminCourse): CourseFormValues {
  return {
    title: course.title,
    description: course.description,
    slug: course.slug,
    thumbnailUrl: course.thumbnail_url ?? '',
  }
}

/**
 * Client-side checks, for the person filling the form only.
 *
 * Every rule here restates one the backend already enforces - `Title` and
 * `Description` are 1..200 and 1..20000 after stripping, `Slug` matches
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$`, `Thumbnail` is an `HttpUrl` - so a form that
 * passes cannot be stricter than the server, and the server's answer is still
 * what decides. Nothing here is a rule the API does not have.
 */
export function validateCourseForm(values: CourseFormValues): CourseFieldErrors {
  const errors: CourseFieldErrors = {}
  const title = values.title.trim()
  const description = values.description.trim()
  const slug = values.slug.trim()
  const thumbnail = values.thumbnailUrl.trim()

  if (title === '') errors.title = 'Enter a course title'
  else if (title.length > LIMITS.title) errors.title = `Use at most ${LIMITS.title} characters`

  if (description === '') errors.description = 'Enter a course description'
  else if (description.length > LIMITS.description) {
    errors.description = `Use at most ${LIMITS.description} characters`
  }

  if (slug !== '') {
    if (slug.length > LIMITS.slug) errors.slug = `Use at most ${LIMITS.slug} characters`
    else if (!SLUG_PATTERN.test(slug)) {
      errors.slug = 'Use lowercase letters, digits and single hyphens, for example course-name'
    }
  }

  if (thumbnail !== '') {
    if (thumbnail.length > LIMITS.thumbnailUrl) {
      errors.thumbnailUrl = `Use at most ${LIMITS.thumbnailUrl} characters`
    } else if (!isHttpUrl(thumbnail)) {
      errors.thumbnailUrl = 'Enter a full http(s) address'
    }
  }

  return errors
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The create body.
 *
 * `slug` is omitted when blank so `CourseService.create` generates one from the
 * title, which is the backend's own behaviour and not something to reproduce
 * here. `thumbnail_url` is omitted rather than sent as null: on create it is
 * simply absent.
 */
export function createBodyFrom(values: CourseFormValues): CourseCreateInput {
  const body: CourseCreateInput = {
    title: values.title.trim(),
    description: values.description.trim(),
  }
  const slug = values.slug.trim()
  if (slug !== '') body.slug = slug
  const thumbnail = values.thumbnailUrl.trim()
  if (thumbnail !== '') body.thumbnail_url = thumbnail
  return body
}

/**
 * The patch body: only what actually changed.
 *
 * `ContentPatch` rejects an empty body ("Provide at least one field to
 * update"), so an unchanged form is never submitted. `thumbnail_url` is the one
 * field that may be sent as `null`, which is how it is cleared; every other
 * field would be rejected as null.
 */
export function patchFrom(
  values: CourseFormValues,
  original: CourseFormValues,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  const title = values.title.trim()
  const description = values.description.trim()
  const slug = values.slug.trim()
  const thumbnail = values.thumbnailUrl.trim()

  if (title !== original.title.trim()) patch.title = title
  if (description !== original.description.trim()) patch.description = description
  if (slug !== original.slug.trim() && slug !== '') patch.slug = slug
  if (thumbnail !== original.thumbnailUrl.trim()) {
    patch.thumbnail_url = thumbnail === '' ? null : thumbnail
  }

  return patch
}

/** Whether the form differs from what was loaded. */
export function isDirty(values: CourseFormValues, original: CourseFormValues): boolean {
  return Object.keys(patchFrom(values, original)).length > 0
}
