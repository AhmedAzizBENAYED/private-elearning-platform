import type { CourseStatus } from '../../../api'
import { Badge, Button, Icon } from '../../../design-system'
import type { AdminCourse } from '../api'
import { nextTransition, type CourseTransition } from '../courseModel'
import { formatDate } from '../model'

import styles from './CourseEditorCards.module.css'

/** The lifecycle, in the order the board's stepper draws it. */
const STEPS: readonly CourseStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

const STATUS_COPY: Record<CourseStatus, string> = {
  DRAFT: 'Draft courses are not visible to members. Publishing makes the course available in the catalogue.',
  PUBLISHED:
    'This course is in the catalogue and members can enroll. Archiving is the last step; it cannot be undone.',
  ARCHIVED: 'This course is archived. It can no longer be published or edited.',
}

function Stepper({ status }: { status: CourseStatus }) {
  const current = STEPS.indexOf(status)
  return (
    <ol className={styles.stepper} aria-label="Course lifecycle">
      {STEPS.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming'
        return (
          <li key={step} className={styles.step} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className={styles.stepDot} aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={16} /> : state === 'current' ? <span className={styles.stepPip} /> : null}
            </span>
            <span className={styles.stepLabel}>{step}</span>
          </li>
        )
      })}
    </ol>
  )
}

function DateItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.dateItem}>
      <dt className={styles.dateLabel}>{label}</dt>
      <dd className={styles.dateValue}>
        <time dateTime={value}>{formatDate(value)}</time>
      </dd>
    </div>
  )
}

/**
 * The editor's Status card (Admin-Course-Editor): the badge, the
 * DRAFT → PUBLISHED → ARCHIVED stepper, what the status means, the one
 * transition the lifecycle allows next, and the course's dates.
 *
 * The transition is only asked for here; the page confirms it in its dialog.
 */
export function CourseStatusCard({
  course,
  onTransition,
}: {
  course: AdminCourse
  onTransition: (to: CourseTransition) => void
}) {
  const transition = nextTransition(course.status)

  return (
    <section className={styles.card} aria-labelledby="course-status">
      <div className={styles.cardHead}>
        <h2 id="course-status" className={styles.cardTitle}>
          Status
        </h2>
        <Badge kind="course-status" value={course.status} />
      </div>

      <Stepper status={course.status} />

      <p className={styles.body}>{STATUS_COPY[course.status]}</p>

      {transition === null ? null : (
        <Button
          fullWidth
          variant={transition === 'archive' ? 'danger-outline' : 'primary'}
          iconLeft={transition === 'archive' ? 'archive' : 'check-circle'}
          onClick={() => onTransition(transition)}
        >
          {transition === 'archive' ? 'Archive course' : 'Publish course'}
        </Button>
      )}

      <dl className={styles.dates}>
        <DateItem label="Created" value={course.created_at} />
        <DateItem label="Last modified" value={course.updated_at} />
        {course.published_at === null ? null : <DateItem label="Published" value={course.published_at} />}
        {course.archived_at === null ? null : <DateItem label="Archived" value={course.archived_at} />}
      </dl>
    </section>
  )
}
