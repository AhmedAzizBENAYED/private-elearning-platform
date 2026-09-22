import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'

import {
  type CourseCardModel,
  catalogCard,
  descriptionsByCourse,
  enrollmentCard,
} from '../courses/courseCard'
import { type ContinueTarget, continueTargetFrom } from '../courses/courseDetails'

import { createDashboardApi, type DashboardApi } from './api'
import { availableCourses, continueCourseId, splitEnrollments } from './model'

export interface DashboardData {
  inProgress: CourseCardModel[]
  completed: CourseCardModel[]
  available: CourseCardModel[]
  continueTarget: ContinueTarget | null
  /** True when the catalogue request failed but the enrolled lists loaded. */
  catalogUnavailable: boolean
}

export interface DashboardState {
  status: 'loading' | 'ready' | 'error'
  data: DashboardData | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Loads the dashboard.
 *
 * Request strategy - constant, never one per course:
 *
 *   1. GET /me/enrollments   the two enrolled lists and their progress
 *   2. GET /courses          the catalogue: "available", and the descriptions
 *                            `/me/enrollments` does not carry
 *   3. GET /courses/{id}/content   only when there is an unfinished course,
 *                            and only for that one, for the Continue card
 *
 * The first two run in parallel and are settled independently: a catalogue
 * failure hides one section rather than the page, because the enrolled lists do
 * not depend on it. Only an enrollments failure is a page-level error, since
 * that is the data the dashboard is about.
 *
 * The current user is not fetched here at all - FE-02 already holds it.
 */
export function useDashboard(): DashboardState {
  const client = useApiClient()
  const api: DashboardApi = useMemo(() => createDashboardApi(client), [client])
  const [status, setStatus] = useState<DashboardState['status']>('loading')
  const [data, setData] = useState<DashboardData | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setAttempt((previous) => previous + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function load() {
      setStatus('loading')

      const [enrollmentsResult, catalogResult] = await Promise.allSettled([
        api.listEnrollments(controller.signal),
        api.listPublishedCourses(controller.signal),
      ])

      if (!active) return

      if (enrollmentsResult.status === 'rejected') {
        if (isAbort(enrollmentsResult.reason)) return
        setStatus('error')
        return
      }

      const enrollments = enrollmentsResult.value.items
      const catalog = catalogResult.status === 'fulfilled' ? catalogResult.value.items : []
      const catalogUnavailable =
        catalogResult.status === 'rejected' && !isAbort(catalogResult.reason)

      const { inProgress, completed } = splitEnrollments(enrollments)
      const descriptions = descriptionsByCourse(catalog)

      // One extra request, for one course, only when there is one to continue.
      let continueTarget: ContinueTarget | null = null
      const resumeId = continueCourseId(inProgress)
      if (resumeId !== null) {
        try {
          continueTarget = continueTargetFrom(await api.getCourseContent(resumeId, controller.signal))
        } catch (error) {
          if (isAbort(error)) return
          // The lists below are still worth showing; the card simply hides.
          continueTarget = null
        }
      }

      if (!active) return

      setData({
        inProgress: inProgress.map((enrollment) => enrollmentCard(enrollment, descriptions)),
        completed: completed.map((enrollment) => enrollmentCard(enrollment, descriptions)),
        available: availableCourses(catalog, enrollments).map((course) => catalogCard(course)),
        continueTarget,
        catalogUnavailable,
      })
      setStatus('ready')
    }

    void load()

    return () => {
      active = false
      controller.abort()
    }
  }, [api, attempt])

  return useMemo(() => ({ status, data, reload }), [status, data, reload])
}
