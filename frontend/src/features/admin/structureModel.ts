import type { ContentType } from '../../api'
import type { IconName } from '../../design-system'

import type {
  AdminLesson,
  AdminModule,
  LessonCreateInput,
  LessonResource,
  ModuleCreateInput,
} from './api'
import { shortType } from './resourceModel'

/**
 * The course structure, and the rules the backend actually enforces on it.
 *
 * Every constraint restated here was measured against the running API, not
 * inferred: positions are required and unique per parent, `duration_seconds`
 * belongs to VIDEO alone, and each content type accepts a different shape of
 * `content`. See `app/services/lesson_service.validate_content`.
 */

export interface ModuleWithLessons {
  module: AdminModule
  lessons: AdminLesson[]
  /** The lessons could not be read; the module still renders. */
  lessonsFailed: boolean
}

/** Ascending by the backend's own `position`. */
export function byPosition<Item extends { position: number }>(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => a.position - b.position)
}

/**
 * The first position not already taken.
 *
 * Positions are unique per parent - `uq_modules_course_position` and
 * `uq_lessons_module_position` - and a collision is a 409, so the form offers
 * a free one rather than letting the administrator guess.
 */
export function nextPosition(items: readonly { position: number }[]): number {
  const taken = new Set(items.map((item) => item.position))
  let candidate = 1
  while (taken.has(candidate)) candidate += 1
  return candidate
}

// --------------------------------------------------------------- lesson kinds

export const CONTENT_TYPES: ContentType[] = ['VIDEO', 'DOCUMENT', 'TEXT', 'LINK']

/** Which kinds keep their payload as a stored file rather than as readable text. */
const STORED = new Set<ContentType>(['VIDEO', 'DOCUMENT'])

export function isStored(contentType: ContentType): boolean {
  return STORED.has(contentType)
}

/**
 * The placeholder a resource-backed lesson is created with.
 *
 * `validate_content` requires a non-blank `content` even for a lesson whose
 * real payload is a file that does not exist yet, so one has to be written at
 * creation. `storage://videos/pending` and `storage://documents/pending` are
 * the codebase's own convention, used throughout `app/tests`. The value is
 * inert: nothing reads a stored lesson's `content` - `catalog_get` blanks it
 * for members, and the resource service works from `lesson_resources` instead.
 */
export function placeholderContent(contentType: ContentType): string {
  return contentType === 'VIDEO' ? 'storage://videos/pending' : 'storage://documents/pending'
}

/**
 * What the `content` field means, for the two kinds where the administrator
 * writes it. A VIDEO or DOCUMENT lesson has no such field on the form:
 * Admin-Lesson-Editor - "The UI never shows a storage-provider URL or name" -
 * so its `content` (the placeholder above, or the value the server holds) is
 * carried along unseen and its file is managed by the file field instead.
 *
 * The wording is Admin-Lesson-Types' own: "Content" / "This text is what
 * members read in the lesson." and "URL" / "Members open this address in a new
 * tab."
 */
export const CONTENT_HELP: Record<'TEXT' | 'LINK', string> = {
  TEXT: 'This text is what members read in the lesson.',
  LINK: 'Members open this address in a new tab.',
}

export const CONTENT_LABEL: Record<'TEXT' | 'LINK', string> = {
  TEXT: 'Content',
  LINK: 'URL',
}

/** The segmented control's options (DS 05, Admin-Lesson-Editor). */
export const TYPE_LABEL: Record<ContentType, string> = {
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  TEXT: 'Text',
  LINK: 'Link',
}

export const TYPE_ICON: Record<ContentType, IconName> = {
  VIDEO: 'video',
  DOCUMENT: 'doc',
  TEXT: 'text',
  LINK: 'link',
}

// ------------------------------------------------------------------ durations

/**
 * `08:30` from 510 seconds - the board's "Format mm:ss".
 *
 * The backend stores whole seconds (`duration_seconds`); minutes are not
 * capped at 59, so a 75-minute video reads `75:00` rather than switching to a
 * format the field does not accept.
 */
export function formatDurationInput(seconds: number | null): string {
  if (seconds === null || !Number.isInteger(seconds) || seconds < 0) return ''
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

const DURATION_INPUT = /^(\d{1,6}):([0-5]\d)$/

/** Seconds from `mm:ss`, or `null` when the text is not in that format. */
export function parseDurationInput(raw: string): number | null {
  const match = DURATION_INPUT.exec(raw.trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

// ------------------------------------------------------------------- the forms

export interface ModuleFormValues {
  title: string
  description: string
  position: string
}

export interface LessonFormValues {
  title: string
  description: string
  contentType: ContentType
  content: string
  durationSeconds: string
  position: string
  isPreview: boolean
}

export type FieldErrors<Values> = Partial<Record<keyof Values, string>>

/** `app.schemas.content` / `app.schemas.lesson`, mirrored for the field hints. */
export const LIMITS = {
  title: 200,
  description: 20_000,
  /** `Content` is 1..100000, but a stored reference is capped at 2048. */
  content: 100_000,
  reference: 2048,
  position: 2_147_483_647,
  duration: 2_147_483_647,
} as const

const STORAGE_REFERENCE = /^storage:\/\/[A-Za-z0-9][A-Za-z0-9._/-]*$/

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    // `validate_content` rejects credentials in the URL.
    return url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** The backend's traversal guard: no empty, `.` or `..` segment after the scheme. */
function isSafeStorageReference(raw: string): boolean {
  if (!STORAGE_REFERENCE.test(raw)) return false
  return raw
    .slice('storage://'.length)
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..')
}

function positionError(raw: string): string | undefined {
  const value = Number(raw.trim())
  if (raw.trim() === '') return 'Enter a position'
  if (!Number.isInteger(value) || value < 1) return 'Use a whole number, 1 or more'
  if (value > LIMITS.position) return 'That position is too large'
  return undefined
}

export function validateModuleForm(values: ModuleFormValues): FieldErrors<ModuleFormValues> {
  const errors: FieldErrors<ModuleFormValues> = {}
  const title = values.title.trim()

  if (title === '') errors.title = 'Enter a module title'
  else if (title.length > LIMITS.title) errors.title = `Use at most ${LIMITS.title} characters`

  if (values.description.trim().length > LIMITS.description) {
    errors.description = `Use at most ${LIMITS.description} characters`
  }

  const position = positionError(values.position)
  if (position !== undefined) errors.position = position

  return errors
}

/**
 * Client-side checks for a lesson, restating only what the server enforces.
 *
 * The content rules come straight from `validate_content`: a stored kind takes
 * a `storage://` reference or an http(s) URL with no whitespace and at most
 * 2048 characters, a LINK takes only the URL, and TEXT takes anything that is
 * not blank. The server still decides.
 */
export function validateLessonForm(values: LessonFormValues): FieldErrors<LessonFormValues> {
  const errors: FieldErrors<LessonFormValues> = {}
  const title = values.title.trim()
  const content = values.content.trim()

  if (title === '') errors.title = 'Enter a lesson title'
  else if (title.length > LIMITS.title) errors.title = `Use at most ${LIMITS.title} characters`

  if (values.description.trim().length > LIMITS.description) {
    errors.description = `Use at most ${LIMITS.description} characters`
  }

  if (content === '') {
    errors.content = 'Lesson content must not be blank'
  } else if (values.contentType === 'TEXT') {
    if (content.length > LIMITS.content) errors.content = `Use at most ${LIMITS.content} characters`
  } else if (content.length > LIMITS.reference || /\s/.test(content)) {
    errors.content = `Use at most ${LIMITS.reference} characters, without spaces`
  } else if (values.contentType === 'LINK') {
    if (!isHttpUrl(content)) errors.content = 'Enter a full http(s) address, without credentials'
  } else if (!isSafeStorageReference(content) && !isHttpUrl(content)) {
    errors.content = 'Enter a storage:// reference or a full http(s) address'
  }

  const position = positionError(values.position)
  if (position !== undefined) errors.position = position

  const duration = values.durationSeconds.trim()
  if (duration !== '') {
    if (values.contentType !== 'VIDEO') {
      errors.durationSeconds = 'A duration is only allowed for a VIDEO lesson'
    } else {
      const seconds = parseDurationInput(duration)
      // Admin-Lesson-Types draws this exact message under an invalid "8:3".
      if (seconds === null) errors.durationSeconds = 'Use the mm:ss format, for example 08:30'
      else if (seconds < 1) errors.durationSeconds = 'Enter a duration of at least 00:01'
    }
  }

  return errors
}

export function emptyModuleForm(position: number): ModuleFormValues {
  return { title: '', description: '', position: String(position) }
}

export function moduleFormFrom(module: AdminModule): ModuleFormValues {
  return {
    title: module.title,
    description: module.description ?? '',
    position: String(module.position),
  }
}

export function emptyLessonForm(position: number): LessonFormValues {
  return {
    title: '',
    description: '',
    contentType: 'VIDEO',
    content: placeholderContent('VIDEO'),
    durationSeconds: '',
    position: String(position),
    isPreview: false,
  }
}

export function lessonFormFrom(lesson: AdminLesson): LessonFormValues {
  return {
    title: lesson.title,
    description: lesson.description ?? '',
    contentType: lesson.content_type,
    content: lesson.content,
    durationSeconds: formatDurationInput(lesson.duration_seconds),
    position: String(lesson.position),
    isPreview: lesson.is_preview,
  }
}

// ------------------------------------------------------------------- bodies

export function moduleCreateBody(values: ModuleFormValues): ModuleCreateInput {
  const body: ModuleCreateInput = {
    title: values.title.trim(),
    position: Number(values.position),
  }
  const description = values.description.trim()
  if (description !== '') body.description = description
  return body
}

/**
 * Only what changed.
 *
 * `ContentPatch` rejects an empty body, and rejects a null for every field
 * except `description`, which is how it is cleared.
 */
export function modulePatch(
  values: ModuleFormValues,
  original: ModuleFormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (values.title.trim() !== original.title.trim()) patch.title = values.title.trim()
  if (values.description.trim() !== original.description.trim()) {
    patch.description = values.description.trim() === '' ? null : values.description.trim()
  }
  if (values.position.trim() !== original.position.trim()) patch.position = Number(values.position)
  return patch
}

export function lessonCreateBody(values: LessonFormValues): LessonCreateInput {
  const body: LessonCreateInput = {
    title: values.title.trim(),
    content_type: values.contentType,
    content: values.contentType === 'TEXT' ? values.content : values.content.trim(),
    position: Number(values.position),
    is_preview: values.isPreview,
  }
  const description = values.description.trim()
  if (description !== '') body.description = description
  // Sent for VIDEO alone: any other kind is a 422 from `validate_content`.
  const duration = parseDurationInput(values.durationSeconds)
  if (values.contentType === 'VIDEO' && duration !== null) body.duration_seconds = duration
  return body
}

export function lessonPatch(
  values: LessonFormValues,
  original: LessonFormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const content = values.contentType === 'TEXT' ? values.content : values.content.trim()
  const originalContent =
    original.contentType === 'TEXT' ? original.content : original.content.trim()

  if (values.title.trim() !== original.title.trim()) patch.title = values.title.trim()
  if (values.description.trim() !== original.description.trim()) {
    patch.description = values.description.trim() === '' ? null : values.description.trim()
  }
  if (values.contentType !== original.contentType) patch.content_type = values.contentType
  if (content !== originalContent) patch.content = content
  if (values.position.trim() !== original.position.trim()) patch.position = Number(values.position)
  if (values.isPreview !== original.isPreview) patch.is_preview = values.isPreview

  // Compared as seconds, so "2:00" and "02:00" are the same duration.
  const duration = parseDurationInput(values.durationSeconds)
  const originalDuration = parseDurationInput(original.durationSeconds)
  if (values.contentType !== 'VIDEO') {
    // Leaving VIDEO must clear the duration, or the server refuses the patch:
    // it validates the *resulting* lesson, not only the fields that changed.
    if (originalDuration !== null) patch.duration_seconds = null
  } else if (duration !== originalDuration) {
    patch.duration_seconds = duration
  }

  return patch
}

/**
 * Whether the form differs from what it started from, as typed.
 *
 * Raw rather than parsed, so an invalid entry such as "8:3" still counts as a
 * change: Save stays enabled and the validation message can be reached. The
 * patch itself is still computed from parsed values.
 */
export function isLessonFormDirty(values: LessonFormValues, initial: LessonFormValues): boolean {
  return (
    values.title.trim() !== initial.title.trim() ||
    values.description.trim() !== initial.description.trim() ||
    values.contentType !== initial.contentType ||
    values.content !== initial.content ||
    values.durationSeconds.trim() !== initial.durationSeconds.trim() ||
    values.position.trim() !== initial.position.trim() ||
    values.isPreview !== initial.isPreview
  )
}

// ------------------------------------------------------------------ the rows

/** How many words a TEXT lesson holds, for the row's "Text · 240 words". */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word !== '').length
}

/** A LINK lesson's host, without `www.`; empty when the text is not a URL. */
export function linkHost(raw: string): string {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export interface LessonMeta {
  text: string
  /** A VIDEO or DOCUMENT lesson that holds no file yet. */
  missingFile: boolean
}

/**
 * The line under a lesson's title in the structure (Admin-Course-Editor):
 * "06:10 · know-your-reader.mp4", "PDF · email-templates.pdf",
 * "Text · 240 words", or "No video uploaded yet".
 *
 * A VIDEO's duration is the lesson's own `duration_seconds`, which the backend
 * reconciles from the file on upload, so it and the file never disagree.
 */
export function lessonMeta(
  lesson: AdminLesson,
  resource: LessonResource | null,
  resourcesFailed: boolean,
): LessonMeta {
  switch (lesson.content_type) {
    case 'VIDEO':
    case 'DOCUMENT': {
      if (resourcesFailed) return { text: 'File status unavailable', missingFile: false }
      if (resource === null) {
        const noun = lesson.content_type === 'VIDEO' ? 'video' : 'document'
        return { text: `No ${noun} uploaded yet`, missingFile: true }
      }
      const lead =
        lesson.content_type === 'VIDEO'
          ? formatDurationInput(lesson.duration_seconds ?? resource.duration_seconds)
          : shortType(resource.mime_type)
      return {
        text: [lead, resource.filename].filter((part) => part !== '').join(' · '),
        missingFile: false,
      }
    }
    case 'TEXT': {
      const words = wordCount(lesson.content)
      return { text: `Text · ${words} ${words === 1 ? 'word' : 'words'}`, missingFile: false }
    }
    case 'LINK': {
      const host = linkHost(lesson.content)
      return { text: host === '' ? 'Link' : `Link · ${host}`, missingFile: false }
    }
  }
}

// ------------------------------------------------------------ notices

/**
 * What the lesson editor tells the course editor it returns to - "Lesson
 * saved", "Lesson deleted" - carried in the history entry's state, read once
 * and then dropped from it, as the member edit does for the members list.
 */
export interface LessonNotice {
  lessonNotice: { title: string; body: string }
}

export function isLessonNotice(state: unknown): state is LessonNotice {
  if (typeof state !== 'object' || state === null || !('lessonNotice' in state)) return false
  const notice = (state as { lessonNotice: unknown }).lessonNotice
  return (
    typeof notice === 'object' &&
    notice !== null &&
    typeof (notice as { title?: unknown }).title === 'string' &&
    typeof (notice as { body?: unknown }).body === 'string'
  )
}
