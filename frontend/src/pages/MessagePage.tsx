import type { ReactNode } from 'react'

import { Icon, type IconName } from '../design-system'

import styles from './MessagePage.module.css'

export interface MessagePageProps {
  /** Small uppercase line above the heading, e.g. "Error 404". */
  overline?: string
  title: string
  body: string
  icon: IconName
  /** `danger` tints the glyph disc red, as the Access-States board does. */
  tone?: 'danger' | 'neutral'
  /**
   * The heading level of `title`.
   *
   * `1` - the default - is right when the message *is* the page: a 404, a 403,
   * a course that could not be loaded. It is wrong when the message sits inside
   * a page that already has its own `<h1>`, as every empty and error state
   * does: two `<h1>`s on one page leave a screen reader with no way to tell
   * which one names the page.
   *
   * The level changes the element only. The class, and therefore the type, the
   * spacing and the colour, are the same at every level, so nothing moves.
   */
  headingLevel?: 1 | 2 | 3
  action?: ReactNode
}

/**
 * The centred message card from the Access-States board.
 *
 * One component for 403, 404 and any later shell-level message, so the three
 * cannot drift apart. Feature-specific empty and error states build on it too,
 * and pass `headingLevel` so the card's title sits under the page's own `<h1>`
 * instead of competing with it.
 */
export function MessagePage({
  overline,
  title,
  body,
  icon,
  tone = 'danger',
  headingLevel = 1,
  action,
}: MessagePageProps) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3'

  return (
    <div className={styles.card}>
      <div className={[styles.glyph, tone === 'danger' ? styles.danger : styles.neutral].join(' ')}>
        <Icon name={icon} size={28} />
      </div>
      {overline ? <p className={styles.overline}>{overline}</p> : null}
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.body}>{body}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
