import { useCallback, useEffect, useMemo, useState } from 'react'

import { isApiError, useApiClient } from '../../api'
import type { CourseContent, UUID } from '../../api'

import { createLearningApi, type CatalogLessonContent, type LearningApi, type LessonProgress } from './api'
import { type LessonPlacement, needsLessonContent, placeLesson } from './model'

export type CourseStatus = 'loading' | 'ready' | 'not-enrolled' | 'error'

export type LessonStatus = 'loading' | 'ready' | 'unavailable' | 'error'

export interface LearningState {
  /** The learning API, for the player, which owns its own two requests. */
  api: LearningApi
  courseStatus: CourseStatus
  /** The whole tree, read once per course. */
  content: CourseContent | null
  lessonStatus: LessonStatus
  /** Where the URL's lesson sits; `null` when it is not in this course. */
  placement: LessonPlacement | null
  /** Only ever the SELECTED lesson's own content, never another lesson's. */
  lessonContent: CatalogLessonContent | null
  reloadCourse: () => void
  reloadLesson: () => void
  /** Applies what the backend confirmed about one lesson's progress. */
  applyProgress: (progress: LessonProgress) => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Loads the learning page.
 *
 * Request strategy:
 *
 *   GET /courses/{courseId}/content   ONCE per course - the whole tree, the
 *                                     member's own progress, and the sidebar
 *   GET /lessons/{lessonId}           only for the SELECTED lesson, and only
 *                                     when it is TEXT or LINK
 *
 * Walking to another lesson in the same course does not refetch the tree: the
 * effect that reads it depends on `courseId`, not on `lessonId`. There is no
 * request per lesson for the sidebar - it is built entirely from the one tree
 * response - and no request at all for a VIDEO or DOCUMENT lesson, whose
 * `content` the backend blanks anyway.
 *
 * `GET /courses/{id}/progress` is not read on load: `CourseContent` already
 * carries `progress_percent`, `completed_video_lessons` and
 * `total_video_lessons`, computed by the same aggregation, so a second read
 * could only disagree. It is read once, later, only when a lesson has just
 * become complete - see `applyProgress`.
 *
 * This hook issues no write. Progress is written by the player, through
 * `useProgressSync`; what arrives back here is the server's confirmation.
 */
export function useLearning(courseId: UUID, lessonId: UUID): LearningState {
  const client = useApiClient()
  const api = useMemo(() => createLearningApi(client), [client])

  const [courseAttempt, setCourseAttempt] = useState(0)
  const [lessonAttempt, setLessonAttempt] = useState(0)

  const courseKey = `${courseId}:${courseAttempt}`
  const [course, setCourse] = useState<{ key: string; content: CourseContent } | null>(null)
  const [courseFailed, setCourseFailed] = useState<{
    key: string
    kind: 'not-enrolled' | 'error'
  } | null>(null)

  const reloadCourse = useCallback(() => setCourseAttempt((previous) => previous + 1), [])
  const reloadLesson = useCallback(() => setLessonAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api.getCourseContent(courseId, controller.signal).then(
      (content) => {
        if (active) setCourse({ key: courseKey, content })
      },
      (error: unknown) => {
        if (isAbort(error) || !active) return
        // `LearningService.course_content` checks enrollment first, so its 404
        // is "you are not enrolled" - not "no such course".
        const notEnrolled = isApiError(error) && error.isNotFound
        setCourseFailed({ key: courseKey, kind: notEnrolled ? 'not-enrolled' : 'error' })
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, courseId, courseKey])

  const content = course?.key === courseKey ? course.content : null

  const courseStatus: CourseStatus =
    content !== null ? 'ready' : courseFailed?.key === courseKey ? courseFailed.kind : 'loading'

  const placement = useMemo(
    () => (content === null ? null : placeLesson(content, lessonId)),
    [content, lessonId],
  )

  // Tagged with the lesson it belongs to, so a reply that arrives after the
  // member moved on is never rendered under the new lesson's title.
  const lessonKey = `${lessonId}:${lessonAttempt}`
  const [lesson, setLesson] = useState<{ key: string; content: CatalogLessonContent } | null>(null)
  const [lessonFailedKey, setLessonFailedKey] = useState<string | null>(null)

  const wantsContent = placement !== null && needsLessonContent(placement.lesson.content_type)

  useEffect(() => {
    if (!wantsContent) return

    const controller = new AbortController()
    let active = true

    api.getLesson(lessonId, controller.signal).then(
      (result) => {
        if (active) setLesson({ key: lessonKey, content: result })
      },
      (error: unknown) => {
        if (isAbort(error) || !active) return
        setLessonFailedKey(lessonKey)
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, lessonId, lessonKey, wantsContent])

  const lessonContent = lesson?.key === lessonKey ? lesson.content : null

  const lessonStatus: LessonStatus =
    courseStatus !== 'ready'
      ? 'loading'
      : placement === null
        ? 'unavailable'
        : !wantsContent || lessonContent !== null
          ? 'ready'
          : lessonFailedKey === lessonKey
            ? 'error'
            : 'loading'

  /**
   * Folds a confirmed progress write back into the tree.
   *
   * The lesson row is patched from the server's own answer - never from what
   * was sent, and never from the video element - so the sidebar marks a lesson
   * complete only once the backend says it is.
   *
   * The course figures are a different question: `ProgressResponse` describes
   * one lesson and carries no aggregate. Rather than recompute them here (two
   * sources of truth) or re-read the whole tree (wasteful, and it would reset
   * the player), the aggregate is re-read from `GET /courses/{id}/progress` -
   * and only when a lesson has *just become* complete, which is the only event
   * that can move those numbers.
   */
  const applyProgress = useCallback(
    (progress: LessonProgress) => {
      let becameComplete = false

      setCourse((previous) => {
        if (previous === null) return previous

        const modules = previous.content.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => {
            if (lesson.id !== progress.lesson_id) return lesson
            if (progress.completed && lesson.completed !== true) becameComplete = true
            return {
              ...lesson,
              watched_seconds: progress.watched_seconds,
              completed: progress.completed,
              completed_at: progress.completed_at,
            }
          }),
        }))

        return { ...previous, content: { ...previous.content, modules } }
      })

      if (!becameComplete) return

      void api.getCourseProgress(courseId).then(
        (aggregate) => {
          setCourse((previous) =>
            previous === null
              ? previous
              : {
                  ...previous,
                  content: {
                    ...previous.content,
                    total_video_lessons: aggregate.total_video_lessons,
                    completed_video_lessons: aggregate.completed_video_lessons,
                    progress_percent: aggregate.progress_percent,
                    completed: aggregate.completed,
                  },
                },
          )
        },
        // The lesson row is already correct; only the header figures lag, and
        // the next page load fixes them. Not worth an error state.
        () => undefined,
      )
    },
    [api, courseId],
  )

  return useMemo(
    () => ({
      api,
      courseStatus,
      content,
      lessonStatus,
      placement,
      lessonContent,
      reloadCourse,
      reloadLesson,
      applyProgress,
    }),
    [
      api,
      courseStatus,
      content,
      lessonStatus,
      placement,
      lessonContent,
      reloadCourse,
      reloadLesson,
      applyProgress,
    ],
  )
}
