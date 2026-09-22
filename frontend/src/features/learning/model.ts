export { safeExternalUrl } from '../../shared/safeExternalUrl'

import type { ContentType, CourseContent, CourseContentLesson, UUID } from '../../api'
import { byPosition } from '../courses'

/**
 * The learning page's view of a course: which lesson the URL asked for, where
 * it sits, and what comes before and after it.
 *
 * Every ordering here goes through `byPosition` (FE-06's single strategy), so
 * the sidebar, the "Lesson 2 of 6" line and previous/next can never disagree
 * with each other or with the course details outline.
 */

export interface LessonRef {
  id: UUID
  title: string
}

export interface LessonPlacement {
  lesson: CourseContentLesson
  module: { id: UUID; title: string; position: number }
  /** 1-based, within the module - the design's "Lesson 2 of 6". */
  numberInModule: number
  lessonsInModule: number
  previous: LessonRef | null
  next: LessonRef | null
}

/** Every lesson of the course, in the order a member walks them. */
export function orderedLessons(
  content: CourseContent,
): { lesson: CourseContentLesson; moduleId: UUID }[] {
  return byPosition(content.modules).flatMap((module) =>
    byPosition(module.lessons).map((lesson) => ({ lesson, moduleId: module.id })),
  )
}

/**
 * Locates the lesson the URL names.
 *
 * Returns `null` when the id belongs to no lesson of this course. The caller
 * must then show an "unavailable" state: silently falling back to the first
 * lesson would let a wrong URL display unrelated content as though it were the
 * one that was asked for.
 */
export function placeLesson(content: CourseContent, lessonId: UUID): LessonPlacement | null {
  const flat = orderedLessons(content)
  const index = flat.findIndex((entry) => entry.lesson.id === lessonId)
  if (index === -1) return null

  const entry = flat[index]
  if (entry === undefined) return null

  const module = byPosition(content.modules).find((candidate) => candidate.id === entry.moduleId)
  if (module === undefined) return null

  const siblings = byPosition(module.lessons)
  const previous = flat[index - 1]?.lesson
  const next = flat[index + 1]?.lesson

  return {
    lesson: entry.lesson,
    module: { id: module.id, title: module.title, position: module.position },
    numberInModule: siblings.findIndex((candidate) => candidate.id === lessonId) + 1,
    lessonsInModule: siblings.length,
    // Previous/next cross module boundaries, because the course reads as one
    // sequence - the same sequence `orderedLessons` defines.
    previous: previous ? { id: previous.id, title: previous.title } : null,
    next: next ? { id: next.id, title: next.title } : null,
  }
}

/**
 * Lesson kinds whose payload is a stored file reference.
 *
 * `LessonService.catalog_get` blanks `content` for exactly these two, so asking
 * `GET /lessons/{id}` for one would return `content: null` and tell the page
 * nothing it does not already have from the course tree.
 */
const STORED_CONTENT_TYPES = new Set<ContentType>(['VIDEO', 'DOCUMENT'])

/** Whether the selected lesson needs its own detail request. */
export function needsLessonContent(contentType: ContentType): boolean {
  return !STORED_CONTENT_TYPES.has(contentType)
}


/**
 * Where playback should start, given what the backend has recorded.
 *
 * `watched_seconds` is the furthest position the server has stored for this
 * member, so it is the authoritative resume point - but it is clamped here,
 * because a value at or past the duration would either be rejected by the
 * media element or fire `ended` before a frame played.
 */
export function resumePosition(
  watchedSeconds: number | null,
  completed: boolean | null,
  duration: number,
): number {
  // A finished lesson opens at the beginning: the design offers "Replay", and
  // dropping someone at the last frame of a video they completed is not resume.
  if (completed === true) return 0
  if (watchedSeconds === null || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(Math.max(watchedSeconds, 0), Math.max(duration - 1, 0))
}

/**
 * The lesson that finished the course, where the Course-Completed screen is
 * shown - or `null` while the course is not complete.
 *
 * "Complete" is the backend's own verdict (`CourseContent.completed`: every
 * VIDEO lesson done, and at least one), never inferred here. The lesson is
 * the video completed last, by the `completed_at` the server stored, so the
 * screen is found again after navigating away or reloading; a tie falls to
 * the later lesson in the course's order. Every other lesson stays an ordinary
 * lesson, open for review.
 */
export function courseCompletionLessonId(content: CourseContent): UUID | null {
  if (!content.completed) return null
  let found: { id: UUID; at: number } | null = null
  for (const { lesson } of orderedLessons(content)) {
    if (lesson.content_type !== 'VIDEO' || lesson.completed !== true || lesson.completed_at === null) continue
    const at = Date.parse(lesson.completed_at)
    if (Number.isNaN(at)) continue
    if (found === null || at >= found.at) found = { id: lesson.id, at }
  }
  return found?.id ?? null
}
