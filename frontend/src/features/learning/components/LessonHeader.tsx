import { asIconName, Badge, Icon, lessonIcon } from '../../../design-system'
import { formatDuration } from '../../courses'
import type { LessonPlacement } from '../model'

import styles from './LessonHeader.module.css'

export interface LessonHeaderProps {
  placement: LessonPlacement
}

/**
 * The note under the description (Learning-Video, -Text, -Document, -Link):
 * how the lesson counts toward the course. Only a VIDEO counts, and the server
 * marks it complete itself; the other kinds say that they do not count.
 */
const progressNote: Record<string, string> = {
  VIDEO: 'The lesson is marked as complete automatically when the video ends.',
  DOCUMENT: 'Documents don’t count toward your course progress.',
  TEXT: 'Text lessons don’t count toward your course progress.',
  LINK: 'Links don’t count toward your course progress.',
}

/** Title case for the lesson kind, as the boards write it. */
const kindLabel: Record<string, string> = {
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  TEXT: 'Text',
  LINK: 'Link',
}

/**
 * The lesson's own heading (Learning-Video: "Module 2 · Lesson 2 of 6").
 *
 * The position line, the kind and the duration are all backend values; the
 * completion chip appears only for a VIDEO lesson, because only videos carry
 * completion at all.
 */
export function LessonHeader({ placement }: LessonHeaderProps) {
  const { lesson, module, numberInModule, lessonsInModule } = placement
  const duration = formatDuration(lesson.duration_seconds)
  const kind = kindLabel[lesson.content_type] ?? lesson.content_type
  const note = progressNote[lesson.content_type]

  return (
    <header className={styles.header}>
      <p className={styles.position}>
        {/* The board's line, exactly: the module's title is the breadcrumb's. */}
        {`Module ${module.position} · Lesson ${numberInModule} of ${lessonsInModule}`}
      </p>

      <h1 className={styles.title}>{lesson.title}</h1>

      <div className={styles.meta}>
        <span className={styles.kind}>
          <Icon name={asIconName(lessonIcon[lesson.content_type])} size={16} />
          <span>{duration === null ? kind : `${kind} · ${duration}`}</span>
        </span>

        {/* Only a VIDEO carries completion, and only the two states the
            backend can actually evidence are shown: finished, or started and
            not finished. A video with `watched_seconds: 0` gets no chip rather
            than an "In progress" that would not be true. */}
        {lesson.content_type === 'VIDEO' && lesson.completed === true ? (
          <Badge kind="learning-status" value="completed" />
        ) : null}
        {lesson.content_type === 'VIDEO' &&
        lesson.completed !== true &&
        (lesson.watched_seconds ?? 0) > 0 ? (
          <Badge kind="learning-status" value="in-progress" />
        ) : null}
      </div>

      {lesson.description === null ? null : (
        <p className={styles.description}>{lesson.description}</p>
      )}

      {note === undefined ? null : (
        <p className={styles.note}>
          <Icon name="info" size={16} className={styles.noteGlyph} />
          {note}
        </p>
      )}
    </header>
  )
}
