import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { routes } from '../../app/routes'
import type { CourseStatus } from '../../api'
import { Button, ConfirmDialog, Skeleton, SkeletonGroup, TextField, Toast } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { useDebouncedValue } from '../../shared/useDebouncedValue'
import { CoursePagination } from '../courses/components/CoursePagination'

import type { AdminCourse } from './api'
import { CoursesTable } from './components/CoursesTable'
import { CourseStatusTabs } from './components/CourseStatusTabs'
import { type CourseTransition } from './courseModel'
import { useAdminCourse } from './useAdminCourse'
import { useAdminCourses } from './useAdminCourses'
import { LinkButton } from '../../app/LinkButton'
import styles from './AdminCoursesPage.module.css'

const SEARCH_DEBOUNCE_MS = 300

const STATUSES: CourseStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

function parsePage(raw: string | null): number {
  const page = Number(raw)
  return Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1
}

function parseStatus(raw: string | null): CourseStatus | null {
  return STATUSES.includes(raw as CourseStatus) ? (raw as CourseStatus) : null
}

/** The wording each transition is confirmed with (Admin-Courses-States). */
const CONFIRM: Record<CourseTransition, (title: string) => { title: string; body: string; label: string }> = {
  publish: (title) => ({
    title: `Publish “${title}”?`,
    body: 'Members will see this course in the catalogue and will be able to enroll. Make sure the modules and lessons are ready.',
    label: 'Publish course',
  }),
  archive: (title) => ({
    title: `Archive “${title}”?`,
    body: 'Archiving is the last step of a course’s life. It can’t be published again, and it can no longer be edited.',
    label: 'Archive course',
  }),
}

const TRANSITION_ERROR: Record<string, string> = {
  lifecycle: 'The course is no longer in a state that allows this change. Reload the list to see where it stands.',
  'not-found': 'This course no longer exists. Reload the list.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  'not-draft': 'Only draft courses can be edited.',
  'slug-taken': 'Another course already uses that address.',
  invalid: 'The change was rejected as invalid.',
  unavailable: 'The change could not be saved. Check your connection and try again.',
}

function CoursesSkeleton() {
  return (
    <SkeletonGroup label="Loading courses" className={styles.skeleton}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} variant="block" height={60} />
      ))}
    </SkeletonGroup>
  )
}

/**
 * The course listing (Admin-Courses).
 *
 * Status, search and page live in the URL and map one to one onto the
 * parameters `CourseQuery` accepts - `status`, `search`, `page`, `page_size` -
 * so a filtered view can be linked and survives a refresh, and every figure on
 * screen is the server's count rather than a tally of what happens to be
 * loaded.
 *
 * The two lifecycle transitions are run from here so the list can refresh
 * itself afterwards; the row the server returns is what decides the new badge.
 */
export function AdminCoursesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const urlSearch = searchParams.get('search') ?? ''
  const status = parseStatus(searchParams.get('status'))
  const page = parsePage(searchParams.get('page'))

  const [term, setTerm] = useState(urlSearch)
  const [syncedSearch, setSyncedSearch] = useState(urlSearch)
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch)
    setTerm(urlSearch)
  }

  useEffect(() => {
    if (debouncedTerm !== term || debouncedTerm === urlSearch) return

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (debouncedTerm === '') next.delete('search')
        else next.set('search', debouncedTerm)
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [debouncedTerm, term, urlSearch, setSearchParams])

  const query = useMemo(() => ({ page, search: urlSearch, status }), [page, urlSearch, status])
  const { status: listStatus, data, counts, reload } = useAdminCourses(query)

  const onStatusChange = useCallback(
    (next: CourseStatus | null) => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (next === null) params.delete('status')
        else params.set('status', next)
        params.delete('page')
        return params
      })
    },
    [setSearchParams],
  )

  const goToPage = useCallback(
    (next: number) => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (next <= 1) params.delete('page')
        else params.set('page', String(next))
        return params
      })
      globalThis.scrollTo?.({ top: 0, behavior: 'smooth' })
    },
    [setSearchParams],
  )

  const clearFilters = useCallback(() => {
    setTerm('')
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  // The transition is confirmed first, then run through the course hook, which
  // owns the two endpoints. Nothing about the new status is guessed here.
  const [pending, setPending] = useState<{ course: AdminCourse; to: CourseTransition } | null>(null)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  // Admin-Courses-States, "Feedback · toasts": "Course published". The board
  // draws no toast for an archive; the row's badge says it.
  const [published, setPublished] = useState<string | null>(null)

  const askTransition = useCallback((course: AdminCourse, to: CourseTransition) => {
    setTransitionError(null)
    setPending({ course, to })
  }, [])

  const filtered = urlSearch !== '' || status !== null

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Courses</h1>
          <p className={styles.subtitle}>Create, publish and archive the courses of the platform.</p>
        </div>
        <LinkButton to={routes.adminCourseNew} iconLeft="plus">
          Create course
        </LinkButton>
      </header>

      <CourseStatusTabs current={status} counts={counts} onChange={onStatusChange} />

      <TextField
        label="Search courses"
        hideLabel
        placeholder="Search courses"
        iconLeft="search"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        className={styles.search}
      />

      {transitionError === null ? null : (
        <p className={styles.error} role="alert">
          {transitionError}
        </p>
      )}

      {listStatus === 'loading' ? (
        <CoursesSkeleton />
      ) : listStatus === 'error' || data === null ? (
        <MessagePage
          headingLevel={2}
          icon="wifi-off"
          title="We couldn’t load the courses"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : data.courses.length === 0 ? (
        filtered ? (
          <MessagePage
            headingLevel={2}
            icon="search"
            tone="neutral"
            title={
              urlSearch === '' && status !== null
                ? `No ${status.toLowerCase()} courses`
                : `No course matches “${urlSearch}”`
            }
            body={
              // Admin-Courses-States draws the Archived filter's empty state;
              // the other filters keep the page's general wording.
              urlSearch === '' && status === 'ARCHIVED'
                ? 'Courses you archive will be listed here.'
                : 'Courses you create will appear here once they match the filter.'
            }
            action={
              <Button variant="secondary" iconLeft="x" onClick={clearFilters}>
                Show all courses
              </Button>
            }
          />
        ) : (
          <MessagePage
            headingLevel={2}
            icon="book"
            tone="neutral"
            title="No courses yet"
            body="Create your first course, add modules and lessons, then publish it for the members."
            action={
              <LinkButton to={routes.adminCourseNew} iconLeft="plus">
                Create course
              </LinkButton>
            }
          />
        )
      ) : (
        <>
          <p className={styles.count} aria-live="polite">
            {data.total === 1 ? '1 course' : `${data.total} courses`}
          </p>

          <CoursesTable courses={data.courses} onTransition={askTransition} />

          <CoursePagination
            page={data.page}
            pageCount={data.pageCount}
            label="Course pages"
            onChange={goToPage}
          />
        </>
      )}

      {pending === null ? null : (
        <TransitionDialog
          course={pending.course}
          to={pending.to}
          onDone={(message) => {
            setPending(null)
            setTransitionError(message)
            if (message === null) {
              if (pending.to === 'publish') setPublished(pending.course.title)
              reload()
            }
          }}
          onCancel={() => setPending(null)}
        />
      )}

      <Toast
        open={published !== null}
        title="Course published"
        body={published === null ? undefined : `“${published}” is now visible to members.`}
        onDismiss={() => setPublished(null)}
      />
    </div>
  )
}

/**
 * Runs one transition for one course.
 *
 * Mounted only while a transition is pending, so the course hook it uses is
 * scoped to exactly the row being changed and is torn down afterwards - the
 * listing keeps no per-row write state of its own.
 */
function TransitionDialog({
  course,
  to,
  onDone,
  onCancel,
}: {
  course: AdminCourse
  to: CourseTransition
  /** `null` on success; otherwise the message to show above the list. */
  onDone: (message: string | null) => void
  onCancel: () => void
}) {
  const { saving, transition } = useAdminCourse(course.id)
  const copy = CONFIRM[to](course.title)

  return (
    <ConfirmDialog
      open
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.label}
      tone={to === 'archive' ? 'danger' : 'primary'}
      busy={saving}
      onConfirm={() => {
        void transition(to).then((result) => {
          onDone(result.ok ? null : (TRANSITION_ERROR[result.failure ?? 'unavailable'] ?? null))
        })
      }}
      onCancel={onCancel}
    />
  )
}
