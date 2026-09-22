import styles from './RoutePlaceholder.module.css'

export interface RoutePlaceholderProps {
  title: string
  /** The ticket that replaces this placeholder with the real screen. */
  ticket: string
  description: string
}

/**
 * A routed page that does not exist yet.
 *
 * FE-03 builds the shell and the navigation, not the screens inside it. Each
 * route therefore renders an honest placeholder: it shows no invented data, it
 * calls no API, and it names the ticket that will replace it. Anything that
 * looked like a real dashboard here would be a placeholder presented as
 * working software.
 */
export function RoutePlaceholder({ title, ticket, description }: RoutePlaceholderProps) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{description}</p>
      </header>
      <p className={styles.badge}>Not implemented yet — {ticket}</p>
    </div>
  )
}
