import { Button, Icon } from '../../../design-system'
import type { LessonResource } from '../api'
import {
  TYPE_ICON,
  TYPE_LABEL,
  formatDurationInput,
  linkHost,
  parseDurationInput,
  type LessonFormValues,
} from '../structureModel'

import styles from './LessonPreview.module.css'

export interface LessonPreviewProps {
  values: LessonFormValues
  resource: LessonResource | null
}

/** How much of a TEXT lesson the card shows before the ellipsis. */
const EXCERPT = 180

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT).trimEnd()}…`
}

/**
 * "Preview · As members will see it" (Admin-Lesson-Editor, G07).
 *
 * Built from the form as it is being typed, so it follows every keystroke and
 * a change of type. It is a picture of the lesson, not the lesson: nothing in
 * it plays, opens or navigates. The board draws the member player here, but
 * there is no administrator playback endpoint - the member stream requires an
 * enrollment and a published course - so the frame is the player's own frame
 * and glyph without controls that would do nothing. "Open document" and
 * "Open link" are drawn disabled, as the board draws them.
 *
 * No storage reference, provider or file URL appears (the board's DEV NOTE);
 * a stored file is named by the filename the administrator uploaded.
 */
export function LessonPreview({ values, resource }: LessonPreviewProps) {
  const title = values.title.trim() === '' ? 'Untitled lesson' : values.title.trim()
  const type = values.contentType
  const seconds = parseDurationInput(values.durationSeconds)
  const duration = seconds === null ? '' : formatDurationInput(seconds)
  const host = type === 'LINK' ? linkHost(values.content) : ''

  return (
    <section className={styles.card} aria-labelledby="lesson-preview-title">
      <div className={styles.head}>
        <h2 id="lesson-preview-title" className={styles.title}>
          Preview
        </h2>
        <p className={styles.caption}>As members will see it</p>
      </div>

      <div className={styles.body}>
        {type === 'VIDEO' ? (
          <div className={styles.frame} aria-hidden="true">
            <span className={styles.shade} />
            <span className={styles.play}>
              <Icon name="play-filled" size={24} />
            </span>
          </div>
        ) : type === 'DOCUMENT' || type === 'LINK' ? (
          <span className={styles.glyph} aria-hidden="true">
            <Icon name={TYPE_ICON[type]} size={24} />
          </span>
        ) : null}

        <p className={styles.lessonTitle}>{title}</p>

        {type === 'TEXT' ? (
          <p className={styles.text}>
            {values.content.trim() === '' ? 'The lesson text appears here.' : excerpt(values.content)}
          </p>
        ) : (
          <p className={styles.meta}>
            <Icon name={TYPE_ICON[type]} size={16} className={styles.metaGlyph} />
            {type === 'VIDEO'
              ? [TYPE_LABEL.VIDEO, duration].filter((part) => part !== '').join(' · ')
              : type === 'DOCUMENT'
                ? resource === null
                  ? TYPE_LABEL.DOCUMENT
                  : `${TYPE_LABEL.DOCUMENT} · ${resource.filename}`
                : host === ''
                  ? TYPE_LABEL.LINK
                  : host}
          </p>
        )}

        {type === 'DOCUMENT' ? (
          <Button variant="secondary" iconRight="external" disabled>
            Open document
          </Button>
        ) : type === 'LINK' ? (
          <Button variant="secondary" iconRight="external" disabled>
            Open link
          </Button>
        ) : null}
      </div>
    </section>
  )
}
