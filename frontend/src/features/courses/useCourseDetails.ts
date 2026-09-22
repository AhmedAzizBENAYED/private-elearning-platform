import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { isApiError, useApiClient } from '../../api'
import type { CatalogLesson, CourseContent, UUID } from '../../api'
import { routes } from '../../app/routes'

import { createCoursesApi, type CoursesApi } from './api'
import {
  type ContinueTarget,
  type CourseDetailsHeader,
  type CourseOutline,
  continueTargetFrom,
  headerFromCatalog,
  outlineFromCatalog,
  outlineFromContent,
} from './courseDetails'

/**
 * What the backend says about this member and this course.
 *
 * `unknown` is a real, separate state: it means the enrollment read failed, and
 * the page must say so rather than show an Enroll button that might enroll
 * someone twice or hide a course they already own.
 */
export type EnrollmentState =
  | { kind: 'not-enrolled' }
  | {
      kind: 'enrolled'
      completed: boolean
      progressPercent: number
      completedVideoLessons: number
      totalVideoLessons: number
      continueLesson: ContinueTarget['lesson']
    }
  | { kind: 'unknown' }

export interface CourseDetailsData {
  header: CourseDetailsHeader
  enrollment: EnrollmentState
  /** `null` when the outline could not be read; the page still renders. */
  outline: CourseOutline | null
}

export type CourseDetailsStatus = 'loading' | 'ready' | 'not-found' | 'error'

export type EnrollStatus = 'idle' | 'enrolling' | 'failed' | 'conflict'

export interface CourseDetailsState {
  status: CourseDetailsStatus
  data: CourseDetailsData | null
  reload: () => void
  enroll: () => void
  enrollStatus: EnrollStatus
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function enrolledStateFrom(content: CourseContent): EnrollmentState {
  const target = continueTargetFrom(content)

  return {
    kind: 'enrolled',
    completed: content.completed,
    progressPercent: content.progress_percent,
    completedVideoLessons: content.completed_video_lessons,
    totalVideoLessons: content.total_video_lessons,
    continueLesson: target.lesson,
  }
}

/**
 * Reads the outline a member who is NOT enrolled is allowed to see.
 *
 * `GET /courses/{id}/content` requires enrollment, so before enrolling the only
 * route to the outline is the catalog projections: one modules request, then
 * one lessons request per module, issued together. That is 1 + M requests for a
 * course of M modules, and it is the backend's shape rather than a choice -
 * there is no aggregate endpoint for a member who is not enrolled. Reported as
 * a backend gap.
 */
async function catalogOutline(
  api: CoursesApi,
  courseId: UUID,
  signal: AbortSignal,
): Promise<CourseOutline> {
  const modules = await api.listModules(courseId, signal)

  const lessonPages = await Promise.all(
    modules.items.map((module) => api.listModuleLessons(module.id, signal)),
  )

  const lessonsByModule = new Map<UUID, readonly CatalogLesson[]>(
    modules.items.map((module, index) => [module.id, lessonPages[index]?.items ?? []]),
  )

  return outlineFromCatalog(modules.items, lessonsByModule)
}

/**
 * Loads one course details page.
 *
 * Request strategy:
 *
 *   GET /courses/{id}            the course itself; 404 = not found/unavailable
 *   GET /courses/{id}/content    200 = enrolled, with the outline AND progress
 *                                404 = not enrolled
 *   ...and only when not enrolled, the catalog outline (1 + M requests)
 *
 * The first two run in parallel, so an enrolled member's page costs exactly two
 * requests. The 404 on the second is read as "not enrolled" only because the
 * first has already established that the course exists and is published - the
 * frontend never infers visibility on its own.
 *
 * Enrolling costs one POST plus one re-read of `/content`: the enroll response
 * carries the enrollment row, not the progress aggregate the page shows, so the
 * smallest sufficient follow-up is that single request.
 */
export function useCourseDetails(courseId: UUID): CourseDetailsState {
  const client = useApiClient()
  const api = useMemo(() => createCoursesApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  // Each outcome is tagged with the load it belongs to, so `status` is derived
  // during render and a late reply for a previous course can never be applied.
  const loadKey = `${courseId}:${attempt}`
  const [loaded, setLoaded] = useState<{ key: string; data: CourseDetailsData } | null>(null)
  const [failed, setFailed] = useState<{ key: string; kind: 'not-found' | 'error' } | null>(null)
  const [enrollStatus, setEnrollStatus] = useState<EnrollStatus>('idle')

  const reload = useCallback(() => {
    setEnrollStatus('idle')
    setAttempt((previous) => previous + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function load() {
      const [courseResult, contentResult] = await Promise.allSettled([
        api.getCourse(courseId, controller.signal),
        api.getCourseContent(courseId, controller.signal),
      ])

      if (!active) return

      if (courseResult.status === 'rejected') {
        if (isAbort(courseResult.reason)) return
        // 404 is the backend's answer for missing, DRAFT and ARCHIVED alike:
        // one state, as the design draws it.
        const notFound = isApiError(courseResult.reason) && courseResult.reason.isNotFound
        setFailed({ key: loadKey, kind: notFound ? 'not-found' : 'error' })
        return
      }

      const header = headerFromCatalog(courseResult.value)

      if (contentResult.status === 'fulfilled') {
        setLoaded({
          key: loadKey,
          data: {
            header,
            enrollment: enrolledStateFrom(contentResult.value),
            outline: outlineFromContent(contentResult.value),
          },
        })
        return
      }

      if (isAbort(contentResult.reason)) return

      if (!(isApiError(contentResult.reason) && contentResult.reason.isNotFound)) {
        // A failure is not a "no". Saying "not enrolled" here could offer a
        // second enrollment, so the page says it does not know instead.
        setLoaded({ key: loadKey, data: { header, enrollment: { kind: 'unknown' }, outline: null } })
        return
      }

      let outline: CourseOutline | null = null
      try {
        outline = await catalogOutline(api, courseId, controller.signal)
      } catch (error) {
        if (isAbort(error)) return
        // The outline is an extra; the course and its Enroll action stand.
        outline = null
      }

      if (!active) return
      setLoaded({ key: loadKey, data: { header, enrollment: { kind: 'not-enrolled' }, outline } })
    }

    void load()

    return () => {
      active = false
      controller.abort()
    }
  }, [api, courseId, loadKey])

  const fresh = loaded?.key === loadKey ? loaded.data : null

  const navigate = useNavigate()
  // The enrollment finishes after a round trip; by then the member may have
  // left this page, and must not be pulled back to a lesson.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const enroll = useCallback(() => {
    // The guard is the state itself, so a second click while the first request
    // is in flight cannot start another one even before React repaints.
    if (enrollStatus === 'enrolling') return
    setEnrollStatus('enrolling')

    void (async () => {
      try {
        await api.enroll(courseId)
        // The enroll response is the enrollment row; the page shows the
        // progress aggregate, so this one read is the minimum follow-up.
        const content = await api.getCourseContent(courseId)
        setLoaded((previous) =>
          previous === null
            ? previous
            : {
                ...previous,
                data: {
                  ...previous.data,
                  enrollment: enrolledStateFrom(content),
                  outline: outlineFromContent(content),
                },
              },
        )
        setEnrollStatus('idle')
        // Course-Details-States DEV NOTE: "After success -> Learning page at
        // the first lesson" - the first lesson in the course's own order,
        // whatever its type. A course with no lesson yet stays here, enrolled.
        const first = outlineFromContent(content).modules.find((module) => module.lessons.length > 0)
          ?.lessons[0]
        if (first !== undefined && mounted.current) navigate(routes.lesson(courseId, first.id))
      } catch (error) {
        if (isAbort(error)) return
        // 409 is the backend's only enrollment refusal: the course is not
        // PUBLISHED. Everything else is a plain failure the member can retry.
        setEnrollStatus(isApiError(error) && error.isConflict ? 'conflict' : 'failed')
      }
    })()
  }, [api, courseId, enrollStatus, navigate])

  const status: CourseDetailsStatus =
    fresh !== null ? 'ready' : failed?.key === loadKey ? failed.kind : 'loading'

  return useMemo(
    () => ({ status, data: fresh, reload, enroll, enrollStatus }),
    [status, fresh, reload, enroll, enrollStatus],
  )
}
