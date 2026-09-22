import type { CourseContentLesson } from '../../../api'
import { Button, Icon, Skeleton, SkeletonGroup } from '../../../design-system'
import type { CatalogLessonContent, LearningApi, LessonProgress } from '../api'
import { safeExternalUrl } from '../model'

import { DocumentViewer } from './DocumentViewer'
import styles from './LessonContent.module.css'
import { VideoPlayer } from './VideoPlayer'

export interface LessonContentProps {
  lesson: CourseContentLesson
  /** The selected lesson's own content; `null` for kinds that carry none. */
  detail: CatalogLessonContent | null
  status: 'loading' | 'ready' | 'error'
  onRetry: () => void
  /** Passed to the player, which owns the resource and progress requests. */
  api: LearningApi
  nextLessonTitle: string | null
  onNext: (() => void) | null
  onProgressConfirmed: (progress: LessonProgress) => void
}

/**
 * The LINK shell (Learning-Link).
 *
 * The URL comes from `GET /lessons/{id}`, and is re-checked against http(s)
 * before it reaches an `href`: nothing that arrives over the wire is trusted
 * enough to skip that. The member always leaves by an explicit click - the page
 * never navigates away on its own.
 */
function LinkPanel({ detail }: { detail: CatalogLessonContent }) {
  const href = safeExternalUrl(detail.content)

  if (href === null) {
    return (
      <p className={styles.unavailable}>This link is not available.</p>
    )
  }

  return (
    <div className={styles.resource}>
      <span className={styles.resourceGlyph} aria-hidden="true">
        <Icon name="external" size={24} />
      </span>
      <div className={styles.resourceBody}>
        {/* Learning-Link: the card names the resource before its address. */}
        <h2 className={styles.resourceTitle}>{detail.title}</h2>
        <p className={styles.resourceUrl}>{href}</p>
        <a
          className={styles.resourceLink}
          href={href}
          target="_blank"
          // `noopener` keeps the new tab from reaching back into this one.
          rel="noopener noreferrer"
        >
          <span>Open link</span>
          <Icon name="external" size={18} />
        </a>
        <p className={styles.resourceNote}>
          Opens an external website in a new tab. You will leave the platform.
        </p>
      </div>
    </div>
  )
}

/** TEXT lessons render the backend's own text, as plain paragraphs. */
function TextPanel({ detail }: { detail: CatalogLessonContent }) {
  const body = detail.content?.trim() ?? ''

  if (body === '') {
    return <p className={styles.unavailable}>This lesson has no text yet.</p>
  }

  return (
    <div className={styles.prose}>
      {/* Rendered as text nodes, never as markup: lesson content is authored
          data and must not become HTML in a member's browser. */}
      {body.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} className={styles.paragraph}>
          {paragraph}
        </p>
      ))}
    </div>
  )
}

/** Renders the selected lesson, by kind. */
export function LessonContent({
  lesson,
  detail,
  status,
  onRetry,
  api,
  nextLessonTitle,
  onNext,
  onProgressConfirmed,
}: LessonContentProps) {
  if (status === 'loading') {
    return (
      <SkeletonGroup label="Loading lesson" className={styles.skeleton}>
        <Skeleton variant="block" height={240} />
        <Skeleton variant="text" width="80%" />
        <Skeleton variant="text" width="60%" />
      </SkeletonGroup>
    )
  }

  if (status === 'error') {
    return (
      <div className={styles.error} role="alert">
        <p className={styles.errorTitle}>We couldn’t load this lesson</p>
        <p className={styles.errorBody}>Check your connection and try again.</p>
        <Button iconLeft="refresh" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }


  return (
    <div className={styles.content}>
      {lesson.content_type === 'VIDEO' ? (
        <VideoPlayer
          // A new lesson is a new video: remounting resets every piece of
          // playback state, so the previous lesson's position or error can
          // never appear under this one.
          key={lesson.id}
          api={api}
          lesson={lesson}
          nextLessonTitle={nextLessonTitle}
          onNext={onNext}
          onProgressConfirmed={onProgressConfirmed}
        />
      ) : null}
      {lesson.content_type === 'DOCUMENT' ? (
        // Keyed like the player: a new lesson is a new document, and remounting
        // is what releases the previous one's object URL and its state.
        <DocumentViewer key={lesson.id} api={api} lesson={lesson} />
      ) : null}
      {lesson.content_type === 'TEXT' && detail !== null ? <TextPanel detail={detail} /> : null}
      {lesson.content_type === 'LINK' && detail !== null ? <LinkPanel detail={detail} /> : null}

    </div>
  )
}
