import type { CourseContentLesson } from '../../../api'
import { Button, Icon, Skeleton, SkeletonGroup, formatFileSize } from '../../../design-system'
import { media, useMediaQuery } from '../../../shared/useMediaQuery'
import type { LearningApi } from '../api'
import { type DocumentFailure, useDocumentResource } from '../useDocumentResource'

import styles from './DocumentViewer.module.css'

export interface DocumentViewerProps {
  api: LearningApi
  lesson: CourseContentLesson
}

/**
 * Media types the browser renders natively, with no library.
 *
 * Only `application/pdf` is configured on the backend
 * (`STORAGE_DOCUMENT_MIME_TYPES` defaults to it), but the setting is an
 * allowlist an administrator can widen, so the check is on the media type the
 * server actually reports rather than on the assumption that DOCUMENT means
 * PDF. Anything else gets the download path instead of a blank frame.
 */
const PREVIEWABLE = new Set(['application/pdf'])

/** A short label for the file kind, as the design's sidebar chip shows it. */
function kindLabel(mimeType: string): string {
  return mimeType === 'application/pdf' ? 'PDF' : 'Document'
}

const FAILURE_TEXT: Record<DocumentFailure, { title: string; body: string }> = {
  'signed-out': {
    title: 'Your session has expired',
    body: 'Sign in again to open this document.',
  },
  forbidden: {
    title: 'You can’t open this document',
    body: 'Your access to this course may have changed. Contact an administrator if you think this is wrong.',
  },
  missing: {
    title: 'This document is no longer available',
    body: 'It may have been removed or replaced. Contact an administrator if you were expecting a file here.',
  },
  unavailable: {
    title: 'We couldn’t load this document',
    body: 'Check your connection and try again.',
  },
}

/**
 * The DOCUMENT lesson body (Learning-Document).
 *
 * The file is fetched through the authenticated client and turned into a
 * `blob:` URL, because a DOCUMENT's backend URL carries no token and a browser
 * cannot put an Authorization header on an `<iframe>`, an `<a download>` or a
 * new tab. That object URL is same-origin, so the browser's own PDF viewer
 * renders it - no pdf.js, no react-pdf, no dependency at all.
 *
 * Nothing here writes progress: the backend answers 409 to a progress write for
 * any lesson that is not a VIDEO, and documents are excluded from the course
 * percentage, which the note below the actions says out loud.
 */
export function DocumentViewer({ api, lesson }: DocumentViewerProps) {
  // `has_resource` is the backend's own answer to "is there a file?". Asking
  // for one that does not exist would only produce a 404 dressed as a failure.
  const hasResource = lesson.has_resource
  const { status, resource, objectUrl, failure, reload } = useDocumentResource(
    api,
    lesson.id,
    hasResource,
  )

  // The inline frame is not rendered on phones at all: a PDF in an iframe is
  // unusable at that width on several mobile browsers, and iOS Safari refuses
  // to scroll one. The actions below it are the real affordance there.
  const narrow = useMediaQuery(media.belowSm)

  if (!hasResource) {
    return (
      <div className={styles.card}>
        <span className={styles.glyph} aria-hidden="true">
          <Icon name="doc" size={36} />
        </span>
        <h2 className={styles.title}>{lesson.title}</h2>
        <p className={styles.body}>No document has been uploaded for this lesson yet.</p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <SkeletonGroup label="Loading document" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={narrow ? 160 : 560} />
      </SkeletonGroup>
    )
  }

  if (status === 'error' || resource === null || objectUrl === null) {
    const text = FAILURE_TEXT[failure ?? 'unavailable']
    return (
      <div className={styles.error} role="alert">
        <p className={styles.errorTitle}>{text.title}</p>
        <p className={styles.errorBody}>{text.body}</p>
        <Button iconLeft="refresh" onClick={reload}>
          Try again
        </Button>
      </div>
    )
  }

  const previewable = PREVIEWABLE.has(resource.mime_type)
  const kind = kindLabel(resource.mime_type)

  return (
    <section className={styles.viewer} aria-label={`Document: ${resource.filename}`}>
      <header className={styles.header}>
        <span className={styles.headerGlyph} aria-hidden="true">
          <Icon name="doc" size={20} />
        </span>
        <p className={styles.filename}>{resource.filename}</p>
        <span className={styles.chip}>{kind}</span>
        <span className={styles.size}>{formatFileSize(resource.size_bytes)}</span>
      </header>

      {previewable && !narrow ? (
        <iframe
          className={styles.frame}
          src={objectUrl}
          // Named for the accessibility tree: an untitled frame is announced as
          // nothing more than "frame".
          title={`Preview of ${resource.filename}`}
        />
      ) : (
        <div className={styles.fallback}>
          <span className={styles.glyph} aria-hidden="true">
            <Icon name="doc" size={36} />
          </span>
          <p className={styles.body}>
            {previewable
              ? 'Open the document to read it on this screen.'
              : `A preview isn’t available for this file type (${resource.mime_type}). Download it to read it.`}
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {/* Opening is always the member's own click - a document is never
            fetched into a tab or saved to disk on their behalf. */}
        <Button
          iconRight="external"
          onClick={() => globalThis.open(objectUrl, '_blank', 'noopener,noreferrer')}
        >
          Open document
        </Button>
        <Button
          variant="secondary"
          iconLeft="download"
          href={objectUrl}
          // The server's own filename, from `MemberResourceResponse`, not one
          // invented here.
          download={resource.filename}
        >
          Download
        </Button>
      </div>

      <p className={styles.note}>Opens in a new tab.</p>
    </section>
  )
}
