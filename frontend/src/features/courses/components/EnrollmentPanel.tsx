import { Link } from 'react-router-dom'

import { routes } from '../../../app/routes'
import { Button, buttonClassName, Icon, Progress } from '../../../design-system'
import type { UUID } from '../../../api'
import type { EnrollStatus, EnrollmentState } from '../useCourseDetails'

import styles from './EnrollmentPanel.module.css'

export interface EnrollmentPanelProps {
  courseId: UUID
  courseTitle: string
  enrollment: EnrollmentState
  enrollStatus: EnrollStatus
  onEnroll: () => void
  onRetry: () => void
  /**
   * Where "Continue" / "Review course" goes: the first unfinished video, or the
   * first video of a finished course. `null` when the course holds no video.
   */
  resumeLessonId: UUID | null
  resumeLessonTitle: string | null
}

/**
 * The enrollment call to action (Course-Details-New / -Enrolled / -States).
 *
 * Which state is shown is decided entirely by what the backend said: enrolled
 * or not comes from `GET /courses/{id}/content`, and the progress figures are
 * the server's own aggregate. Nothing here recomputes completion.
 */
export function EnrollmentPanel({
  courseId,
  courseTitle,
  enrollment,
  enrollStatus,
  onEnroll,
  onRetry,
  resumeLessonId,
  resumeLessonTitle,
}: EnrollmentPanelProps) {
  if (enrollment.kind === 'unknown') {
    return (
      <aside className={styles.panel} aria-label="Enrollment">
        <p className={styles.headline}>Unable to determine enrollment status</p>
        <p className={styles.help}>
          We couldn’t check whether you are enrolled in this course, so the action is hidden until
          we can.
        </p>
        <Button variant="secondary" iconLeft="refresh" onClick={onRetry}>
          Try again
        </Button>
      </aside>
    )
  }

  if (enrollment.kind === 'enrolled') {
    const label = enrollment.completed ? 'Review course' : 'Continue'

    return (
      <aside className={styles.panel} aria-label="Your progress">
        <Progress
          value={enrollment.progressPercent}
          size={10}
          label={`${courseTitle} progress`}
          headerLabel="Your progress"
          showHeader
          caption={`${enrollment.completedVideoLessons} of ${enrollment.totalVideoLessons} videos completed`}
        />

        {resumeLessonId === null ? (
          <p className={styles.help}>
            {enrollment.totalVideoLessons === 0
              ? 'This course has no video lesson yet.'
              : 'You have finished every video in this course.'}
          </p>
        ) : (
          <Link
            to={routes.lesson(courseId, resumeLessonId)}
            className={[buttonClassName({ variant: 'primary', size: 'lg' }), styles.cta].join(' ')}
          >
            <Icon name="play" size={18} />
            <span>
              {label}
              {!enrollment.completed && resumeLessonTitle !== null ? `: ${resumeLessonTitle}` : ''}
            </span>
          </Link>
        )}
      </aside>
    )
  }

  const enrolling = enrollStatus === 'enrolling'

  return (
    <aside className={styles.panel} aria-label="Enrollment">
      {/* The backend's own refusals are translated into the design's copy; the
          server's `detail` string is never rendered. */}
      {enrollStatus === 'failed' ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>We couldn’t enroll you in this course</p>
          <p className={styles.errorBody}>Something went wrong. Try again in a moment.</p>
        </div>
      ) : null}

      {enrollStatus === 'conflict' ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>This course isn’t open for enrollment</p>
          <p className={styles.errorBody}>
            It may have just been archived. Browse the catalogue to find another course.
          </p>
        </div>
      ) : null}

      <Button
        size="lg"
        fullWidth
        iconLeft="plus"
        onClick={onEnroll}
        // DS 05: the label takes its progressive form, the button reports
        // `aria-busy` and activation is blocked while the request is in flight.
        loading={enrolling}
        loadingLabel="Enrolling…"
      >
        Enroll in this course
      </Button>

      <p className={styles.help}>Enroll to open the lessons and track your progress.</p>

      {enrollStatus === 'failed' || enrollStatus === 'conflict' ? (
        <Link to={routes.courses} className={styles.back}>
          Back to courses
        </Link>
      ) : null}
    </aside>
  )
}
