import { useCallback, useEffect, useMemo, useState } from 'react'

import { ApiError, type UUID } from '../../api'

import type { LearningApi, MemberResource } from './api'

export type DocumentStatus = 'loading' | 'ready' | 'error'

/** Why a document could not be shown, in the page's own vocabulary. */
export type DocumentFailure = 'signed-out' | 'forbidden' | 'missing' | 'unavailable'

export interface DocumentResourceState {
  status: DocumentStatus
  resource: MemberResource | null
  /**
   * A same-origin `blob:` URL for the bytes, or `null` until they are in.
   *
   * Revoked when the lesson changes or the viewer unmounts, so a document is
   * never reachable after the member has left it.
   */
  objectUrl: string | null
  /** Set only while `status` is `error`. */
  failure: DocumentFailure | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Maps a transport failure onto something the page can say out loud.
 *
 * The server's own `detail` is deliberately not used: it is written for an API
 * consumer and can name internal rules. The member sees one of four sentences
 * instead, chosen by status.
 */
function classify(error: unknown): DocumentFailure {
  if (!(error instanceof ApiError)) return 'unavailable'
  if (error.status === 401) return 'signed-out'
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'missing'
  return 'unavailable'
}

/**
 * Retrieves one lesson's document.
 *
 *   GET /lessons/{id}/resource          metadata: filename, media type, size
 *   GET /lessons/{id}/resource/content  the bytes, as a Blob
 *
 * Two requests, both through the authenticated FE-02 client, and both only for
 * the lesson the URL currently names. The second is unavoidable: unlike VIDEO,
 * a DOCUMENT's `download_url` carries no playback token, so nothing about it
 * can be delegated to the browser. The bytes become a `blob:` URL, which an
 * `<iframe>`, a new tab and a download anchor can all use without a credential.
 *
 * Every load owns an `AbortController` and tags its result with the lesson it
 * belongs to, so a reply for a lesson the member just left can never be shown
 * under the one they are now on. The cleanup revokes the object URL it created,
 * which is what keeps a document from outliving its lesson - see the navigation
 * requirement that "the document resource must be cleaned up".
 *
 * Nothing is persisted. The URL lives in memory for the life of the component
 * and in no storage of any kind.
 */
export function useDocumentResource(
  api: LearningApi,
  lessonId: UUID,
  enabled: boolean,
): DocumentResourceState {
  const [attempt, setAttempt] = useState(0)
  const key = `${lessonId}:${attempt}`

  const [loaded, setLoaded] = useState<{
    key: string
    resource: MemberResource
    objectUrl: string
  } | null>(null)
  const [failed, setFailed] = useState<{ key: string; failure: DocumentFailure } | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    let active = true
    let created: string | null = null

    void (async () => {
      try {
        const resource = await api.getLessonResource(lessonId, controller.signal)
        const blob = await api.getResourceContent(resource.download_url, controller.signal)
        const objectUrl = URL.createObjectURL(blob)

        // The member moved on while the bytes were arriving. Release them now:
        // the cleanup below has already run and will not run again.
        if (!active) {
          URL.revokeObjectURL(objectUrl)
          return
        }

        created = objectUrl
        setLoaded({ key, resource, objectUrl })
      } catch (error: unknown) {
        if (isAbort(error) || !active) return
        setFailed({ key, failure: classify(error) })
      }
    })()

    return () => {
      active = false
      controller.abort()
      if (created !== null) URL.revokeObjectURL(created)
    }
  }, [api, lessonId, key, enabled])

  const current = loaded?.key === key ? loaded : null

  const status: DocumentStatus =
    current !== null ? 'ready' : failed?.key === key ? 'error' : 'loading'

  return useMemo(
    () => ({
      status,
      resource: current?.resource ?? null,
      objectUrl: current?.objectUrl ?? null,
      failure: status === 'error' ? (failed?.failure ?? 'unavailable') : null,
      reload,
    }),
    [status, current, failed, reload],
  )
}
