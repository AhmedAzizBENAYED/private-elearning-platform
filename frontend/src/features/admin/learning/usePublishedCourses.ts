import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../../api'
import { createAdminApi, type AdminCourseSummary } from '../api'

/**
 * The published catalogue, as the tracking screens need it.
 *
 *   GET /admin/courses?status=PUBLISHED&page&page_size
 *
 * The matrix columns and the course filter are the same list, so it is read
 * once per screen and shared. `status=PUBLISHED` is the backend's own filter,
 * which matters here: the tracking endpoints report on published courses only,
 * so a draft must not appear as a column that could never hold a figure.
 *
 * Same discipline as every other read in this feature - one request per query,
 * an `AbortController` per run, each outcome tagged with the query it answers.
 */
export interface PublishedCoursesState {
  status: 'loading' | 'ready' | 'error'
  data: AdminCourseSummary[] | null
  /** The backend's count of published courses, across every page. */
  total: number
  reload: () => void
}

export function usePublishedCourses(page = 1, pageSize = 100): PublishedCoursesState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const key = `${page}:${pageSize}:${attempt}`

  const [loaded, setLoaded] = useState<{
    key: string
    items: AdminCourseSummary[]
    total: number
  } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api.listCourses({ page, pageSize, status: 'PUBLISHED', signal: controller.signal }).then(
      (result) => {
        if (active) setLoaded({ key, items: result.items, total: result.total })
      },
      (error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
        setFailedKey(key)
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, key, page, pageSize])

  const fresh = loaded?.key === key
  const status: PublishedCoursesState['status'] = fresh
    ? 'ready'
    : failedKey === key
      ? 'error'
      : 'loading'

  return useMemo(
    () => ({
      status,
      data: fresh && loaded !== null ? loaded.items : null,
      total: fresh && loaded !== null ? loaded.total : 0,
      reload,
    }),
    [status, fresh, loaded, reload],
  )
}
