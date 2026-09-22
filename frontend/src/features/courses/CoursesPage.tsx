import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { CatalogEnrollmentCounts, EnrollmentFilter } from '../../api'
import { Button, FilterTabs, Icon, Skeleton, SkeletonGroup, TextField } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { useDebouncedValue } from '../../shared/useDebouncedValue'

import { CoursePagination } from './components/CoursePagination'
import { CourseGrid } from './components/CourseGrid'
import styles from './CoursesPage.module.css'
import { useCourses } from './useCourses'

/** Typing pauses before the catalogue is queried again. */
const SEARCH_DEBOUNCE_MS = 300

function parsePage(raw: string | null): number {
  const page = Number(raw)
  // The backend accepts 1..1_000_000; anything else is treated as the first page.
  return Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1
}

/** The tabs, in the board's order; `null` is "All", which sends no filter. */
const TABS: readonly { value: EnrollmentFilter | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'not_enrolled', label: 'Not enrolled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
]

/**
 * The tab the URL names. Anything the backend would refuse (422) is read as
 * "All", as an out-of-range page is read as the first one.
 */
function parseEnrollment(raw: string | null): EnrollmentFilter | null {
  return TABS.find((tab) => tab.value !== null && tab.value === raw)?.value ?? null
}

/** A tab's figure: the backend's `enrollment_counts`, or none while unknown. */
function tabCount(counts: CatalogEnrollmentCounts | null, value: EnrollmentFilter | null): number | null {
  if (counts === null) return null
  return value === null ? counts.all : counts[value]
}

/**
 * A filtered tab with nothing in it. Catalogue-States draws the "Completed"
 * one; the two others follow its pattern - what is missing, how to get there,
 * and a way back to every course.
 */
const EMPTY_TAB: Record<EnrollmentFilter, { title: string; body: string }> = {
  completed: {
    title: 'No completed course yet',
    body: 'Finish all the video lessons of a course to see it here.',
  },
  in_progress: {
    title: 'No course in progress',
    body: 'Start a course to see it here.',
  },
  not_enrolled: {
    title: 'You’re enrolled in every course',
    body: 'Courses published later will appear here.',
  },
}

/** Keeps the layout while the page loads, so the grid does not jump (DS 06). */
function CatalogueSkeleton() {
  return (
    <SkeletonGroup label="Loading courses" className={styles.skeletonGrid}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} variant="block" height={420} />
      ))}
    </SkeletonGroup>
  )
}

/**
 * The member course catalogue (Catalogue board).
 *
 * The tab, the search and the page live in the URL (`enrollment`, `search`,
 * `page`), so a view can be linked, survives a refresh and follows Back and
 * Forward - and each maps onto a parameter the backend accepts. The URL is
 * the only copy: nothing here holds the tab in state of its own.
 *
 * The tabs ("All / Not enrolled / In progress / Completed", G04) are filtered
 * and counted by the backend (`enrollment`, `enrollment_counts`): a figure is
 * never counted from the rows of the page on screen, which hold one page of
 * one tab.
 *
 * Enrollment *state* and progress are shown on each card from a single
 * `/me/enrollments` read - never one request per course.
 */
export function CoursesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const urlSearch = searchParams.get('search') ?? ''
  const page = parsePage(searchParams.get('page'))
  const enrollment = parseEnrollment(searchParams.get('enrollment'))

  // The field is controlled locally so typing stays responsive; the URL and the
  // request follow once typing settles.
  const [term, setTerm] = useState(urlSearch)
  const [syncedSearch, setSyncedSearch] = useState(urlSearch)
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  // Back/forward must move the field too, not just the results. Adjusted during
  // render rather than in an effect, so the field never paints a stale term.
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch)
    setTerm(urlSearch)
  }

  useEffect(() => {
    if (debouncedTerm === urlSearch) return

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (debouncedTerm === '') next.delete('search')
        else next.set('search', debouncedTerm)
        // A new search starts at the beginning: page 3 of the old results is
        // meaningless against the new ones.
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [debouncedTerm, urlSearch, setSearchParams])

  const query = useMemo(() => ({ page, search: urlSearch, enrollment }), [page, urlSearch, enrollment])
  const { status, data, reload } = useCourses(query)

  const goToPage = useCallback(
    (next: number) => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (next <= 1) params.delete('page')
        else params.set('page', String(next))
        return params
      })
      // Paging replaces the grid; start reading from the top of it. Skipped
      // when already at the top, which also keeps jsdom quiet in tests.
      if ((globalThis.scrollY ?? 0) > 0) globalThis.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [setSearchParams],
  )

  const clearSearch = useCallback(() => {
    setTerm('')
  }, [])

  // A new tab is a new list: its page 1, with the search kept. Pushed rather
  // than replaced, so Back returns to the previous tab.
  const chooseTab = useCallback(
    (next: EnrollmentFilter | null) => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (next === null) params.delete('enrollment')
        else params.set('enrollment', next)
        params.delete('page')
        return params
      })
    },
    [setSearchParams],
  )

  const header = (
    <header className={styles.header}>
      <h1 className={styles.title}>Courses</h1>
      <p className={styles.lede}>Browse the courses published by the association.</p>
      <div className={styles.rule} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>
    </header>
  )

  const counts = data?.counts ?? null

  const toolbar = (
    <div className={styles.toolbar}>
      <div className={styles.tabs}>
        <FilterTabs
          label="Filter by enrollment"
          appearance="tab"
          options={TABS.map((tab) => ({ ...tab, count: tabCount(counts, tab.value) }))}
          value={enrollment}
          onChange={chooseTab}
        />
      </div>
      <div className={styles.search}>
        <TextField
          label="Search courses"
          hideLabel
          type="search"
          name="search"
          placeholder="Search courses"
          iconLeft="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          hint="Matches the course title."
        />
      </div>
    </div>
  )

  if (status === 'error' || (status === 'ready' && data === null)) {
    return (
      <div className={styles.page}>
        {header}
        {toolbar}
        <div className={styles.stateCard}>
          <MessagePage
            headingLevel={2}
            icon="wifi-off"
            title="We couldn’t load the courses"
            body="Check your connection and try again."
            action={
              <Button iconLeft="refresh" onClick={reload}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const loading = status === 'loading'

  return (
    <div className={styles.page}>
      {header}
      {toolbar}

      {/* The count is the backend's own total for this query, across pages. */}
      <p className={styles.count} role="status">
        {loading || data === null
          ? 'Loading courses…'
          : `${data.total} ${data.total === 1 ? 'course' : 'courses'}`}
      </p>

      {loading || data === null ? (
        <CatalogueSkeleton />
      ) : data.courses.length === 0 ? (
        <div className={styles.stateCard}>
          {urlSearch === '' && enrollment !== null ? (
            <MessagePage
              headingLevel={2}
              icon={enrollment === 'completed' ? 'check-circle' : 'book'}
              tone="neutral"
              title={EMPTY_TAB[enrollment].title}
              body={EMPTY_TAB[enrollment].body}
              action={
                <Button variant="secondary" onClick={() => chooseTab(null)}>
                  Show all courses
                </Button>
              }
            />
          ) : urlSearch === '' ? (
            <MessagePage
              headingLevel={2}
              icon="book"
              tone="neutral"
              title="No courses yet"
              body="No course has been published yet. Come back soon."
            />
          ) : (
            <MessagePage
              headingLevel={2}
              icon="search"
              tone="neutral"
              title={`No course matches “${urlSearch}”`}
              body="Check the spelling or try a shorter keyword."
              action={
                <Button variant="secondary" iconLeft="x" onClick={clearSearch}>
                  Clear search
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <>
          <CourseGrid courses={data.courses} label="Courses" />
          <CoursePagination page={data.page} pageCount={data.pageCount} onChange={goToPage} />
        </>
      )}

      {/* Cards lose their enrolled/completed badge when this read fails, but the
          catalogue itself is unaffected, so it degrades rather than erroring. */}
      {data?.enrollmentsUnavailable ? (
        <p className={styles.notice} role="status">
          <Icon name="alert" size={18} className={styles.noticeIcon} />
          <span>We couldn’t check which courses you are enrolled in.</span>
          <Button variant="tertiary" size="sm" onClick={reload}>
            Try again
          </Button>
        </p>
      ) : null}
    </div>
  )
}
