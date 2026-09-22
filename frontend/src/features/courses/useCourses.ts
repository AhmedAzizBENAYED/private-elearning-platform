import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'
import type { CatalogEnrollmentCounts, CatalogPage, EnrollmentFilter, EnrollmentSummary } from '../../api'

import { CATALOG_PAGE_SIZE, createCoursesApi } from './api'
import { type CourseCardModel, catalogCard, enrollmentsByCourse } from './courseCard'

export interface CoursesQuery {
  /** 1-based page, as the backend counts. */
  page: number
  /** Title search; empty means no filter. */
  search: string
  /** The catalogue tab (G04); `null` is "All". */
  enrollment: EnrollmentFilter | null
}

export interface CoursesData {
  courses: CourseCardModel[]
  /** The backend's own count for this query, across every page. */
  total: number
  /**
   * Every tab's size, as the backend counted it (`enrollment_counts`) - never
   * derived from the rows of this page. `null` when the response carried none;
   * the tabs then filter without a figure.
   */
  counts: CatalogEnrollmentCounts | null
  page: number
  pageSize: number
  pageCount: number
  /**
   * The member's enrollments could not be read. The catalogue still renders;
   * the cards simply carry no enrollment state.
   */
  enrollmentsUnavailable: boolean
}

export interface CoursesState {
  status: 'loading' | 'ready' | 'error'
  data: CoursesData | null
  reload: () => void
}

/**
 * The tab counts the response carried, or `null` when it carried none (a
 * deployment that predates BE-COURSE-CATALOG-01). Never a set of zeros made
 * up to fill the gap.
 */
function countsOf(page: CatalogPage): CatalogEnrollmentCounts | null {
  const counts: unknown = (page as Partial<CatalogPage>).enrollment_counts
  if (typeof counts !== 'object' || counts === null) return null
  const { all, not_enrolled, in_progress, completed } = counts as Record<string, unknown>
  const figures = [all, not_enrolled, in_progress, completed]
  if (!figures.every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)) return null
  return counts as CatalogEnrollmentCounts
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Loads one page of the published catalogue.
 *
 * Request strategy:
 *
 *   GET /courses?page&page_size&search&enrollment   once per query
 *   GET /me/enrollments                  once per visit, reused across pages
 *
 * The second is what lets every card show whether the member is enrolled
 * without asking per course. It is the member's own small set, so the backend's
 * maximum single page covers it; the catalogue itself is paged properly,
 * because it is a browsing screen that can grow without limit.
 *
 * A stale response is never applied: each run owns an `AbortController`, and a
 * reply that arrives after the query changed is discarded rather than
 * overwriting a newer one.
 */
export function useCourses({ page, search, enrollment }: CoursesQuery): CoursesState {
  const client = useApiClient()
  const api = useMemo(() => createCoursesApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  // Each outcome is tagged with the query it belongs to, so `status` is derived
  // during render rather than pushed from inside the effect - a late reply for
  // an older query can never make the current one look ready.
  const queryKey = JSON.stringify([page, search, enrollment, attempt])
  const [loaded, setLoaded] = useState<{ key: string; result: CatalogPage } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  // Enrollments belong to the member, not to the query, so they are held
  // separately and are not refetched when the page or the search term changes.
  const [enrollments, setEnrollments] = useState<readonly EnrollmentSummary[]>([])
  const [enrollmentsUnavailable, setEnrollmentsUnavailable] = useState(false)

  const reload = useCallback(() => {
    setAttempt((previous) => previous + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    api.listEnrollments(controller.signal).then(
      (result) => {
        setEnrollments(result.items)
        setEnrollmentsUnavailable(false)
      },
      (error: unknown) => {
        if (isAbort(error)) return
        // Not fatal: the catalogue is still worth showing without badges.
        setEnrollments([])
        setEnrollmentsUnavailable(true)
      },
    )

    return () => controller.abort()
  }, [api, attempt])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api
      .listCourses({ page, pageSize: CATALOG_PAGE_SIZE, search, enrollment, signal: controller.signal })
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
  }, [api, page, search, enrollment, queryKey])

  const fresh = loaded?.key === queryKey
  const status: CoursesState['status'] = fresh
    ? 'ready'
    : failedKey === queryKey
      ? 'error'
      : 'loading'

  const catalog = fresh ? loaded.result : null

  const data = useMemo<CoursesData | null>(() => {
    if (catalog === null) return null

    const byCourse = enrollmentsByCourse(enrollments)

    return {
      courses: catalog.items.map((course) => catalogCard(course, byCourse, enrollment)),
      total: catalog.total,
      counts: countsOf(catalog),
      page: catalog.page,
      pageSize: catalog.page_size,
      // The backend returns neither a page count nor has_next/has_previous, so
      // it is derived from `total` and `page_size`, which it does return.
      pageCount: Math.max(1, Math.ceil(catalog.total / Math.max(1, catalog.page_size))),
      enrollmentsUnavailable,
    }
  }, [catalog, enrollments, enrollmentsUnavailable, enrollment])

  return useMemo(() => ({ status, data, reload }), [status, data, reload])
}
