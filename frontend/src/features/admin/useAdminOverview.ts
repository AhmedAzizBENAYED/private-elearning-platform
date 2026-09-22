import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'

import { createAdminApi } from './api'

export interface AdminCounts {
  members: number
  courses: number
  published: number
  drafts: number
}

export interface AdminOverviewState {
  status: 'loading' | 'ready' | 'error'
  counts: AdminCounts | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * The four figures on the administration landing page.
 *
 * Every one is a `Page.total` the backend computed - `SELECT count(*)` behind
 * `GET /admin/members` and `GET /admin/courses?status=...` - read with
 * `page_size=1` so a number costs one row rather than a listing. There is no
 * statistics endpoint in this backend and none is invented here: a figure the
 * server cannot produce is not displayed at all.
 *
 * The four run together and the panel is all-or-nothing, because four cards
 * where two show a number and two show a dash would read as data rather than
 * as a failure.
 */
export function useAdminOverview(): AdminOverviewState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; counts: AdminCounts } | null>(null)
  const [failedKey, setFailedKey] = useState<number | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    Promise.all([
      api.countMembers(controller.signal),
      api.countCourses(undefined, controller.signal),
      api.countCourses('PUBLISHED', controller.signal),
      api.countCourses('DRAFT', controller.signal),
    ]).then(
      ([members, courses, published, drafts]) => {
        if (active) setLoaded({ key: attempt, counts: { members, courses, published, drafts } })
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

  const counts = loaded?.key === attempt ? loaded.counts : null

  const status: AdminOverviewState['status'] =
    counts !== null ? 'ready' : failedKey === attempt ? 'error' : 'loading'

  return useMemo(() => ({ status, counts, reload }), [status, counts, reload])
}
