import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'
import type { CourseStatus, Page } from '../../api'

import { COURSES_PAGE_SIZE, createAdminApi, type AdminCourseSummary } from './api'

export interface CoursesQueryInput {
  page: number
  search: string
  status: CourseStatus | null
}

export interface AdminCoursesData {
  /** Each row with its size (`module_count`, `lesson_count`), as the listing returns it. */
  courses: AdminCourseSummary[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/** The four figures on the status tabs, or `null` while they are unknown. */
export interface StatusCounts {
  all: number
  DRAFT: number
  PUBLISHED: number
  ARCHIVED: number
}

export interface AdminCoursesState {
  status: 'loading' | 'ready' | 'error'
  data: AdminCoursesData | null
  counts: StatusCounts | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * One page of the course listing, plus the tab counts.
 *
 *   GET /admin/courses?page&page_size&search&status   once per query
 *   GET /admin/courses?page_size=1[&status=...]       x4, for the tab counts
 *
 * The counts are the backend's own `Page.total` for each status, read one row
 * at a time; nothing is counted over the loaded page, so "Published 6" means
 * six in the database rather than six on screen. They depend on the search
 * term - so a search narrows every tab - but not on the page, and they are
 * allowed to fail without taking the listing down with them.
 */
export function useAdminCourses({ page, search, status }: CoursesQueryInput): AdminCoursesState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const queryKey = JSON.stringify([page, search, status, attempt])
  const countsKey = JSON.stringify([search, attempt])

  const [loaded, setLoaded] = useState<{ key: string; result: Page<AdminCourseSummary> } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ key: string; value: StatusCounts } | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api
      .listCourses({
        page,
        pageSize: COURSES_PAGE_SIZE,
        search,
        status: status ?? undefined,
        // Admin-Courses lists the newest first; the database orders, not React.
        sort: '-created_at',
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (active) setLoaded({ key: queryKey, result })
        },
        (error: unknown) => {
          if (isAbort(error) || !active) return
          setFailedKey(queryKey)
        },
      )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, page, search, status, queryKey])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    const count = (forStatus?: CourseStatus) =>
      api.listCourses({
        page: 1,
        pageSize: 1,
        search,
        status: forStatus,
        signal: controller.signal,
      })

    Promise.all([count(), count('DRAFT'), count('PUBLISHED'), count('ARCHIVED')]).then(
      ([all, draft, published, archived]) => {
        if (!active) return
        setCounts({
          key: countsKey,
          value: {
            all: all.total,
            DRAFT: draft.total,
            PUBLISHED: published.total,
            ARCHIVED: archived.total,
          },
        })
      },
      // Not fatal: the tabs still filter, they simply carry no figure.
      () => undefined,
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, search, countsKey])

  const fresh = loaded?.key === queryKey
  const listStatus: AdminCoursesState['status'] = fresh
    ? 'ready'
    : failedKey === queryKey
      ? 'error'
      : 'loading'

  const data = useMemo<AdminCoursesData | null>(() => {
    if (!fresh || loaded === null) return null
    const result = loaded.result

    return {
      courses: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.page_size,
      pageCount: Math.max(1, Math.ceil(result.total / Math.max(1, result.page_size))),
    }
  }, [fresh, loaded])

  return useMemo(
    () => ({
      status: listStatus,
      data,
      counts: counts?.key === countsKey ? counts.value : null,
      reload,
    }),
    [listStatus, data, counts, countsKey, reload],
  )
}
