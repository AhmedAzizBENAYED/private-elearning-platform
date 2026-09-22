import { useCallback, useRef, useState } from 'react'

import { advanceUploadPercent, useApiClient } from '../../api'
import type { UUID } from '../../api'

import { createAdminApi, type LessonResource } from './api'
import { RESOURCE_ERROR, checkFile, classifyResource } from './resourceModel'

/**
 * Where one lesson's file transfer stands.
 *
 * `progress` is 0-100 from the bytes the browser has sent, or `null` while the
 * transfer's extent is unknown (indeterminate). Success is not a state here:
 * the stored resource goes to `onUploaded`, and the lesson then holds it.
 */
export type ResourceUploadState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; progress: number | null }
  | { status: 'failed'; file: File; message: string }

export interface ResourceUpload {
  state: ResourceUploadState
  upload: (file: File) => void
  cancel: () => void
  /** Sends the file of a failed attempt again. */
  retry: () => void
}

export interface ResourceUploadOptions {
  lessonId: UUID
  contentType: 'VIDEO' | 'DOCUMENT'
  onUploaded: (resource: LessonResource) => void
}

/**
 * One lesson's upload: the single `PUT /admin/lessons/{id}/resource`, its
 * progress, its failure and its cancellation (G33).
 *
 * The caller renders `state` and never sees how the bytes travel. Progress
 * comes from the transport's own measurements (`advanceUploadPercent`) and a
 * render happens only when the whole percentage changes, not on every event.
 */
export function useResourceUpload({
  lessonId,
  contentType,
  onUploaded,
}: ResourceUploadOptions): ResourceUpload {
  const client = useApiClient()
  const [state, setState] = useState<ResourceUploadState>({ status: 'idle' })

  // Held for the lifetime of one transfer, so Cancel can abort it and so a
  // second pick can be recognised as arriving mid-transfer.
  //
  // Deliberately *not* aborted on unmount: navigating away from the course
  // should not destroy a transfer that may be most of the way through a large
  // video. The request finishes, the server stores the file, and the next read
  // of the structure shows it. The settle handlers then run against an
  // unmounted component, which React treats as a no-op.
  const transferRef = useRef<AbortController | null>(null)

  const upload = useCallback(
    (file: File) => {
      // A transfer already running owns this panel; a second pick is ignored
      // rather than racing it.
      if (transferRef.current !== null) return

      const local = checkFile(contentType, file)
      if (local !== null) {
        setState({ status: 'failed', file, message: local })
        return
      }

      const controller = new AbortController()
      transferRef.current = controller
      setState({ status: 'uploading', file, progress: null })

      void createAdminApi(client)
        .uploadResource(lessonId, file, {
          signal: controller.signal,
          onProgress: (measured) => {
            setState((current) => {
              // A late event from a cancelled or finished transfer changes nothing.
              if (current.status !== 'uploading' || transferRef.current !== controller) return current
              const progress = advanceUploadPercent(current.progress, measured)
              return progress === current.progress ? current : { ...current, progress }
            })
          },
        })
        .then(
          (stored) => {
            transferRef.current = null
            setState({ status: 'idle' })
            onUploaded(stored)
          },
          (error: unknown) => {
            // A cancelled upload is the administrator's own decision, not a
            // failure to report back to them; `cancel` has already reset the
            // panel, which may be running a newer transfer by now.
            if (error instanceof DOMException && error.name === 'AbortError') return
            transferRef.current = null
            setState({ status: 'failed', file, message: RESOURCE_ERROR[classifyResource(error)] })
          },
        )
    },
    [client, lessonId, contentType, onUploaded],
  )

  const cancel = useCallback(() => {
    transferRef.current?.abort()
    transferRef.current = null
    setState({ status: 'idle' })
  }, [])

  const retry = useCallback(() => {
    if (state.status !== 'failed') return
    setState({ status: 'idle' })
    upload(state.file)
  }, [state, upload])

  return { state, upload, cancel, retry }
}
