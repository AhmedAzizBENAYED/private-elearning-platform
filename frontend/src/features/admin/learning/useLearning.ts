import { useCallback, useEffect, useMemo, useState } from 'react'

import { isApiError, useApiClient } from '../../../api'
import type { UUID } from '../../../api'

import {
  createLearningApi,
  type CourseLearningSummary,
  type LearningActivityPage,
  type LearningActivityQuery,
  type LearningProgressPage,
  type LearningProgressQuery,
  type MemberLearningDetail,
} from './api'

/**
 * Reading the tracking endpoints.
 *
 * One hook per screen, each of them the same shape as `useMembers`: a query in,
 * `loading | ready | error` out, one request per query, every run owning an
 * `AbortController` and every outcome tagged with the query it belongs to. A
 * reply for filters the administrator has already changed can therefore never
 * be rendered as the current result.
 *
 * Nothing is cached and nothing polls. These screens read recorded activity,
 * not a live feed, and the design says so on the page.
 */

export type LearningFailure = 'not-found' | 'forbidden' | 'unavailable'

export interface LearningState<Data> {
  status: 'loading' | 'ready' | 'error'
  data: Data | null
  failure: LearningFailure | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function classify(error: unknown): LearningFailure {
  if (!isApiError(error)) return 'unavailable'
  if (error.status === 404) return 'not-found'
  if (error.status === 403) return 'forbidden'
  return 'unavailable'
}

/**
 * The shared machinery: run `fetcher` once per `key`, keep the last outcome.
 *
 * `fetcher` is expected to be stable for a given key - the hooks below build it
 * with `useCallback` over the values that make up the key - so a re-render
 * never starts a second request for the same query.
 */
function useRead<Data>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<Data>,
  /** `false` holds the request back - the query is not ready to be asked yet. */
  enabled = true,
): LearningState<Data> {
  const [attempt, setAttempt] = useState(0)
  const fullKey = `${key}:${attempt}`

  const [loaded, setLoaded] = useState<{ key: string; data: Data } | null>(null)
  const [failed, setFailed] = useState<{ key: string; failure: LearningFailure } | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true

    fetcher(controller.signal).then(
      (data) => {
        if (active) setLoaded({ key: fullKey, data })
      },
      (error: unknown) => {
        if (isAbort(error) || !active) return
        setFailed({ key: fullKey, failure: classify(error) })
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [enabled, fetcher, fullKey])

  const fresh = loaded?.key === fullKey
  const status: LearningState<Data>['status'] = fresh
    ? 'ready'
    : failed?.key === fullKey
      ? 'error'
      : 'loading'

  return useMemo(
    () => ({
      status,
      data: fresh && loaded !== null ? loaded.data : null,
      failure: status === 'error' ? (failed?.failure ?? 'unavailable') : null,
      reload,
    }),
    [status, fresh, loaded, failed, reload],
  )
}

function useApi() {
  const client = useApiClient()
  return useMemo(() => createLearningApi(client), [client])
}

/** `GET /admin/learning/progress` - the matrix and the list. */
export function useLearningProgress(
  query: Omit<LearningProgressQuery, 'signal'>,
  enabled = true,
): LearningState<LearningProgressPage> {
  const api = useApi()
  const key = JSON.stringify(query)
  const fetcher = useCallback(
    // The key *is* the query, serialized: reading it back keeps this callback
    // dependent on the value of the filters rather than on the identity of the
    // object React happened to build this render.
    (signal: AbortSignal) =>
      api.listProgress({ ...(JSON.parse(key) as Omit<LearningProgressQuery, 'signal'>), signal }),
    [api, key],
  )
  return useRead(key, fetcher, enabled)
}

/** `GET /admin/learning/activity` - who is using what, now or last. */
export function useLearningActivity(
  query: Omit<LearningActivityQuery, 'signal'>,
): LearningState<LearningActivityPage> {
  const api = useApi()
  const key = JSON.stringify(query)
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      api.listActivity({ ...(JSON.parse(key) as Omit<LearningActivityQuery, 'signal'>), signal }),
    [api, key],
  )
  return useRead(key, fetcher)
}

/** `GET /admin/learning/members/{id}` - one member's whole picture. */
export function useMemberLearning(memberId: UUID): LearningState<MemberLearningDetail> {
  const api = useApi()
  const fetcher = useCallback(
    (signal: AbortSignal) => api.getMemberLearning(memberId, signal),
    [api, memberId],
  )
  return useRead(memberId, fetcher)
}

/** `GET /admin/courses/{id}/learning` - one published course's figures. */
export function useCourseLearning(courseId: UUID): LearningState<CourseLearningSummary> {
  const api = useApi()
  const fetcher = useCallback(
    (signal: AbortSignal) => api.getCourseLearning(courseId, signal),
    [api, courseId],
  )
  return useRead(courseId, fetcher)
}

/**
 * The figures of several published courses at once (the "By course" table).
 *
 * The backend has no listing of course figures - `GET /admin/courses/{id}/
 * learning` answers for one course - so one page of the table costs one request
 * per course on it. That is bounded by the page, not by the catalogue, and the
 * requests are made once per page rather than per render; reported as a gap.
 */
export function useCourseFigures(courseIds: readonly UUID[]): {
  status: 'loading' | 'ready' | 'error'
  summaries: Record<UUID, CourseLearningSummary>
  reload: () => void
} {
  const api = useApi()
  const key = courseIds.join(',')
  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const ids = key === '' ? [] : key.split(',')
      const results = await Promise.all(ids.map((id) => api.getCourseLearning(id, signal)))
      return Object.fromEntries(results.map((summary) => [summary.course.id, summary]))
    },
    [api, key],
  )
  const state = useRead(key, fetcher)

  return useMemo(
    () => ({ status: state.status, summaries: state.data ?? {}, reload: state.reload }),
    [state],
  )
}
