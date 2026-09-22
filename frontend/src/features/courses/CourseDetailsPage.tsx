import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Button, Icon, Skeleton, SkeletonGroup } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { ServerErrorPage } from '../../pages/ServerErrorPage'

import { CourseHero } from './components/CourseHero'
import { CourseOutline } from './components/CourseOutline'
import { EnrollmentPanel } from './components/EnrollmentPanel'
import type { CourseOutline as CourseOutlineModel } from './courseDetails'
import { LinkButton } from '../../app/LinkButton'
import styles from './CourseDetailsPage.module.css'
import { useCourseDetails } from './useCourseDetails'
import { useLearningEventOnOpen } from './useLearningEvents'

/** Keeps the page's shape while it loads, so nothing jumps (DS 06). */
function DetailsSkeleton() {
  return (
    <SkeletonGroup label="Loading course" className={styles.skeleton}>
      <Skeleton variant="block" height={260} />
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="text" width="90%" />
      <Skeleton variant="block" height={140} />
      <Skeleton variant="block" height={180} />
    </SkeletonGroup>
  )
}

/** The first video of the course, for a member who has finished every one. */
function firstVideoLessonId(outline: CourseOutlineModel | null): string | null {
  for (const module of outline?.modules ?? []) {
    for (const lesson of module.lessons) {
      if (lesson.contentType === 'VIDEO') return lesson.id
    }
  }
  return null
}

/**
 * The member course details page (`/courses/:courseId`).
 *
 * Everything shown is backend data. The counts under the title are counted from
 * the outline the server returned; the progress figures are the server's own
 * aggregate; enrollment is whatever `GET /courses/{id}/content` answered. The
 * page decides nothing about visibility or eligibility - 404 and 409 come from
 * FastAPI and are rendered, never second-guessed.
 */
export function CourseDetailsPage() {
  const { courseId = '' } = useParams<{ courseId: string }>()
  const { status, data, reload, enroll, enrollStatus } = useCourseDetails(courseId)
  // Tracking-Logic: "Course opened - the member opens the course details page".
  // Only for an enrolled member: before that the page is the catalogue's
  // preview, which the backend does not track (it answers 404). Enrolling here
  // leads straight to the first lesson, whose page opens the course itself, so
  // this page records it only when it stays - a course with no lesson yet.
  const [enrolledHere, setEnrolledHere] = useState(false)
  const leadsToLesson = data?.outline?.modules.some((module) => module.lessons.length > 0) ?? false
  useLearningEventOnOpen(
    status === 'ready' && data?.enrollment.kind === 'enrolled' && !(enrolledHere && leadsToLesson)
      ? { type: 'course_opened', courseId: data.header.courseId }
      : null,
  )

  if (status === 'loading') {
    return (
      <div className={styles.page}>
        <DetailsSkeleton />
      </div>
    )
  }

  if (status === 'not-found') {
    // The backend answers 404 for a missing course, a DRAFT one and an ARCHIVED
    // one alike, so this is the single state the design draws for all three.
    return (
      <div className={styles.page}>
        <MessagePage
          icon="book"
          tone="neutral"
          title="This course isn’t available"
          body="It may have been archived or the link may be incorrect. Browse the catalogue to find another course."
          action={
            <LinkButton to={routes.courses} iconLeft="arrow-left">
              Browse courses
            </LinkButton>
          }
        />
      </div>
    )
  }

  if (status === 'error' || data === null) {
    return (
      <div className={styles.page}>
        <ServerErrorPage onRetry={reload} />
      </div>
    )
  }

  const { header, enrollment, outline } = data
  const enrolled = enrollment.kind === 'enrolled'
  const continueLesson = enrolled ? enrollment.continueLesson : null
  const resumeLessonId = enrolled
    ? (continueLesson?.id ?? firstVideoLessonId(outline))
    : null

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link to={routes.courses} className={styles.crumbLink}>
          Courses
        </Link>
        <Icon name="chevron-right" size={16} className={styles.crumbSeparator} />
        <span aria-current="page" className={styles.crumbCurrent}>
          {header.title}
        </span>
      </nav>

      <CourseHero header={header} enrollment={enrollment} outline={outline} />

      <EnrollmentPanel
        courseId={header.courseId}
        courseTitle={header.title}
        enrollment={enrollment}
        enrollStatus={enrollStatus}
        onEnroll={() => {
          setEnrolledHere(true)
          enroll()
        }}
        onRetry={reload}
        resumeLessonId={resumeLessonId}
        resumeLessonTitle={continueLesson?.title ?? null}
      />

      {/* Enrollment unknown means the outline is unknown too - it is the same
          request. Showing an empty "Course content" section would suggest the
          course has none, so the section waits until the retry succeeds. */}
      {enrollment.kind === 'unknown' ? null : (
      <section className={styles.content} aria-labelledby="course-content-heading">
        <div className={styles.contentHead}>
          <h2 id="course-content-heading" className={styles.contentTitle}>
            Course content
          </h2>
          {outline === null ? null : (
            <p className={styles.contentMeta}>
              {`${outline.moduleCount} ${outline.moduleCount === 1 ? 'module' : 'modules'} · ${outline.lessonCount} ${outline.lessonCount === 1 ? 'lesson' : 'lessons'}`}
            </p>
          )}
        </div>

        {enrollment.kind === 'not-enrolled' && outline !== null ? (
          <p className={styles.lockNote}>
            <Icon name="lock" size={18} className={styles.lockIcon} />
            <span>
              <strong>Lessons open once you are enrolled.</strong> You can see the whole outline
              now. Enroll to watch the videos and follow your progress.
            </span>
          </p>
        ) : null}

        {outline === null ? (
          // The outline is a separate read; when it fails the course, its state
          // and its action are still correct, so only this section degrades.
          <p className={styles.outlineUnavailable} role="status">
            <span>We couldn’t load the course outline.</span>
            <Button variant="tertiary" size="sm" onClick={reload}>
              Try again
            </Button>
          </p>
        ) : outline.modules.length === 0 ? (
          <p className={styles.outlineUnavailable}>
            <span>This course has no module yet.</span>
          </p>
        ) : (
          <CourseOutline
            outline={outline}
            courseId={courseId}
            currentLessonId={continueLesson?.id ?? null}
            showProgress={enrolled}
            // Only an enrolled member can read the learning page; before that
            // the rows stay inert, as the banner above already explains.
            navigable={enrolled}
          />
        )}
      </section>
      )}
    </div>
  )
}
