import { type ChangeEvent, type DragEvent, useCallback, useId, useRef, useState } from 'react'

import { Progress } from '../../feedback/Progress'
import { Icon } from '../../icons'
import { Button } from '../Button'
import fieldStyles from '../Field/Field.module.css'

import { formatFileSize } from './formatFileSize'

import styles from './FileDropzone.module.css'

export type FileDropzoneKind = 'video' | 'document'

export type FileDropzoneStatus = 'idle' | 'uploading' | 'uploaded' | 'error'

export interface FileDropzoneProps {
  label: string
  /** Chooses the prompt copy and the glyph. No provider is ever named. */
  kind: FileDropzoneKind
  /**
   * Controlled status. `dragging` is not part of this union: it is a pointer
   * state this component tracks itself and never reports upwards.
   */
  status?: FileDropzoneStatus
  fileName?: string
  /** Size in bytes; rendered with `formatFileSize`. */
  fileSize?: number
  /**
   * 0-100, shown while `status` is `uploading`.
   *
   * Omitted, the upload is treated as **indeterminate**: the bar animates and
   * no percentage is shown. A caller passes a value only once the transfer
   * has measured one; a hard-coded 0% or a synthetic ramp would both be a
   * claim about the transfer that the transfer never made.
   */
  progress?: number
  error?: string
  disabled?: boolean
  /** Forwarded to the input's `accept`. The real rules belong to the API. */
  acceptedTypes?: string
  multiple?: boolean
  hint?: string
  onFileSelected?: (files: File[]) => void
  onCancel?: () => void
  onRetry?: () => void
  onRemove?: () => void
  className?: string
}

const prompt: Record<FileDropzoneKind, string> = {
  video: 'Drag and drop a video here',
  document: 'Drag and drop a document here',
}

/** The glyph beside a chosen file, so a PDF does not show a film icon. */
const fileIcon: Record<FileDropzoneKind, 'video-file' | 'doc'> = {
  video: 'video-file',
  document: 'doc',
}

const ELLIPSIS = '…'
const MIDDOT = '·'

/**
 * What the upload's status region says, in quarters.
 *
 * The bar's own `aria-valuenow` follows every percent, but a progressbar is
 * not a live region, so a screen reader only hears it when asked. This polite
 * region speaks at the start, at 25, 50 and 75%, and at 100% - a handful of
 * announcements for the whole transfer rather than one per percent.
 */
function uploadAnnouncement(fileName: string, progress: number | undefined): string {
  if (progress === undefined) return `Uploading ${fileName}`
  const quarter = Math.floor(Math.min(100, Math.max(0, progress)) / 25) * 25
  return `Uploading ${fileName}: ${quarter}%`
}

/**
 * The file-picking surface for VIDEO and DOCUMENT lessons (DS 05).
 *
 * This component performs no upload: it reports the chosen files and renders
 * whatever status its owner passes back. FE-13 supplies the transfer.
 */
export function FileDropzone({
  label,
  kind,
  status = 'idle',
  fileName,
  fileSize,
  progress,
  error,
  disabled = false,
  acceptedTypes,
  multiple = false,
  hint,
  onFileSelected,
  onCancel,
  onRetry,
  onRemove,
  className,
}: FileDropzoneProps) {
  const inputId = useId()
  const hintId = hint ? `${inputId}-hint` : undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const emit = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      onFileSelected?.(Array.from(files))
    },
    [onFileSelected],
  )

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emit(event.target.files)
      // Allow re-picking the same file after a failed attempt.
      event.target.value = ''
    },
    [emit],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      setDragging(false)
      if (disabled) return
      emit(event.dataTransfer.files)
    },
    [disabled, emit],
  )

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      if (!disabled) setDragging(true)
    },
    [disabled],
  )

  const fileInput = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      className={styles.input}
      accept={acceptedTypes}
      multiple={multiple}
      disabled={disabled}
      // The visible heading names this control in every status, including the
      // two where no <label> element is rendered around it.
      aria-label={label}
      aria-describedby={hintId}
      onChange={handleChange}
    />
  )

  const sizeLabel = fileSize === undefined ? undefined : formatFileSize(fileSize)
  const indeterminate = progress === undefined
  const rowIcon = fileIcon[kind]

  let body

  if (status === 'idle') {
    body = (
      <label
        className={[
          styles.dropzone,
          dragging ? styles.dragging : undefined,
          disabled ? styles.dropzoneDisabled : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        htmlFor={inputId}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {fileInput}
        <span className={styles.prompt}>
          <Icon name="upload" size={28} />
          <span className={styles.promptTitle}>
            {dragging ? 'Drop the file to upload' : prompt[kind]}
          </span>
          {dragging ? null : (
            <span className={styles.promptHint}>
              or <span className={styles.browse}>browse your files</span>
            </span>
          )}
        </span>
      </label>
    )
  } else if (status === 'uploading') {
    body = (
      <div className={styles.row}>
        <Icon name={rowIcon} size={24} className={styles.rowIcon} />
        <div className={[styles.rowBody, styles.uploadingBody].join(' ')}>
          <div className={styles.rowHead}>
            <span className={styles.fileName}>{fileName}</span>
            {indeterminate ? null : (
              <span className={styles.percent}>{Math.round(progress)}%</span>
            )}
          </div>
          <Progress
            value={progress ?? 0}
            indeterminate={indeterminate}
            size={6}
            label={`Uploading ${fileName ?? 'file'}`}
          />
          <span className={styles.meta}>
            {`Uploading${ELLIPSIS}${sizeLabel ? ` ${sizeLabel}` : ''}`}
          </span>
          <span className="dsVisuallyHidden" role="status">
            {uploadAnnouncement(fileName ?? 'file', progress)}
          </span>
        </div>
        <div className={styles.actions}>
          {/* 44px, as every control on the admin editor (DS 05 "md"): the
              board draws these at 36px, which is below the platform's target. */}
          <Button variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    )
  } else if (status === 'uploaded') {
    body = (
      <div className={styles.row}>
        <Icon name={rowIcon} size={24} className={styles.rowIcon} />
        <div className={styles.rowBody}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.meta}>
            <Icon name="check-circle" size={16} className={styles.metaIcon} />
            {`Uploaded${sizeLabel ? ` ${MIDDOT} ${sizeLabel}` : ''}`}
          </span>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            iconLeft="upload"
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
          <Button
            variant="tertiary"
            iconOnly
            iconLeft="trash"
            aria-label={fileName ? `Remove ${fileName}` : 'Remove file'}
            onClick={onRemove}
          />
          {fileInput}
        </div>
      </div>
    )
  } else {
    body = (
      <div className={[styles.row, styles.rowError].join(' ')}>
        <Icon name={rowIcon} size={24} className={styles.rowIcon} />
        <div className={styles.rowBody}>
          <span className={styles.fileName}>{fileName}</span>
          <p className={styles.errorText} role="alert">
            <Icon name="alert" size={16} className={styles.errorIcon} />
            <span>{error ?? 'Upload failed. Check your connection and try again.'}</span>
          </p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" iconLeft="refresh" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <span className={fieldStyles.label}>{label}</span>
      {body}
      {hint ? (
        <p className={fieldStyles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
