import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'

import { createAdminApi, type AdminCourseSummary } from './api'

/** How many rows the board shows (Admin-Dashboard). */
export const RECENT_COURSE_COUNT = 5

export interface RecentCoursesState {
  status: 'loading' | 'ready' | 'error'
  courses: readonly AdminCourseSummary[]
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * The five most recently created courses, for the administration board.
 *
 * One request, always: `GET /admin/courses?page=1&page_size=5&sort=-created_at`.
 * The server does the ordering and the limiting, so the five newest are the
 * five the database picked rather than the head of a list fetched whole, and
 * each row already carries `module_count` and `lesson_count` - there is no
 * follow-up request per course, and none per module.
 *
 * It fails on its own. The section reports its own error and offers its own
 * retry, so a listing that cannot be read leaves the four figures above it
 * standing, and the other way round.
 */
export function useRecentCourses(): RecentCoursesState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; courses: AdminCourseSummary[] } | null>(null)
  const [failedKey, setFailedKey] = useState<number | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api
      .listCourses({
        page: 1,
        pageSize: RECENT_COURSE_COUNT,
        sort: '-created_at',
        signal: controller.signal,
      })
      .then(
        (page) => {
          if (active) setLoaded({ key: attempt, courses: page.items })
        },
        (error: unknown) => {
          if (isAbort(error) || !active) return
          setFailedKey(attempt)
        },
      )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, attempt])

  const courses = loaded?.key === attempt ? loaded.courses : null

  const status: RecentCoursesState['status'] =
    courses !== null ? 'ready' : failedKey === attempt ? 'error' : 'loading'

  return useMemo(
    () => ({ status, courses: courses ?? [], reload }),
    [status, courses, reload],
  )
}
