import { Link } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Button, buttonClassName, Icon, Skeleton, SkeletonGroup } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { useAuth } from '../auth'

import { CourseGrid } from '../courses/components/CourseGrid'

import { ContinueCard } from './components/ContinueCard'
import { DashboardSection } from './components/DashboardSection'
import styles from './DashboardPage.module.css'
import { useDashboard } from './useDashboard'

function WelcomeHeader({ firstName }: { firstName: string }) {
  return (
    <header className={styles.welcome}>
      <h1 className={styles.title}>Welcome back, {firstName}</h1>
      <p className={styles.lede}>Pick up where you left off, or find something new to learn.</p>
      <div className={styles.rule} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>
    </header>
  )
}

/** Keeps the final layout so nothing jumps when the data lands (DS 06). */
function DashboardSkeleton() {
  return (
    <SkeletonGroup label="Loading your courses" className={styles.skeleton}>
      <Skeleton variant="block" height={236} />
      <div className={styles.skeletonRow}>
        <Skeleton variant="text" width={40} height={28} />
        <Skeleton variant="text" width={180} height={28} />
      </div>
      <div className={styles.skeletonGrid}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} variant="block" height={420} />
        ))}
      </div>
    </SkeletonGroup>
  )
}

/**
 * The member dashboard.
 *
 * Every value on screen comes from the backend or from the FE-02 session. The
 * name is the authenticated user's, the lists are this member's enrollments and
 * the published catalogue, and the percentages are the server's own
 * `progress_percent` - React never recomputes progress.
 *
 * The per-card "N modules · M videos" and "X of Y videos completed" lines
 * (G05) are the backend's own figures from `/me/enrollments` and `/courses`
 * (BE-COURSE-CATALOG-01), drawn by the shared `CourseCard` - still one request
 * per list, never one per card.
 */
export function DashboardPage() {
  const { user } = useAuth()
  const { status, data, reload } = useDashboard()

  // The route is behind RequireAuth, so a missing user here is unreachable in
  // practice; the guard keeps the component honest rather than asserting.
  const firstName = user?.first_name ?? ''

  if (status === 'loading') {
    return (
      <div className={styles.page}>
        <WelcomeHeader firstName={firstName} />
        <DashboardSkeleton />
      </div>
    )
  }

  if (status === 'error' || data === null) {
    return (
      <div className={styles.page}>
        <WelcomeHeader firstName={firstName} />
        <div className={styles.stateCard}>
          <MessagePage
            headingLevel={2}
            icon="wifi-off"
            title="We couldn’t load your courses"
            body="Something went wrong while contacting the server. Check your connection and try again."
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

  const hasEnrollments = data.inProgress.length > 0 || data.completed.length > 0

  return (
    <div className={styles.page}>
      <WelcomeHeader firstName={firstName} />

      {/* No enrollment: the empty state replaces the Continue card entirely,
          and the lists below are hidden rather than shown empty. */}
      {hasEnrollments ? null : (
        <div className={styles.stateCard}>
          <MessagePage
            headingLevel={2}
            icon="book"
            tone="neutral"
            title="You haven’t started a course yet"
            body="Browse the courses published by the association and start learning at your own pace."
            action={
              // A router Link, not Button's plain anchor: this is in-app
              // navigation and must not reload the document.
              <Link to={routes.courses} className={buttonClassName()}>
                <span>Browse courses</span>
                <Icon name="arrow-right" size={18} />
              </Link>
            }
          />
        </div>
      )}

      {data.continueTarget === null ? null : (
        <div className={styles.continue}>
          <ContinueCard target={data.continueTarget} />
        </div>
      )}

      {/* Lists with no items are hidden: the board asks for no empty sections. */}
      {data.inProgress.length > 0 ? (
        <DashboardSection index="01" title="In progress">
          <CourseGrid courses={data.inProgress} label="Courses in progress" />
        </DashboardSection>
      ) : null}

      {data.completed.length > 0 ? (
        <DashboardSection index="02" title="Completed">
          <CourseGrid courses={data.completed} label="Completed courses" />
        </DashboardSection>
      ) : null}

      {data.available.length > 0 ? (
        <DashboardSection
          index="03"
          title="Available courses"
          action={
            <Link to={routes.courses} className={styles.sectionLink}>
              <span>Browse all courses</span>
              <Icon name="arrow-right" size={18} />
            </Link>
          }
        >
          <CourseGrid courses={data.available} label="Available courses" />
        </DashboardSection>
      ) : null}

      {/* The catalogue is the only optional request: when it fails the enrolled
          lists are still correct, so the page says what is missing and offers a
          retry instead of failing whole. */}
      {data.catalogUnavailable ? (
        <p className={styles.sectionError} role="status">
          <Icon name="alert" size={18} className={styles.sectionErrorIcon} />
          <span>We couldn’t load the available courses.</span>
          <Button variant="tertiary" size="sm" onClick={reload}>
            Try again
          </Button>
        </p>
      ) : null}
    </div>
  )
}
