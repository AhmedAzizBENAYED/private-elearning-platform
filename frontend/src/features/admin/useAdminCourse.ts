import { useCallback, useEffect, useMemo, useState } from 'react'

import { isApiError, useApiClient } from '../../api'
import type { UUID } from '../../api'

import { createAdminApi, type AdminCourse, type CourseUpdateInput } from './api'
import type { CourseTransition, ThumbnailFailure } from './courseModel'

export type CourseFailure = 'not-found' | 'forbidden' | 'unavailable'

/** Why a write was refused, in the page's own vocabulary. */
export type CourseWriteFailure =
  | 'not-draft'
  | 'slug-taken'
  | 'lifecycle'
  | 'invalid'
  | 'not-found'
  | 'forbidden'
  | 'unavailable'

export interface CourseWriteResult {
  ok: boolean
  failure: CourseWriteFailure | null
  /** Field-level messages from a 422, keyed by the backend's field name. */
  fieldErrors: Record<string, string>
}

export type ThumbnailUploadResult = { ok: true; course: AdminCourse } | { ok: false; failure: ThumbnailFailure }

export interface AdminCourseState {
  status: 'loading' | 'ready' | 'error'
  course: AdminCourse | null
  failure: CourseFailure | null
  saving: boolean
  reload: () => void
  save: (patch: CourseUpdateInput) => Promise<CourseWriteResult>
  transition: (to: CourseTransition) => Promise<CourseWriteResult>
  uploadThumbnail: (file: File) => Promise<ThumbnailUploadResult>
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function classify(error: unknown): CourseFailure {
  if (!isApiError(error)) return 'unavailable'
  if (error.status === 404) return 'not-found'
  if (error.status === 403) return 'forbidden'
  return 'unavailable'
}

/**
 * Turns a refused write into one of the reasons this backend actually has.
 *
 * 409 is ambiguous on its own - `content_write` raises it both for a slug
 * collision and for an illegal transition, and `require_draft` raises it for an
 * edit of a non-draft - so the server's own `detail` is matched to tell them
 * apart. The text is not shown to anyone; it only picks which sentence is.
 */
export function classifyWrite(error: unknown): CourseWriteFailure {
  if (!isApiError(error)) return 'unavailable'
  if (error.status === 404) return 'not-found'
  if (error.status === 403) return 'forbidden'
  if (error.status === 422) return 'invalid'
  if (error.status === 409) {
    const detail = error.detail.toLowerCase()
    if (detail.includes('draft courses can be edited')) return 'not-draft'
    if (detail.includes('slug')) return 'slug-taken'
    return 'lifecycle'
  }
  return 'unavailable'
}

/**
 * Turns a refused thumbnail upload into the sentence the card shows.
 *
 * 413, 415 and 422 are the upload's own refusals; the 422s are told apart by
 * the server's `detail`, which is matched and never shown.
 */
export function classifyThumbnail(error: unknown): ThumbnailFailure {
  if (!isApiError(error)) return 'network'
  if (error.status === 413) return 'too-large'
  if (error.status === 415) return 'type'
  if (error.status === 422) {
    const detail = error.detail.toLowerCase()
    if (detail.includes('empty')) return 'empty'
    if (detail.includes('dimensions')) return 'dimensions'
    return 'invalid'
  }
  if (error.status === 409) return 'not-draft'
  if (error.status === 404) return 'not-found'
  if (error.status === 403) return 'forbidden'
  return 'unavailable'
}

function resultFrom(error: unknown): CourseWriteResult {
  return {
    ok: false,
    failure: classifyWrite(error),
    fieldErrors: isApiError(error) ? error.fieldErrors() : {},
  }
}

const SUCCESS: CourseWriteResult = { ok: true, failure: null, fieldErrors: {} }

/**
 * One course, and the three writes the backend offers for it.
 *
 *   GET  /admin/courses/{id}
 *   PATCH /admin/courses/{id}           draft metadata only
 *   POST /admin/courses/{id}/publish    DRAFT -> PUBLISHED
 *   POST /admin/courses/{id}/archive    PUBLISHED -> ARCHIVED
 *
 * Every write replaces the held course with the row the server returned, so
 * what is displayed is the stored state and not the request that was sent -
 * which matters here because both transitions are idempotent and may
 * legitimately answer with an unchanged row.
 *
 * There is no optimistic update and no delete: the API exposes no `DELETE` for
 * a course at all.
 */
export function useAdminCourse(courseId: UUID): AdminCourseState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const key = `${courseId}:${attempt}`

  const [loaded, setLoaded] = useState<{ key: string; course: AdminCourse } | null>(null)
  const [failed, setFailed] = useState<{ key: string; failure: CourseFailure } | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api.getCourse(courseId, controller.signal).then(
      (course) => {
        if (active) setLoaded({ key, course })
      },
      (error: unknown) => {
        if (isAbort(error) || !active) return
        setFailed({ key, failure: classify(error) })
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, courseId, key])

  const course = loaded?.key === key ? loaded.course : null

  const status: AdminCourseState['status'] =
    course !== null ? 'ready' : failed?.key === key ? 'error' : 'loading'

  /** Runs one write, then adopts the row it answered with. */
  const write = useCallback(
    async (run: () => Promise<AdminCourse>): Promise<CourseWriteResult> => {
      setSaving(true)
      try {
        // Deliberately not aborted on unmount: cancelling a write would leave
        // the administrator unsure whether it landed.
        setLoaded({ key, course: await run() })
        return SUCCESS
      } catch (error: unknown) {
        return resultFrom(error)
      } finally {
        setSaving(false)
      }
    },
    [key],
  )

  const save = useCallback(
    (patch: CourseUpdateInput) => write(() => api.updateCourse(courseId, patch)),
    [write, api, courseId],
  )

  const transition = useCallback(
    (to: CourseTransition) =>
      write(() =>
        to === 'publish' ? api.publishCourse(courseId) : api.archiveCourse(courseId),
      ),
    [write, api, courseId],
  )

  /**
   * `PUT /admin/courses/{id}/thumbnail`, then the row it answered with.
   *
   * Not a `write`: it leaves `saving` alone, so the rest of the editor - the
   * Status card, the fields - stays usable while an image is sent.
   */
  const uploadThumbnail = useCallback(
    async (file: File): Promise<ThumbnailUploadResult> => {
      try {
        const stored = await api.uploadThumbnail(courseId, file)
        setLoaded({ key, course: stored })
        return { ok: true, course: stored }
      } catch (error: unknown) {
        return { ok: false, failure: classifyThumbnail(error) }
      }
    },
    [api, courseId, key],
  )

  return useMemo(
    () => ({
      status,
      course,
      failure: status === 'error' ? (failed?.failure ?? 'unavailable') : null,
      saving,
      reload,
      save,
      transition,
      uploadThumbnail,
    }),
    [status, course, failed, saving, reload, save, transition, uploadThumbnail],
  )
}
