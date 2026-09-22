import { Link } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Button, Icon, Skeleton, SkeletonGroup, type IconName } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'

import { LinkButton } from '../../app/LinkButton'
import styles from './AdminDashboardPage.module.css'
import { RecentCoursesTable } from './components/RecentCoursesTable'
import type { AddMemberIntent } from './memberEditState'
import { useAdminOverview } from './useAdminOverview'
import { RECENT_COURSE_COUNT, useRecentCourses } from './useRecentCourses'

interface StatCard {
  label: string
  value: number
  icon: IconName
  to: string
  action: string
}

/**
 * "Recently created courses" (Admin-Dashboard).
 *
 * The heading and the "All courses" link sit on one line above the card, as
 * drawn. Both navigate through the route helpers, so there is one definition
 * of where a course lives.
 *
 * While loading, the card is replaced by blocks of the row height rather than
 * by placeholder courses: an empty table of invented titles would read as data.
 */
function RecentCourses() {
  const { status, courses, reload } = useRecentCourses()

  return (
    <section className={styles.recent} aria-labelledby="admin-recent">
      <div className={styles.recentHead}>
        <h2 id="admin-recent" className={styles.recentTitle}>
          Recently created courses
        </h2>
        <LinkButton variant="tertiary" to={routes.adminCourses} iconRight="arrow-right">
          All courses
        </LinkButton>
      </div>

      {status === 'loading' ? (
        <SkeletonGroup label="Loading recently created courses" className={styles.recentSkeleton}>
          {Array.from({ length: RECENT_COURSE_COUNT }, (_, index) => (
            <Skeleton key={index} variant="block" height={68} />
          ))}
        </SkeletonGroup>
      ) : status === 'error' ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>We couldn’t load the recent courses</p>
          <p className={styles.errorBody}>
            The list could not be read from the server. The figures above still work.
          </p>
          <Button iconLeft="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : courses.length === 0 ? (
        // The project's empty state, at level 3: the page owns the <h1> and
        // this section owns the <h2> above it.
        <MessagePage
          headingLevel={3}
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
      ) : (
        <RecentCoursesTable courses={courses} />
      )}
    </section>
  )
}


/**
 * The administration landing page (Admin-Dashboard).
 *
 * The four figures are real: each is a `Page.total` the backend computed for a
 * query it already supports. There is no statistics endpoint in this API, so
 * nothing beyond those counts is shown - no completion rate, activity figure or
 * trend is invented to fill the space.
 *
 * "Recently created courses" is the same listing endpoint asked for its first
 * page newest-first, so the five rows are the database's five newest and each
 * arrives with the counts already computed. The two halves of the board load
 * and fail independently: a table that cannot be read leaves the figures above
 * it standing.
 *
 * The board is these two sections and nothing else, as the design draws it.
 */
export function AdminDashboardPage() {
  const { status, counts, reload } = useAdminOverview()

  const cards: StatCard[] =
    counts === null
      ? []
      : [
          {
            label: 'Members',
            value: counts.members,
            icon: 'users',
            to: routes.adminMembers,
            action: 'Manage members',
          },
          {
            label: 'Courses',
            value: counts.courses,
            icon: 'book',
            to: routes.adminCourses,
            action: 'Manage courses',
          },
          {
            label: 'Published',
            value: counts.published,
            icon: 'check-circle',
            // The course list's own status filter, read by the server.
            to: `${routes.adminCourses}?status=PUBLISHED`,
            action: 'View published',
          },
          {
            label: 'Drafts',
            value: counts.drafts,
            icon: 'edit',
            to: `${routes.adminCourses}?status=DRAFT`,
            action: 'View drafts',
          },
        ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Overview of the members and courses of the platform.</p>
        </div>
        {/* Admin-Dashboard's two header actions, into the existing flows: the
            member list with its Add member dialog open, and the course form. */}
        <div className={styles.headActions}>
          <LinkButton
            to={routes.adminMembers}
            state={{ addMember: true } satisfies AddMemberIntent}
            variant="secondary"
            iconLeft="plus"
          >
            Add member
          </LinkButton>
          <LinkButton to={routes.adminCourseNew} iconLeft="plus">
            Create course
          </LinkButton>
        </div>
      </header>

      {status === 'loading' ? (
        <SkeletonGroup label="Loading overview" className={styles.grid}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="block" height={148} />
          ))}
        </SkeletonGroup>
      ) : status === 'error' ? (
        // All four figures or none: two numbers beside two dashes would read as
        // data rather than as a failure.
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>We couldn’t load the overview</p>
          <p className={styles.errorBody}>
            The figures could not be read from the server. The sections below still work.
          </p>
          <Button iconLeft="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <div className={styles.grid}>
          {cards.map((card) => (
            <Link
              key={card.label}
              to={card.to}
              className={styles.card}
              // The parts are laid out as separate inline spans, which the name
              // computation would run together ("Members48Manage members").
              aria-label={`${card.label}: ${card.value}. ${card.action}`}
            >
              <span className={styles.cardGlyph} aria-hidden="true">
                <Icon name={card.icon} size={20} />
              </span>
              <span className={styles.cardLabel}>{card.label}</span>
              <span className={styles.cardValue}>{card.value}</span>
              <span className={styles.cardAction}>
                {card.action}
                <Icon name="arrow-right" size={16} />
              </span>
            </Link>
          ))}
        </div>
      )}

      <RecentCourses />
    </div>
  )
}
