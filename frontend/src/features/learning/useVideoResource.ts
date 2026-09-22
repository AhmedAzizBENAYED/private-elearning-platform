import { useCallback, useEffect, useMemo, useState } from 'react'

import type { UUID } from '../../api'

import type { LearningApi, MemberResource } from './api'

export type ResourceStatus = 'loading' | 'ready' | 'error'

export interface VideoResourceState {
  status: ResourceStatus
  /** Absolute URL for the media element, or `null` until it is known. */
  src: string | null
  resource: MemberResource | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Resolves where one lesson's video can be streamed from.
 *
 * `GET /lessons/{id}/resource` is an ordinary authenticated request through the
 * FE-02 client; only the `download_url` it answers with is handed to the
 * browser, already carrying the backend's short-lived playback token. The
 * frontend never sees a provider URL, a storage key or any credential of the
 * platform's own.
 *
 * Each load owns an `AbortController` and its result is tagged with the lesson
 * it belongs to, so a reply for the lesson the member just left can never
 * become the `src` of the one they are now on.
 */
export function useVideoResource(
  api: LearningApi,
  lessonId: UUID,
  enabled: boolean,
): VideoResourceState {
  const [attempt, setAttempt] = useState(0)
  const key = `${lessonId}:${attempt}`

  const [loaded, setLoaded] = useState<{ key: string; resource: MemberResource } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    let active = true

    api.getLessonResource(lessonId, controller.signal).then(
      (resource) => {
        if (active) setLoaded({ key, resource })
      },
      (error: unknown) => {
        if (isAbort(error) || !active) return
        setFailedKey(key)
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, lessonId, key, enabled])

  const resource = loaded?.key === key ? loaded.resource : null

  const status: ResourceStatus =
    resource !== null ? 'ready' : failedKey === key ? 'error' : 'loading'

  return useMemo(
    () => ({
      status,
      src: resource === null ? null : api.mediaUrl(resource.download_url),
      resource,
      reload,
    }),
    [api, status, resource, reload],
  )
}
