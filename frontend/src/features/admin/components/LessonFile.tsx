import { useCallback, useState } from 'react'

import { useApiClient } from '../../../api'
import type { UUID } from '../../../api'
import { ConfirmDialog, FileDropzone, Icon, formatFileSize } from '../../../design-system'
import { createAdminApi, type AdminLesson, type LessonResource } from '../api'
import {
  RESOURCE_ERROR,
  acceptFor,
  acceptSummary,
  classifyResource,
  dropzoneKind,
  resourceSummary,
} from '../resourceModel'
import { useResourceUpload } from '../useResourceUpload'

import styles from './LessonFile.module.css'

export interface LessonFileProps {
  /** Always a VIDEO or DOCUMENT lesson; the caller filters the other two. */
  lesson: AdminLesson & { content_type: 'VIDEO' | 'DOCUMENT' }
  /** The stored file, or `null` when the lesson holds none. */
  resource: LessonResource | null
  /** The course-wide resource listing failed, so presence is unknown. */
  unknown: boolean
  /** Uploads and deletions are draft-only; the backend answers 409 otherwise. */
  editable: boolean
  onChanged: (lessonId: UUID, resource: LessonResource | null) => void
}

/**
 * One lesson's stored file: what it is, and how to replace or remove it.
 *
 * The transfer is a single `PUT /admin/lessons/{id}/resource` carrying a
 * `FormData` with one `file` part. Upload and replacement are the same call -
 * a lesson holds at most one resource, and the service only discards the old
 * object once the new metadata is committed - so nothing here deletes a file in
 * order to upload one, and a failed replacement leaves the existing file intact.
 *
 * The chosen `File` is passed to `FormData` by reference and streamed by the
 * browser. It is never read with `FileReader`, never base64-encoded and never
 * copied into a Blob, so the memory cost is independent of the video's size.
 *
 * The transfer itself - its progress, failure and cancellation - belongs to
 * `useResourceUpload` (G33). The percentage is the share of the file's bytes
 * the browser has sent; until the browser has measured it, and whenever it
 * cannot, the bar stays indeterminate rather than showing an invented number.
 */
export function LessonFile({
  lesson,
  resource,
  unknown,
  editable,
  onChanged,
}: LessonFileProps) {
  const client = useApiClient()
  const [confirming, setConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const uploaded = useCallback(
    (stored: LessonResource) => onChanged(lesson.id, stored),
    [lesson.id, onChanged],
  )
  const {
    state: phase,
    upload: startUpload,
    cancel,
    retry,
  } = useResourceUpload({
    lessonId: lesson.id,
    contentType: lesson.content_type,
    onUploaded: uploaded,
  })

  const upload = useCallback(
    (file: File) => {
      setDeleteError(null)
      startUpload(file)
    },
    [startUpload],
  )

  const confirmDelete = useCallback(() => {
    setDeleting(true)
    setDeleteError(null)

    void createAdminApi(client)
      .deleteResource(lesson.id)
      .then(
        () => {
          setDeleting(false)
          setConfirming(false)
          onChanged(lesson.id, null)
        },
        (error: unknown) => {
          setDeleting(false)
          setDeleteError(RESOURCE_ERROR[classifyResource(error)])
        },
      )
  }, [client, lesson.id, onChanged])

  const kind = dropzoneKind(lesson.content_type)
  const label = lesson.content_type === 'VIDEO' ? 'Video file' : 'Document file'
  const busy = phase.status === 'uploading' || deleting

  if (unknown) {
    return (
      <p className={styles.unknown}>
        This lesson&rsquo;s file couldn&rsquo;t be read. Reload to see whether it has one.
      </p>
    )
  }

  const dropzone =
    phase.status === 'uploading' ? (
      <FileDropzone
        label={label}
        kind={kind}
        status="uploading"
        fileName={phase.file.name}
        fileSize={phase.file.size}
        // Omitted while nothing has been measured: the bar is then
        // indeterminate rather than showing a number nothing measured.
        progress={phase.progress ?? undefined}
        acceptedTypes={acceptFor(lesson.content_type)}
        onCancel={cancel}
      />
    ) : phase.status === 'failed' ? (
      <FileDropzone
        label={label}
        kind={kind}
        status="error"
        fileName={phase.file.name}
        fileSize={phase.file.size}
        error={phase.message}
        acceptedTypes={acceptFor(lesson.content_type)}
        onRetry={retry}
      />
    ) : resource !== null ? (
      editable ? (
        <FileDropzone
          label={label}
          kind={kind}
          status="uploaded"
          fileName={resource.filename}
          fileSize={resource.size_bytes}
          hint={resourceSummary(resource)}
          acceptedTypes={acceptFor(lesson.content_type)}
          onFileSelected={(files) => {
            const file = files[0]
            if (file !== undefined) upload(file)
          }}
          onRemove={() => {
            setDeleteError(null)
            setConfirming(true)
          }}
        />
      ) : (
        // A published or archived course keeps its file readable - the backend
        // still answers 200 to the metadata read - but every mutation answers
        // 409, so the file is described without offering Replace or Remove.
        // Disabling them would be a weaker statement: there is nothing here to
        // enable, whatever the person does.
        <div className={styles.readonly}>
          <span className={styles.readonlyLabel}>{label}</span>
          <span className={styles.readonlyRow}>
            <Icon name={kind === 'video' ? 'video-file' : 'doc'} size={20} />
            <span className={styles.readonlyName}>{resource.filename}</span>
            <span className={styles.readonlyMeta}>
              {`${formatFileSize(resource.size_bytes)} · ${resourceSummary(resource)}`}
            </span>
          </span>
        </div>
      )
    ) : editable ? (
      <FileDropzone
        label={label}
        kind={kind}
        hint={`${acceptSummary(lesson.content_type)}. The server checks the file itself.`}
        acceptedTypes={acceptFor(lesson.content_type)}
        onFileSelected={(files) => {
          const file = files[0]
          if (file !== undefined) upload(file)
        }}
      />
    ) : (
      <p className={styles.locked}>
        No file uploaded. Files can only be added while the course is a draft.
      </p>
    )

  return (
    <div className={styles.file} aria-busy={busy || undefined}>
      {dropzone}

      {deleteError === null || confirming ? null : (
        <p className={styles.error} role="alert">
          {deleteError}
        </p>
      )}

      {confirming ? (
        <ConfirmDialog
          open
          title={`Remove ${resource?.filename ?? 'this file'}?`}
          body={
            <>
              <span>
                The file is removed from the lesson and from storage. This cannot be undone, and
                the lesson keeps all of its other settings.
              </span>
              {deleteError === null ? null : (
                <span className={styles.dialogError} role="alert">
                  {deleteError}
                </span>
              )}
            </>
          }
          confirmLabel="Remove file"
          tone="danger"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => {
            setConfirming(false)
            setDeleteError(null)
          }}
        />
      ) : null}
    </div>
  )
}
