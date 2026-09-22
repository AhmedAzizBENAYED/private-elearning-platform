import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { LinkButton } from '../../../app/LinkButton'
import { routes } from '../../../app/routes'
import {
  Button,
  Icon,
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

import { MemberCell } from './components/Cells'
import { Stat, Stats, StatusSplit } from './components/Figures'
import { ProgressCards } from './components/ProgressCards'
import { ProgressRows } from './components/ProgressRows'
import styles from './Learning.module.css'
import {
  SORT_OPTIONS,
  formatPercent,
  isLearningStatus,
  isProgressSort,
  parsePage,
  relativeTime,
} from './model'
import { useCourseLearning, useLearningProgress } from './useLearning'

const SEARCH_DEBOUNCE_MS = 300
const PAGE_SIZE = 20

/** How many members the "using it now or recently" panel names (the board's 3). */
const RECENT_MEMBERS = 3

/**
 * Course analytics (Admin-Course-Analytics).
 *
 *   GET /admin/courses/{id}/learning                     the figures
 *   GET /admin/learning/progress?course_id=...           the member rows
 *   GET /admin/learning/progress?course_id=...&sort=...  the three most recent
 *
 * The member rows are the same contract the list view uses, so a row means the
 * same thing on both screens. The course's own figures are the backend's: the
 * average is over the members who started and the completion rate is completed
 * ÷ started, as the board defines them.
 */
export function CourseLearningPage() {
  const { courseId = '' } = useParams<{ courseId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  const urlSearch = searchParams.get('search') ?? ''
  const statusParam = searchParams.get('status')
  const status = isLearningStatus(statusParam) ? statusParam : null
  const sortParam = searchParams.get('sort')
  const sort = isProgressSort(sortParam) ? sortParam : '-progress'
  const page = parsePage(searchParams.get('page'))

  const [now] = useState(() => Date.now())

  const [term, setTerm] = useState(urlSearch)
  const [syncedSearch, setSyncedSearch] = useState(urlSearch)
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch)
    setTerm(urlSearch)
  }

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        if (key !== 'page') next.delete('page')
        return next
      })
    },
    [setSearchParams],
  )

  // The field syncs to the URL once typing settles, exactly as the other lists:
  // in an effect, never during a render.
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

  const summary = useCourseLearning(courseId)

  const rowsQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      courseId,
      ...(urlSearch === '' ? {} : { search: urlSearch }),
      ...(status === null ? {} : { status }),
      sort,
    }),
    [page, courseId, urlSearch, status, sort],
  )
  const rows = useLearningProgress(rowsQuery)

  const recentQuery = useMemo(
    () => ({ page: 1, pageSize: RECENT_MEMBERS, courseId, sort: '-last_activity' as const }),
    [courseId],
  )
  const recent = useLearningProgress(recentQuery)

  const phone = useMediaQuery(media.belowSm)

  if (summary.status === 'loading') {
    return (
      <SkeletonGroup label="Loading course figures" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={220} />
      </SkeletonGroup>
    )
  }

  if (summary.status === 'error' || summary.data === null) {
    const missing = summary.failure === 'not-found'
    return (
      <MessagePage
        icon={missing ? 'book' : 'wifi-off'}
        tone={missing ? 'neutral' : undefined}
        title={missing ? 'No published course here' : 'We couldn’t load this course'}
        body={
          missing
            ? 'Learning progress is reported for published courses only. A draft or archived course has no member figures.'
            : 'Something went wrong while contacting the server.'
        }
        action={
          missing ? (
            <LinkButton to={routes.adminLearningCourses} variant="secondary" iconLeft="arrow-left">
              All courses
            </LinkButton>
          ) : (
            <Button iconLeft="refresh" onClick={summary.reload}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  const figures = summary.data
  const counts = figures.counts
  const pageCount =
    rows.data === null ? 1 : Math.max(1, Math.ceil(rows.data.total / Math.max(1, rows.data.page_size)))

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link className={styles.crumb} to={routes.adminLearningCourses}>
          By course
        </Link>
        <Icon name="chevron-right" size={14} aria-hidden="true" />
        <span className={styles.current} aria-current="page">
          {figures.course.title}
        </span>
      </nav>

      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{figures.course.title}</h1>
          <p className={styles.subtitle}>
            {`${figures.total_modules} modules · ${figures.total_video_lessons} video lessons · only video lessons count toward progress.`}
          </p>
        </div>
        <LinkButton to={routes.adminCourse(figures.course.id)} variant="secondary" iconLeft="edit">
          Edit course
        </LinkButton>
      </header>
      <div className={styles.rule} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>

      <Stats>
        <Stat label="Members" value={counts.all} caption="can access it" />
        <Stat
          label="Started"
          value={counts.started}
          caption={counts.all === 0 ? undefined : `${formatPercent((counts.started / counts.all) * 100)} of members`}
        />
        <Stat label="In progress" value={counts.in_progress} caption="not finished yet" />
        <Stat label="Completed" value={counts.completed} caption="all video lessons done" />
        <Stat
          label="Average progress"
          value={formatPercent(figures.average_progress_percent)}
          caption="of members who started"
        />
        <Stat
          label="Completion rate"
          value={formatPercent(figures.completion_rate_percent)}
          caption="completed ÷ started"
        />
      </Stats>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="course-split">
          <h2 id="course-split" className={styles.panelTitle}>
            {`Status of the ${counts.all} members`}
          </h2>
          <StatusSplit
            counts={counts}
            label={`${counts.completed} completed, ${counts.in_progress} in progress, ${counts.not_started} not started`}
          />
          <p className={styles.panelCaption}>
            {`Completion rate ${formatPercent(figures.completion_rate_percent)} = ${counts.completed} completed ÷ ${counts.started} started`}
          </p>
        </section>

        <section className={styles.panel} aria-labelledby="course-recent">
          <h2 id="course-recent" className={styles.panelTitle}>
            Using it now or recently
          </h2>
          {recent.status !== 'ready' || recent.data === null ? (
            <p className={styles.panelCaption}>Loading…</p>
          ) : recent.data.items.filter((row) => row.last_activity_at !== null).length === 0 ? (
            <p className={styles.panelCaption}>No recorded activity in this course yet.</p>
          ) : (
            <ul className={styles.events}>
              {recent.data.items
                .filter((row) => row.last_activity_at !== null)
                .map((row) => (
                  <li key={row.member.id} className={styles.event}>
                    <MemberCell
                      member={row.member}
                      caption={`${formatPercent(row.progress_percent)} of the course`}
                    />
                    <span className={styles.exact}>
                      {relativeTime(row.last_activity_at ?? '', now)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="course-members" className={styles.page}>
        <h2 id="course-members" className={styles.panelTitle}>
          All members
        </h2>

        <div className={styles.filters}>
          <TextField
            label="Search member"
            hideLabel
            placeholder="Name or email"
            iconLeft="search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className={styles.search}
          />
          <Select
            label="Status"
            hideLabel
            className={styles.filter}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'NOT_STARTED', label: 'Not started' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'COMPLETED', label: 'Completed' },
            ]}
            value={status ?? 'all'}
            onChange={(event) =>
              setParam('status', event.target.value === 'all' ? null : event.target.value)
            }
          />
          <Select
            label="Sort by"
            hideLabel
            className={styles.filter}
            options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            value={sort}
            onChange={(event) => setParam('sort', event.target.value)}
          />
        </div>

        {rows.status === 'loading' ? (
          <SkeletonGroup label="Loading members" className={styles.skeleton}>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} variant="block" height={64} />
            ))}
          </SkeletonGroup>
        ) : rows.status === 'error' || rows.data === null ? (
          <MessagePage
            headingLevel={3}
            icon="wifi-off"
            title="We couldn’t load the members"
            body="Something went wrong while contacting the server."
            action={
              <Button iconLeft="refresh" onClick={rows.reload}>
                Try again
              </Button>
            }
          />
        ) : rows.data.items.length === 0 ? (
          <MessagePage
            headingLevel={3}
            icon="search"
            tone="neutral"
            title="No member matches these filters"
            body="Try another status, or clear the search."
          />
        ) : (
          <>
            <p className={styles.count} aria-live="polite">
              {`${rows.data.total} members · ${rows.data.items.length} shown`}
            </p>
            {phone ? (
              <ProgressCards rows={rows.data.items} courseCount={1} />
            ) : (
              <ProgressRows rows={rows.data.items} now={now} />
            )}
            <CoursePagination
              page={rows.data.page}
              pageCount={pageCount}
              label="Member pages"
              onChange={(next) => setParam('page', next <= 1 ? null : String(next))}
            />
          </>
        )}
      </section>
    </div>
  )
}
