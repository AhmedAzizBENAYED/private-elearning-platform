import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button, Skeleton, SkeletonGroup } from '../../../design-system'
import { MessagePage } from '../../../pages/MessagePage'
import { CoursePagination } from '../../courses/components/CoursePagination'

import { LearningShell } from './components/LearningShell'
import { Stat, Stats, StatusSplit } from './components/Figures'
import styles from './Learning.module.css'
import { formatPercent, parsePage } from './model'
import { routes } from '../../../app/routes'
import { useCourseFigures } from './useLearning'
import { usePublishedCourses } from './usePublishedCourses'

/** Courses per page. Each one costs its own figures request; see the hook. */
const PAGE_SIZE = 10

/**
 * Learning progress · by course (Admin-Progress-Courses).
 *
 * One row per published course, with the figures `GET /admin/courses/{id}/
 * learning` returns for it. There is no listing of those figures, so a page of
 * ten courses is ten requests plus the catalogue - bounded by the page, made
 * once per page. Reported as a gap.
 *
 * The header cards say what they cover: the two totals are the backend's, and
 * the two sums are over the courses on this page, which is what they are.
 */
export function LearningCoursesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams.get('page'))

  const courses = usePublishedCourses(page, PAGE_SIZE)
  const ids = useMemo(() => (courses.data ?? []).map((course) => course.id), [courses.data])
  const figures = useCourseFigures(ids)

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

  const rows = courses.data ?? []
  const summaries = ids.map((id) => figures.summaries[id]).filter((summary) => summary !== undefined)
  const pageCount = Math.max(1, Math.ceil(courses.total / PAGE_SIZE))

  const members = summaries[0]?.counts.all ?? null
  const started = summaries.reduce((total, summary) => total + summary.counts.started, 0)
  const completed = summaries.reduce((total, summary) => total + summary.counts.completed, 0)

  const loading = courses.status === 'loading' || (ids.length > 0 && figures.status === 'loading')
  const failed = courses.status === 'error' || figures.status === 'error'

  return (
    <LearningShell lede="Open a course to see who is using it and how far they have come.">
      {loading || failed ? null : (
        <Stats>
          <Stat label="Published courses" value={courses.total} caption="learners see these" />
          <Stat label="Members" value={members ?? '—'} caption="can access them" />
          <Stat label="Course starts" value={started} caption="across the courses shown" />
          <Stat label="Completed" value={completed} caption="across the courses shown" />
        </Stats>
      )}

      {loading ? (
        <SkeletonGroup label="Loading courses" className={styles.skeleton}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="block" height={72} />
          ))}
        </SkeletonGroup>
      ) : failed ? (
        <MessagePage
          headingLevel={2}
          icon="wifi-off"
          title="We couldn’t load the course figures"
          body="Something went wrong while contacting the server."
          action={
            <Button
              iconLeft="refresh"
              onClick={() => {
                courses.reload()
                figures.reload()
              }}
            >
              Try again
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <MessagePage
          headingLevel={2}
          icon="book"
          tone="neutral"
          title="No published course yet"
          body="Publish a course and members will be able to start it; their progress appears here."
        />
      ) : (
        <>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Started</th>
                  <th scope="col">Status split</th>
                  <th scope="col">Avg progress</th>
                  <th scope="col">Completion</th>
                  <th scope="col">
                    <span className={styles.hiddenLabel}>Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((course) => {
                  const summary = figures.summaries[course.id]
                  if (summary === undefined) return null

                  return (
                    <tr key={course.id}>
                      <th scope="row">
                        <span className={styles.memberText}>
                          <Link
                            className={styles.courseLink}
                            to={routes.adminLearningCourse(course.id)}
                          >
                            {course.title}
                          </Link>
                          <span className={styles.memberCaption}>
                            {`${summary.total_modules} modules · ${summary.total_video_lessons} video lessons`}
                          </span>
                        </span>
                      </th>
                      <td>
                        <span className={styles.memberText}>
                          <span className={styles.percent}>
                            {`${summary.counts.started} of ${summary.counts.all}`}
                          </span>
                          <span className={styles.memberCaption}>
                            {summary.counts.all === 0
                              ? '—'
                              : formatPercent((summary.counts.started / summary.counts.all) * 100)}
                          </span>
                        </span>
                      </td>
                      <td>
                        <StatusSplit
                          counts={summary.counts}
                          label={`${summary.counts.completed} completed, ${summary.counts.in_progress} in progress, ${summary.counts.not_started} not started`}
                        />
                      </td>
                      <td>{formatPercent(summary.average_progress_percent)}</td>
                      <td>{formatPercent(summary.completion_rate_percent)}</td>
                      <td>
                        <Link
                          className={styles.courseLink}
                          to={routes.adminLearningCourse(course.id)}
                        >
                          {`Open ${course.title}`}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className={styles.showing}>
            {`Showing ${rows.length} of ${courses.total} published courses`}
          </p>

          <CoursePagination
            page={page}
            pageCount={pageCount}
            label="Course pages"
            onChange={goToPage}
          />
        </>
      )}
    </LearningShell>
  )
}
