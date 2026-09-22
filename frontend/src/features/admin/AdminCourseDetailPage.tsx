import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Badge, Button, ConfirmDialog, Icon, Skeleton, SkeletonGroup, Toast } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import profile from '../profile/Profile.module.css'

import { CourseInformationCard } from './components/CourseInformationCard'
import { CourseStatusCard } from './components/CourseStatusCard'
import { CourseStructure, type StructureNotice } from './components/CourseStructure'
import { type CourseTransition } from './courseModel'
import { isLessonNotice } from './structureModel'
import { useCourseStructure } from './useCourseStructure'
import { useAdminCourse, type CourseWriteFailure } from './useAdminCourse'
import { LinkButton } from '../../app/LinkButton'
import styles from './AdminCourseDetailPage.module.css'

const CONFIRM: Record<CourseTransition, { title: (t: string) => string; body: string; label: string }> = {
  publish: {
    title: (title) => `Publish “${title}”?`,
    body: 'Members will see this course in the catalogue and will be able to enroll. Make sure the modules and lessons are ready.',
    label: 'Publish course',
  },
  archive: {
    title: (title) => `Archive “${title}”?`,
    body: 'Archiving is the last step of a course’s life. It can’t be published again, and it can no longer be edited.',
    label: 'Archive course',
  },
}

const WRITE_ERROR: Record<CourseWriteFailure, string> = {
  lifecycle: 'The course is no longer in a state that allows this change. Reload the page.',
  'not-draft': 'Only draft courses can be edited.',
  'slug-taken': 'Another course already uses that address.',
  invalid: 'The change was rejected as invalid.',
  'not-found': 'This course no longer exists.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  unavailable: 'The change could not be saved. Check your connection and try again.',
}

/**
 * The course editor (`/admin/courses/:courseId`, Admin-Course-Editor).
 *
 * Two columns from 1024px, as the board draws them: the course structure, and
 * beside it the Status card (stepper, the one transition allowed next, the
 * dates) and the Course information card (the draft's title, description and
 * thumbnail, saved in place). Below 1024px the columns stack in the same order.
 *
 * There is no delete action because the API has no `DELETE` for a course.
 */
export function AdminCourseDetailPage() {
  const { courseId = '' } = useParams<{ courseId: string }>()
  const { status, course, failure, saving, reload, save, transition, uploadThumbnail } = useAdminCourse(courseId)
  const structure = useCourseStructure(courseId)
  const [pending, setPending] = useState<CourseTransition | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  // One confirmation at a time, from the information card, the structure, or
  // the lesson editor this page was returned to. Successes and failures keep
  // separate live regions: `status` for the one, `alert` for the other.
  const [notice, setNotice] = useState<StructureNotice | null>(() =>
    isLessonNotice(location.state)
      ? { kind: 'success', ...location.state.lessonNotice }
      : null,
  )
  useEffect(() => {
    if (isLessonNotice(location.state)) {
      navigate({ pathname: location.pathname, hash: location.hash }, { replace: true, state: null })
    }
  }, [location, navigate])
  // Kept as a flag rather than a notice: the toast names the course as it is
  // after the save, which is only known once the page has re-rendered with it.
  const [infoSaved, setInfoSaved] = useState(false)
  const showNotice = useCallback((next: StructureNotice) => {
    setInfoSaved(false)
    setNotice(next)
  }, [])
  const dismissNotice = useCallback(() => {
    setInfoSaved(false)
    setNotice(null)
  }, [])

  const confirm = useCallback(() => {
    if (pending === null) return
    void transition(pending).then((result) => {
      if (result.ok) {
        // Admin-Courses-States: "Course published", named after the course.
        // No toast is drawn for an archive; the stepper and badge say it.
        if (pending === 'publish') {
          showNotice({
            kind: 'success',
            title: 'Course published',
            body: `“${course?.title ?? ''}” is now visible to members.`,
          })
        }
        setPending(null)
        setWriteError(null)
        return
      }
      // The dialog stays open with the reason beneath, so the administrator is
      // not left guessing whether the change landed.
      setWriteError(WRITE_ERROR[result.failure ?? 'unavailable'])
    })
  }, [pending, transition, showNotice, course])

  if (status === 'loading') {
    return (
      <SkeletonGroup label="Loading course" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={320} />
      </SkeletonGroup>
    )
  }

  if (status === 'error' || course === null) {
    return (
      <MessagePage
        icon={failure === 'forbidden' ? 'lock' : failure === 'not-found' ? 'alert' : 'wifi-off'}
        tone={failure === 'not-found' ? 'neutral' : undefined}
        title={
          failure === 'not-found'
            ? 'Course not found'
            : failure === 'forbidden'
              ? 'Access denied'
              : 'We couldn’t load this course'
        }
        body={
          failure === 'not-found'
            ? 'This course no longer exists, or the link is incorrect.'
            : failure === 'forbidden'
              ? 'Your administrator access may have changed. Sign in again.'
              : 'Something went wrong while contacting the server.'
        }
        action={
          failure === 'not-found' ? (
            <LinkButton to={routes.adminCourses} variant="secondary" iconLeft="arrow-left">
              Back to courses
            </LinkButton>
          ) : (
            <Button iconLeft="refresh" onClick={reload}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  const copy = pending === null ? null : CONFIRM[pending]

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link className={styles.crumb} to={routes.adminCourses}>
          Courses
        </Link>
        <Icon name="chevron-right" size={16} className={styles.separator} />
        <span className={styles.current} aria-current="page">
          {course.title}
        </span>
      </nav>

      <div>
        <header className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>{course.title}</h1>
            <p className={styles.subtitle}>Course editor · build the structure, then publish.</p>
          </div>
          <Badge kind="course-status" value={course.status} />
        </header>
        <div className={profile.rule} aria-hidden="true">
          <div className={profile.ruleAccent} />
          <div className={profile.ruleMuted} />
        </div>
      </div>

      {writeError === null || pending !== null ? null : (
        <p className={styles.error} role="alert">
          {writeError}
        </p>
      )}

      <div className={styles.layout}>
        <section className={styles.structure} aria-labelledby="course-structure">
          <h2 id="course-structure" className={styles.sectionTitle}>
            Course structure
          </h2>
          {/* Structural writes are draft-only: every one of them answers 409
              "Only DRAFT courses can be edited" once the course is published. */}
          <CourseStructure
            courseId={courseId}
            status={structure.status}
            modules={structure.modules}
            editable={course.status === 'DRAFT'}
            resources={structure.resources}
            resourcesFailed={structure.resourcesFailed}
            update={structure.update}
            reload={structure.reload}
            onNotice={showNotice}
          />
        </section>

        <div className={styles.side}>
          <CourseStatusCard
            course={course}
            onTransition={(to) => {
              setWriteError(null)
              setPending(to)
            }}
          />
          <CourseInformationCard
            course={course}
            save={save}
            uploadThumbnail={uploadThumbnail}
            onUploaded={() =>
              showNotice({ kind: 'success', title: 'Thumbnail uploaded', body: `“${course.title}” has a new thumbnail.` })
            }
            onSaved={() => {
              setNotice(null)
              setInfoSaved(true)
            }}
          />
        </div>
      </div>

      {copy === null || pending === null ? null : (
        <ConfirmDialog
          open
          title={copy.title(course.title)}
          body={
            <>
              <span>{copy.body}</span>
              {writeError === null ? null : (
                <span className={styles.dialogError} role="alert">
                  {writeError}
                </span>
              )}
            </>
          }
          confirmLabel={copy.label}
          tone={pending === 'archive' ? 'danger' : 'primary'}
          busy={saving}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}

      <Toast
        open={infoSaved || notice?.kind === 'success'}
        title={
          infoSaved ? 'Course information saved' : notice?.kind === 'success' ? notice.title : ''
        }
        body={
          infoSaved
            ? `“${course.title}” was updated.`
            : notice?.kind === 'success'
              ? notice.body
              : undefined
        }
        onDismiss={dismissNotice}
      />
      <Toast
        kind="error"
        open={notice?.kind === 'error'}
        title={notice?.kind === 'error' ? notice.title : ''}
        body={notice?.kind === 'error' ? notice.body : undefined}
        onDismiss={dismissNotice}
      />
    </div>
  )
}
