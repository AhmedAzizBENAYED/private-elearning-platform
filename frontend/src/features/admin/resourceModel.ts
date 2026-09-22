import type { ContentType } from '../../api'
import { isApiError } from '../../api'

import type { AdminLesson, LessonResource } from './api'

/**
 * The rules around a lesson's stored file.
 *
 * Every constraint restated here belongs to the backend and is enforced there:
 * `app/services/resource_rules.py` validates the filename, the declared media
 * type, the extension and the file's leading bytes, and `app/core/config.py`
 * holds the size cap and the two media-type allowlists. Nothing in this module
 * decides whether an upload is acceptable - it decides what to *say* about a
 * file before the round trip, and what to say about the answer that comes back.
 */

// ---------------------------------------------------------------- capabilities

/**
 * The media types the backend ships configured, per lesson kind.
 *
 * These are the defaults of `STORAGE_VIDEO_MIME_TYPES` and
 * `STORAGE_DOCUMENT_MIME_TYPES`. They are used for the file picker's `accept`
 * filter and for the sentence describing what may be chosen - a hint, not a
 * gate.
 *
 * **No endpoint publishes the configured allowlist or the size cap**, so a
 * deployment that widens either one is invisible from here: this frontend
 * would keep suggesting the narrower set while the server accepted more. That
 * is a backend capability gap, reported rather than papered over, and it is
 * also why the local check below never blocks a file the browser is unsure of.
 */
export const ACCEPTED_MIME: Record<'VIDEO' | 'DOCUMENT', readonly string[]> = {
  VIDEO: ['video/mp4'],
  DOCUMENT: ['application/pdf'],
}

/** The extension each configured type must carry (`app/storage/keys.EXTENSIONS`). */
const EXTENSION_OF: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
}

/** The `accept` attribute for the picker: the types plus their extensions. */
export function acceptFor(contentType: 'VIDEO' | 'DOCUMENT'): string {
  const types = ACCEPTED_MIME[contentType]
  return [...types, ...types.map((type) => EXTENSION_OF[type]).filter(Boolean)].join(',')
}

/** "MP4 video" / "PDF document", for the hint under the picker. */
export function acceptSummary(contentType: 'VIDEO' | 'DOCUMENT'): string {
  return contentType === 'VIDEO' ? 'MP4 video' : 'PDF document'
}

/** Which lesson kinds hold a file at all. TEXT and LINK never do. */
export function holdsFile(contentType: ContentType): contentType is 'VIDEO' | 'DOCUMENT' {
  return contentType === 'VIDEO' || contentType === 'DOCUMENT'
}

/** The dropzone's `kind`, which is the same two-value distinction. */
export function dropzoneKind(contentType: 'VIDEO' | 'DOCUMENT'): 'video' | 'document' {
  return contentType === 'VIDEO' ? 'video' : 'document'
}

// ------------------------------------------------------------ local pre-check

/**
 * A reason to tell the person *before* sending, or `null` to send.
 *
 * This restates two of the server's rules - the media type must be configured,
 * and the filename's extension must agree with it - purely so an obviously
 * wrong pick costs no upload. It is not authority: the backend re-checks all of
 * it, plus the file's actual leading bytes, which nothing on this side can
 * honestly verify. A file that passes here can still be refused, and that
 * refusal is what the person is shown.
 *
 * An empty file is rejected here because the backend rejects it too (422
 * "Uploaded file is empty") and sending zero bytes to learn that is pointless.
 * Size is otherwise **not** pre-checked: the cap is a server setting this
 * frontend cannot read, so a guess would either block a legal upload or give
 * false confidence.
 */
export function checkFile(contentType: 'VIDEO' | 'DOCUMENT', file: File): string | null {
  if (file.size === 0) return 'That file is empty.'

  const declared = file.type.split(';', 1)[0].trim().toLowerCase()
  const allowed = ACCEPTED_MIME[contentType]
  const summary = acceptSummary(contentType)

  // A browser that reports no type at all is not evidence of anything; let the
  // server decide rather than refusing a file that may well be valid.
  if (declared !== '' && !allowed.includes(declared)) {
    const article = summary.startsWith('MP4') ? 'an' : 'a'
    return `This lesson takes ${article} ${summary}. Choose a different file.`
  }

  const expected = EXTENSION_OF[declared]
  if (expected !== undefined && !file.name.toLowerCase().endsWith(expected)) {
    return `The file name should end in ${expected}.`
  }

  return null
}

// ------------------------------------------------------------------- failures

export type ResourceFailure =
  | 'not-draft'
  | 'wrong-lesson-kind'
  | 'too-large'
  | 'unsupported-type'
  | 'invalid-file'
  | 'not-found'
  | 'forbidden'
  | 'signed-out'
  | 'storage-down'
  | 'unavailable'

/**
 * Turns a refused resource call into one of the reasons this backend has.
 *
 * 409 is the one ambiguous status: `require_draft` raises it for a course that
 * is no longer a draft, and `require_storage_lesson` raises it for a TEXT or
 * LINK lesson. The server's own `detail` separates them. The text is never
 * shown - it only picks which sentence is.
 */
export function classifyResource(error: unknown): ResourceFailure {
  if (!isApiError(error)) return 'unavailable'

  switch (error.status) {
    case 401:
      return 'signed-out'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 409:
      return /draft/i.test(error.detail) ? 'not-draft' : 'wrong-lesson-kind'
    case 413:
      return 'too-large'
    case 415:
      return 'unsupported-type'
    case 422:
      return 'invalid-file'
    case 503:
      return 'storage-down'
    default:
      return 'unavailable'
  }
}

/** One sentence per reason. No status code and no server trace reaches a reader. */
export const RESOURCE_ERROR: Record<ResourceFailure, string> = {
  'not-draft': 'Files can only be changed while the course is a draft.',
  'wrong-lesson-kind': 'Only video and document lessons can hold a file.',
  'too-large': 'This file is larger than the maximum the server accepts.',
  'unsupported-type': 'This file type is not supported for this lesson.',
  'invalid-file': 'The file was rejected. Check that it is the format the lesson expects.',
  'not-found': 'The lesson no longer exists, or its file has already been removed.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  'signed-out': 'Your session has expired. Sign in again.',
  'storage-down': 'File storage is temporarily unavailable. Try again in a moment.',
  unavailable: 'The file could not be transferred. Check your connection and try again.',
}

// ----------------------------------------------------------------- formatting

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * `12 Mar 2026`.
 *
 * Hand-rolled for the same reason `model.formatDate` is: `Intl.DateTimeFormat`
 * renders the same month as "Sep" or "Sept" depending on the ICU build, which
 * makes an assertion about it a coin toss.
 */
export function formatUploadedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** `1 min 40 s`, or an empty string when the backend probed no duration. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return ''
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/** "PDF" / "MP4" - the subtype, upper-cased, never the raw media type string. */
export function shortType(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? mimeType
  return subtype.split(';')[0].trim().toUpperCase()
}

/**
 * The line describing a stored file, under its name and size.
 *
 * `storage_key`, `storage_provider` and `checksum` are present on the response
 * and deliberately left out: the key is an internal path, the provider is the
 * platform's own vocabulary for infrastructure, and neither means anything to
 * the person managing a course. Nothing identifying the storage backend is
 * rendered anywhere.
 */
export function resourceSummary(resource: LessonResource): string {
  const duration = formatDuration(resource.duration_seconds)
  const uploaded = formatUploadedAt(resource.updated_at)
  return [shortType(resource.mime_type), duration, uploaded === '' ? '' : `uploaded ${uploaded}`]
    .filter((part) => part !== '')
    .join(' · ')
}

/**
 * The lesson as it stands once an upload has answered.
 *
 * A VIDEO lesson's `duration_seconds` is reconciled by the backend from the
 * uploaded media, in the same transaction that writes the resource row and
 * under the same course lock: `LessonResourceService._reconcile_duration`
 * assigns one number to both, commenting that they "are read by different
 * callers and must never disagree". So the duration on the response *is* the
 * lesson's new duration, and reading it costs no second request.
 *
 * Nothing else on the lesson is touched: the upload endpoint takes no lesson
 * fields at all, so the title, description, content type, content, position and
 * preview flag are carried through unchanged from the row already held.
 */
export function lessonAfterUpload(lesson: AdminLesson, resource: LessonResource): AdminLesson {
  return lesson.content_type === 'VIDEO'
    ? { ...lesson, duration_seconds: resource.duration_seconds }
    : lesson
}
