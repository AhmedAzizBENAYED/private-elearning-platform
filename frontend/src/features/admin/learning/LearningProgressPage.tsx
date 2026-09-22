import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  Button,
  FilterTabs,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonGroup,
  TextField,
  media,
  useMediaQuery,
} from '../../../design-system'
import { MessagePage } from '../../../pages/MessagePage'
import { useDebouncedValue } from '../../../shared/useDebouncedValue'
import { CoursePagination } from '../../courses/components/CoursePagination'

import type { LearningStatus } from './api'
import { LearningShell } from './components/LearningShell'
import { Stat, Stats } from './components/Figures'
import { ProgressCards } from './components/ProgressCards'
import { ProgressMatrix } from './components/ProgressMatrix'
import { ProgressRows } from './components/ProgressRows'
import styles from './Learning.module.css'
import {
  ACTIVITY_WINDOWS,
  SORT_OPTIONS,
  activeSince,
  isActivityWindow,
  isLearningStatus,
  isProgressSort,
  parsePage,
} from './model'
import { usePublishedCourses } from './usePublishedCourses'
import { useLearningProgress } from './useLearning'

/** Typing pauses before the list is queried again, as the member list uses. */
const SEARCH_DEBOUNCE_MS = 300

/** One page of the list view, in member x course pairs. */
const LIST_PAGE_SIZE = 20

/** The backend's maximum page (`Pagination.page_size`). */
const MAX_PAGE_SIZE = 100

const STATUS_FILTERS: readonly { value: LearningStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
]

/**
 * Learning progress · the matrix and the list (Admin-Progress,
 * Admin-Progress-List, Admin-Progress-Mobile).
 *
 * Search, course, status, activity window, sort, view and page live in the URL
 * and map one to one onto parameters `GET /admin/learning/progress` accepts, so
 * a filtered view can be linked, survives a refresh, and the figures in the
 * header are the server's count of everything that matches rather than of the
 * rows that happen to be loaded. Nothing is filtered, sorted or counted here.
 *
 * The matrix reads by member, so it asks for whole members: a page of
 * `courses x members` pairs ordered by member name. Sorting is offered in the
 * list view, where a row is the unit; the backend orders pairs, and a matrix
 * row is a member. Reported as a gap.
 */
export function LearningProgressPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const view = searchParams.get('view') === 'list' ? 'list' : 'matrix'
  const urlSearch = searchParams.get('search') ?? ''
  const courseId = searchParams.get('course') ?? ''
  const statusParam = searchParams.get('status')
  const status = isLearningStatus(statusParam) ? statusParam : null
  const windowParam = searchParams.get('activity')
  const window = isActivityWindow(windowParam) ? windowParam : 'any'
  const sortParam = searchParams.get('sort')
  const sort = isProgressSort(sortParam) ? sortParam : '-last_activity'
  const page = parsePage(searchParams.get('page'))

  // The window is measured once per mount, not on every render: recomputing
  // `active_since` each time would change the request each time, which is a
  // fetch loop rather than a filter.
  const [now] = useState(() => Date.now())

  const [term, setTerm] = useState(urlSearch)
  const [syncedSearch, setSyncedSearch] = useState(urlSearch)
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  // Back and forward must move the field too, not only the results.
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

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        // A new filter starts at the beginning: page 3 of the old result says
        // nothing about the new one.
        if (key !== 'page') next.delete('page')
        return next
      })
    },
    [setSearchParams],
  )

  const goToPage = useCallback(
    (next: number) => {
      setParam('page', next <= 1 ? null : String(next))
      globalThis.scrollTo?.({ top: 0, behavior: 'smooth' })
    },
    [setParam],
  )

  const clearFilters = useCallback(() => {
    setTerm('')
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const key of ['search', 'course', 'status', 'activity', 'page']) next.delete(key)
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  // The published catalogue: the matrix columns, and the course filter's
  // options. One request, shared by both.
  const courses = usePublishedCourses()
  const columns = courses.data ?? []

  // The matrix is read by member, so it asks for whole members: as many pairs
  // as courses x members, which keeps every member's row complete on the page.
  const pageSize = useMemo(() => {
    if (view === 'list' || columns.length === 0) return LIST_PAGE_SIZE
    const perPage = Math.max(1, Math.floor(MAX_PAGE_SIZE / columns.length))
    return Math.min(MAX_PAGE_SIZE, perPage * columns.length)
  }, [view, columns.length])

  const query = useMemo(
    () => ({
      page,
      pageSize,
      ...(urlSearch === '' ? {} : { search: urlSearch }),
      ...(courseId === '' ? {} : { courseId }),
      ...(status === null ? {} : { status }),
      ...(() => {
        const since = activeSince(window, now)
        return since === undefined ? {} : { activeSince: since }
      })(),
      sort: view === 'matrix' ? ('member' as const) : sort,
    }),
    [page, pageSize, urlSearch, courseId, status, window, now, sort, view],
  )

  // The matrix waits for its columns: without them it would not know how many
  // pairs make a page, and asking first would mean asking twice.
  const ready = view === 'list' || courses.status !== 'loading'
  const { status: state, data, reload } = useLearningProgress(query, ready)

  const phone = useMediaQuery(media.belowSm)
  const laptop = useMediaQuery(media.mdAndUp)

  const filtered = urlSearch !== '' || courseId !== '' || status !== null || window !== 'any'
  const counts = data?.counts ?? null
  const pageCount = data === null ? 1 : Math.max(1, Math.ceil(data.total / Math.max(1, data.page_size)))

  // Admin-Progress draws this as two joined buttons beside the title, named
  // "View" for assistive technology only: the options say what they choose, so
  // a printed label would be a second heading.
  const viewSwitch = (
    <SegmentedControl
      label="View"
      hideLabel
      className={styles.viewSwitch}
      options={[
        { value: 'matrix', label: 'Matrix', icon: 'layers' },
        { value: 'list', label: 'List', icon: 'list' },
      ]}
      value={view}
      onChange={(value) => setParam('view', value === 'matrix' ? null : value)}
    />
  )

  return (
    <LearningShell
      lede={
        view === 'matrix'
          ? 'How far every member has come in every course.'
          : 'One row for every member and course, with dates.'
      }
      action={viewSwitch}
    >
      {counts === null ? null : (
        <Stats>
          <Stat
            label="Member × course pairs"
            value={counts.all}
            caption={`${columns.length} published courses`}
          />
          <Stat label="Started" value={counts.started} />
          <Stat label="In progress" value={counts.in_progress} />
          <Stat label="Completed" value={counts.completed} />
          <Stat label="Not started" value={counts.not_started} />
        </Stats>
      )}

      <div className={styles.filters}>
        <TextField
          label="Search member or course"
          hideLabel
          placeholder="Name or course"
          iconLeft="search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className={styles.search}
        />
        <Select
          label="Course"
          hideLabel
          className={styles.filter}
          options={[
            { value: '', label: 'All courses' },
            ...columns.map((course) => ({ value: course.id, label: course.title })),
          ]}
          value={courseId}
          onChange={(event) => setParam('course', event.target.value)}
        />
        <Select
          label="Status"
          hideLabel
          className={styles.filter}
          options={STATUS_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
          value={status ?? 'all'}
          onChange={(event) => setParam('status', event.target.value === 'all' ? null : event.target.value)}
        />
        <Select
          label="Activity"
          hideLabel
          className={styles.filter}
          options={ACTIVITY_WINDOWS.map((option) => ({ value: option.value, label: option.label }))}
          value={window}
          onChange={(event) => setParam('activity', event.target.value === 'any' ? null : event.target.value)}
        />
        {/* Sorting orders pairs, which is a row of the list; a matrix row is a
            member, so the matrix keeps its members in name order. */}
        {view === 'list' ? (
          <Select
            label="Sort by"
            hideLabel
            className={styles.filter}
            options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            value={sort}
            onChange={(event) => setParam('sort', event.target.value)}
          />
        ) : null}
      </div>

      {counts === null ? null : (
        <FilterTabs
          label="Filter by status"
          appearance="chip"
          value={status ?? 'all'}
          onChange={(value) => setParam('status', value === 'all' ? null : value)}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'NOT_STARTED', label: 'Not started', count: counts.not_started },
            { value: 'IN_PROGRESS', label: 'In progress', count: counts.in_progress },
            { value: 'COMPLETED', label: 'Completed', count: counts.completed },
          ]}
        />
      )}

      {state === 'loading' || !ready ? (
        <SkeletonGroup label="Loading learning progress" className={styles.skeleton}>
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} variant="block" height={64} />
          ))}
        </SkeletonGroup>
      ) : state === 'error' || data === null ? (
        <MessagePage
          headingLevel={2}
          icon="wifi-off"
          title="We couldn’t load the learning progress"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        filtered ? (
          <MessagePage
            headingLevel={2}
            icon="search"
            tone="neutral"
            title="No row matches these filters"
            body="Try another member, another course, or a wider activity window."
            action={
              <Button variant="secondary" iconLeft="x" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <MessagePage
            headingLevel={2}
            icon="users"
            tone="neutral"
            title="Nothing to report yet"
            body="Learning progress appears once there is at least one member and one published course."
          />
        )
      ) : (
        <>
          <p className={styles.count} aria-live="polite">
            {data.total === 1 ? '1 row' : `${data.total} rows`}
          </p>

          {phone ? (
            <ProgressCards rows={data.items} courseCount={columns.length} />
          ) : view === 'matrix' && laptop ? (
            <ProgressMatrix rows={data.items} courses={columns} />
          ) : (
            <ProgressRows rows={data.items} now={now} />
          )}

          <p className={styles.showing}>
            {`Showing ${data.items.length} of ${data.total} rows · rows without activity sort last`}
          </p>

          <CoursePagination
            page={data.page}
            pageCount={pageCount}
            label="Learning progress pages"
            onChange={goToPage}
          />
        </>
      )}
    </LearningShell>
  )
}
