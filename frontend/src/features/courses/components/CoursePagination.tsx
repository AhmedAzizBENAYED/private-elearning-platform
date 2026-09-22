import { Button } from '../../../design-system'

import styles from './CoursePagination.module.css'

export interface CoursePaginationProps {
  page: number
  pageCount: number
  /** Disables both controls while the next page is in flight. */
  busy?: boolean
  /** Names the landmark; every paged list on the site gets its own. */
  label?: string
  onChange: (page: number) => void
}

/**
 * Previous / next paging for the catalogue.
 *
 * The design board shows no pager, because it was drawn with six courses and
 * the Backend-Gaps board records pagination as undesigned with the note "If the
 * API paginates, add a Load more or pager". The API does paginate, so this is
 * that pager, built from FE-01 components rather than invented chrome.
 *
 * The backend returns no `has_next` or `has_previous`, so the bounds come from
 * `page` and the page count derived from `total` - both values it does return.
 */
export function CoursePagination({
  page,
  pageCount,
  busy = false,
  label = 'Catalogue pages',
  onChange,
}: CoursePaginationProps) {
  if (pageCount <= 1) return null

  const atStart = page <= 1
  const atEnd = page >= pageCount

  return (
    <nav className={styles.pagination} aria-label={label}>
      <Button
        variant="secondary"
        iconLeft="chevron-left"
        disabled={atStart || busy}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </Button>

      {/* A live region: paging replaces the grid, so the change is announced. */}
      <p className={styles.status} aria-live="polite">
        Page <strong>{page}</strong> of {pageCount}
      </p>

      <Button
        variant="secondary"
        iconRight="chevron-right"
        disabled={atEnd || busy}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
