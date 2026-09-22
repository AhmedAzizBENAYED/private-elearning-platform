import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { isApiError, useApiClient } from '../../api'
import type { ContentType } from '../../api'
import { LinkButton } from '../../app/LinkButton'
import { routes } from '../../app/routes'
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  SegmentedControl,
  Skeleton,
  SkeletonGroup,
  TextField,
  Textarea,
} from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { useFocusFirstError } from '../../shared/useFocusFirstError'
import { useUnsavedChanges } from '../profile'
import profile from '../profile/Profile.module.css'

import {
  createAdminApi,
  type AdminCourse,
  type AdminLesson,
  type AdminModule,
  type LessonResource,
} from './api'
import { LessonFile } from './components/LessonFile'
import { LessonPreview } from './components/LessonPreview'
import { holdsFile } from './resourceModel'
import {
  CONTENT_HELP,
  CONTENT_LABEL,
  CONTENT_TYPES,
  LIMITS,
  TYPE_ICON,
  TYPE_LABEL,
  emptyLessonForm,
  formatDurationInput,
  isLessonFormDirty,
  isStored,
  lessonCreateBody,
  lessonFormFrom,
  lessonPatch,
  nextPosition,
  placeholderContent,
  validateLessonForm,
  type FieldErrors,
  type LessonFormValues,
  type LessonNotice,
} from './structureModel'
import { classifyWrite, useAdminCourse, type CourseWriteFailure } from './useAdminCourse'
import { useCourseStructure } from './useCourseStructure'
import detail from './AdminCourseDetailPage.module.css'
import styles from './LessonEditor.module.css'

/** One sentence per reason a lesson write can be refused. */
const SAVE_ERROR: Record<CourseWriteFailure, string> = {
  // Both unique-position collisions and the draft gate arrive as 409; this
  // one is the collision, which is the one a form can cause.
  lifecycle: 'That position is already taken in this module. Choose another.',
  'not-draft': 'The course is no longer a draft, so its lessons can’t be changed.',
  'slug-taken': 'That position is already taken in this module. Choose another.',
  invalid: 'Some of the details were rejected. Check the fields below.',
  'not-found': 'This lesson or its module no longer exists. Go back to the course.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  unavailable: 'It could not be saved. Check your connection and try again.',
}

const DELETE_ERROR: Record<CourseWriteFailure, string> = {
  // The backend's refusal while a stored file still points at the lesson.
  lifecycle: 'A file is still attached. Remove the lesson’s file first, then delete it.',
  'not-draft': 'The course is no longer a draft, so its lessons can’t be changed.',
  'slug-taken': 'The change conflicts with another record.',
  invalid: 'The deletion was rejected as invalid.',
  'not-found': 'It has already been removed. Go back to the course.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  unavailable: 'It could not be deleted. Check your connection and try again.',
}

/** The backend's field names, to the form's. */
const FIELD_OF: Record<string, keyof LessonFormValues> = {
  title: 'title',
  description: 'description',
  content: 'content',
  position: 'position',
  duration_seconds: 'durationSeconds',
}

// ----------------------------------------------------------------- the frame

function Loading({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className={styles.skeleton}>
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="block" height={360} />
    </SkeletonGroup>
  )
}

function BackToCourse({ courseId }: { courseId: string }) {
  return (
    <LinkButton to={routes.adminCourse(courseId)} variant="secondary" iconLeft="arrow-left">
      Back to the course
    </LinkButton>
  )
}

/**
 * Everything the editor needs before it can be shown: the course (its title,
 * its status, whether it exists and may be read) and its structure (the
 * module, the lesson, its siblings and its stored file).
 *
 * The lesson is read from the course's own structure rather than by id alone,
 * so a lesson id pasted under the wrong course is "not found" instead of being
 * edited under a breadcrumb that lies about where it lives.
 */
function useLessonContext(courseId: string) {
  const course = useAdminCourse(courseId)
  const structure = useCourseStructure(courseId)
  return { course, structure }
}

type Gate = { kind: 'blocked'; element: ReactElement } | { kind: 'ready'; course: AdminCourse }

/** The course, or the page shown instead of a form: loading, refused, missing, locked. */
function gate(
  courseId: string,
  context: ReturnType<typeof useLessonContext>,
  loadingLabel: string,
): Gate {
  const { course, structure } = context

  if (course.status === 'loading' || (course.status === 'ready' && structure.status === 'loading')) {
    return { kind: 'blocked', element: <Loading label={loadingLabel} /> }
  }

  if (course.status === 'error' || course.course === null) {
    if (course.failure === 'forbidden') {
      return {
        kind: 'blocked',
        element: (
          <MessagePage
            icon="lock"
            title="Access denied"
            body="Your administrator access may have changed. Sign in again."
          />
        ),
      }
    }
    if (course.failure === 'not-found') {
      return {
        kind: 'blocked',
        element: (
          <MessagePage
            icon="alert"
            tone="neutral"
            title="Course not found"
            body="This course no longer exists, or the link is incorrect."
            action={
              <LinkButton to={routes.adminCourses} variant="secondary" iconLeft="arrow-left">
                Back to courses
              </LinkButton>
            }
          />
        ),
      }
    }
    return {
      kind: 'blocked',
      element: (
        <MessagePage
          icon="wifi-off"
          title="We couldn’t load this course"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={course.reload}>
              Try again
            </Button>
          }
        />
      ),
    }
  }

  if (course.course.status !== 'DRAFT') {
    return {
      kind: 'blocked',
      element: (
        <MessagePage
          icon="lock"
          tone="neutral"
          title="This course’s structure can’t be changed"
          body="Only draft courses can be edited. A published or archived course keeps the structure it was published with."
          action={<BackToCourse courseId={courseId} />}
        />
      ),
    }
  }

  if (structure.status === 'error') {
    return {
      kind: 'blocked',
      element: (
        <MessagePage
          icon="wifi-off"
          title="We couldn’t load this lesson"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={structure.reload}>
              Try again
            </Button>
          }
        />
      ),
    }
  }

  return { kind: 'ready', course: course.course }
}

function NotFound({ courseId, what }: { courseId: string; what: 'Lesson' | 'Module' }) {
  return (
    <MessagePage
      icon="alert"
      tone="neutral"
      title={`${what} not found`}
      body={`This ${what.toLowerCase()} is not part of this course, or the link is incorrect.`}
      action={<BackToCourse courseId={courseId} />}
    />
  )
}

// ------------------------------------------------------------------- routes

/**
 * The old module form paths. Adding and editing a module are dialogs on the
 * course editor now (Admin-Editor-States), so a bookmark to either lands there
 * rather than on a dead page.
 */
export function ModuleRouteRedirect() {
  const { courseId = '' } = useParams<{ courseId: string }>()
  return <Navigate to={routes.adminCourse(courseId)} replace />
}

/** `/admin/courses/:courseId/modules/:moduleId/lessons/new`. */
export function LessonCreatePage() {
  const { courseId = '', moduleId = '' } = useParams<{ courseId: string; moduleId: string }>()
  const context = useLessonContext(courseId)
  const ready = gate(courseId, context, 'Loading course')
  if (ready.kind === 'blocked') return ready.element

  const parent = context.structure.modules.find((entry) => entry.module.id === moduleId)
  if (parent === undefined) return <NotFound courseId={courseId} what="Module" />

  return (
    <LessonEditor
      course={ready.course}
      module={parent.module}
      lesson={null}
      initial={emptyLessonForm(nextPosition(parent.lessons))}
      resource={null}
      resourcesFailed={false}
      onResourceChanged={context.structure.applyResource}
    />
  )
}

/** `/admin/courses/:courseId/lessons/:lessonId/edit`. */
export function LessonEditPage() {
  const { courseId = '', lessonId = '' } = useParams<{ courseId: string; lessonId: string }>()
  const context = useLessonContext(courseId)
  const ready = gate(courseId, context, 'Loading lesson')
  if (ready.kind === 'blocked') return ready.element

  const { structure } = context
  const parent = structure.modules.find((entry) =>
    entry.lessons.some((lesson) => lesson.id === lessonId),
  )
  const lesson = parent?.lessons.find((item) => item.id === lessonId)

  if (parent === undefined || lesson === undefined) {
    // A module whose lessons could not be read may be the one holding it.
    if (structure.modules.some((entry) => entry.lessonsFailed)) {
      return (
        <MessagePage
          icon="wifi-off"
          title="We couldn’t load this lesson"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={structure.reload}>
              Try again
            </Button>
          }
        />
      )
    }
    return <NotFound courseId={courseId} what="Lesson" />
  }

  return (
    <LessonEditor
      key={lesson.id}
      course={ready.course}
      module={parent.module}
      lesson={lesson}
      initial={lessonFormFrom(lesson)}
      resource={structure.resources[lesson.id] ?? null}
      resourcesFailed={structure.resourcesFailed}
      onResourceChanged={structure.applyResource}
    />
  )
}

// ------------------------------------------------------------------- editor

interface LessonEditorProps {
  course: AdminCourse
  module: AdminModule
  /** `null` while creating: the lesson does not exist yet. */
  lesson: AdminLesson | null
  initial: LessonFormValues
  resource: LessonResource | null
  resourcesFailed: boolean
  onResourceChanged: (lessonId: string, resource: LessonResource | null) => void
}

/**
 * The lesson editor (Admin-Lesson-Editor, Admin-Lesson-Types).
 *
 * Type first, as a segmented control; then the fields the board's matrix
 * gives that type - VIDEO: file, duration, position; DOCUMENT: file,
 * position; TEXT: content, position; LINK: URL, position - with title,
 * description and the preview flag for all four. Beside it, from 1280px, the
 * preview card; below it on narrower screens.
 *
 * Save returns to the course editor, which confirms with a toast. Leaving with
 * unsaved changes asks first (`useUnsavedChanges`, the profile's mechanism).
 */
function LessonEditor({
  course,
  module,
  lesson,
  initial: initialValues,
  resource,
  resourcesFailed,
  onResourceChanged,
}: LessonEditorProps) {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const navigate = useNavigate()
  const location = useLocation()
  const { formRef, focusFirstError } = useFocusFirstError()
  const creating = lesson === null

  const [initial, setInitial] = useState(initialValues)
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<FieldErrors<LessonFormValues>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // An upload reconciles a VIDEO lesson's duration on the server. The field
  // follows it, unless the administrator has typed a duration of their own.
  const [seenDuration, setSeenDuration] = useState(lesson?.duration_seconds ?? null)
  if (lesson !== null && lesson.duration_seconds !== seenDuration) {
    const next = formatDurationInput(lesson.duration_seconds)
    setSeenDuration(lesson.duration_seconds)
    setInitial((previous) => ({ ...previous, durationSeconds: next }))
    if (values.durationSeconds.trim() === initial.durationSeconds.trim()) {
      setValues((previous) => ({ ...previous, durationSeconds: next }))
    }
  }

  const dirty = isLessonFormDirty(values, initial)
  const guard = useUnsavedChanges(dirty && !submitting && !deleting)
  const back = routes.adminCourse(course.id)

  // G15: a lesson that holds a file keeps its type. Changing it would hide the
  // file behind a kind that has no file field, and the backend would then
  // refuse to delete the lesson while nothing on screen could remove the file.
  const savedType = lesson?.content_type ?? null
  const typeLocked =
    savedType !== null && holdsFile(savedType) && (resource !== null || resourcesFailed)

  // "Upload resource" in the structure opens this page on the file field.
  const fileField = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (location.hash !== '#lesson-file') return
    fileField.current?.querySelector<HTMLElement>('input[type="file"], button')?.focus()
  }, [location.hash])

  const set = useCallback(
    <Field extends keyof LessonFormValues>(field: Field) =>
      (value: LessonFormValues[Field]) => {
        setValues((previous) => ({ ...previous, [field]: value }))
        setErrors((previous) => ({ ...previous, [field]: undefined }))
      },
    [],
  )

  /**
   * Changing the kind rewrites what `content` has to be.
   *
   * A stored kind gets its placeholder when the current value is not usable for
   * it, and a duration is dropped the moment the lesson stops being a VIDEO,
   * because the server validates the resulting lesson and would refuse it.
   * Returning to the saved kind restores the saved content, so a change of
   * mind leaves no trace in the patch.
   */
  const onTypeChange = useCallback(
    (next: ContentType) => {
      setValues((previous) => {
        const wasStored = isStored(previous.contentType)
        const nowStored = isStored(next)
        let content = previous.content

        if (next === initial.contentType) content = initial.content
        else if (nowStored && !wasStored) content = placeholderContent(next)
        else if (nowStored && wasStored && previous.content.startsWith('storage://')) {
          content = placeholderContent(next)
        } else if (!nowStored && wasStored && previous.content.startsWith('storage://')) {
          content = ''
        }

        return {
          ...previous,
          contentType: next,
          content,
          durationSeconds:
            next === 'VIDEO'
              ? next === initial.contentType
                ? initial.durationSeconds
                : previous.durationSeconds
              : '',
        }
      })
      setErrors((previous) => ({ ...previous, content: undefined, durationSeconds: undefined }))
    },
    [initial],
  )

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      // The button is busy while saving; Enter in a field is guarded here too.
      if (inFlight.current) return
      setFormError(null)

      const local = validateLessonForm(values)
      if (Object.keys(local).length > 0) {
        setErrors(local)
        // Painting the fields red says nothing to anyone not looking at them.
        focusFirstError()
        return
      }
      let write: () => Promise<AdminLesson>
      if (lesson === null) {
        write = () => api.createLesson(module.id, lessonCreateBody(values))
      } else {
        const patch = lessonPatch(values, initial)
        if (Object.keys(patch).length === 0) {
          // "2:00" typed over "02:00": different text, the same lesson.
          setFormError('Nothing has changed yet.')
          return
        }
        write = () => api.updateLesson(lesson.id, patch)
      }

      inFlight.current = true
      setSubmitting(true)
      try {
        const saved = await write()
        guard.allowNextNavigation()
        const notice: LessonNotice = {
          lessonNotice: creating
            ? { title: 'Lesson added', body: `“${saved.title}” was added to “${module.title}”.` }
            : { title: 'Lesson saved', body: `“${saved.title}” was updated.` },
        }
        navigate(back, { state: notice })
      } catch (error: unknown) {
        inFlight.current = false
        setSubmitting(false)
        const reason = classifyWrite(error)
        const fieldErrors: FieldErrors<LessonFormValues> = {}
        if (isApiError(error)) {
          for (const [name, message] of Object.entries(error.fieldErrors())) {
            const field = FIELD_OF[name]
            if (field !== undefined) fieldErrors[field] = message
          }
        }
        // A 409 from the form is the position collision: say it on the field.
        if (reason === 'lifecycle' || reason === 'slug-taken') {
          fieldErrors.position = 'That position is already taken in this module'
        }
        setErrors(fieldErrors)
        setFormError(SAVE_ERROR[reason])
        if (Object.keys(fieldErrors).length > 0) focusFirstError()
      }
    },
    [values, creating, initial, api, module, lesson, guard, navigate, back, focusFirstError],
  )

  const confirmDelete = useCallback(() => {
    if (lesson === null || deleting) return
    setDeleting(true)
    setDeleteError(null)
    void api.deleteLesson(lesson.id).then(
      () => {
        guard.allowNextNavigation()
        const notice: LessonNotice = {
          lessonNotice: {
            title: 'Lesson deleted',
            body: `“${lesson.title}” was removed from the module.`,
          },
        }
        navigate(back, { state: notice })
      },
      (error: unknown) => {
        setDeleting(false)
        setDeleteError(DELETE_ERROR[classifyWrite(error)])
      },
    )
  }, [lesson, deleting, api, guard, navigate, back])

  const type = values.contentType

  return (
    <div className={detail.page}>
      <nav className={detail.breadcrumb} aria-label="Breadcrumb">
        <Link className={detail.crumb} to={routes.adminCourses}>
          Courses
        </Link>
        <Icon name="chevron-right" size={16} className={detail.separator} />
        <Link className={detail.crumb} to={back}>
          {course.title}
        </Link>
        <Icon name="chevron-right" size={16} className={detail.separator} />
        <span className={detail.current} aria-current="page">
          {lesson === null ? 'New lesson' : lesson.title}
        </span>
      </nav>

      <div>
        <header className={detail.head}>
          <div className={detail.headText}>
            <h1 className={detail.title}>{creating ? 'Add lesson' : 'Edit lesson'}</h1>
            <p className={detail.subtitle}>{`Module ${module.position} · ${module.title}`}</p>
          </div>
          <Badge kind="course-status" value={course.status} />
        </header>
        <div className={profile.rule} aria-hidden="true">
          <div className={profile.ruleAccent} />
          <div className={profile.ruleMuted} />
        </div>
      </div>

      <div className={styles.layout}>
        <form
          ref={formRef}
          className={styles.card}
          onSubmit={submit}
          noValidate
          aria-busy={submitting || undefined}
        >
          {formError === null ? null : (
            <div className={profile.banner} role="alert">
              <span className={profile.bannerGlyph} aria-hidden="true">
                <Icon name="alert" size={20} />
              </span>
              <div className={profile.bannerText}>
                <p className={profile.bannerBody}>{formError}</p>
              </div>
            </div>
          )}

          <SegmentedControl
            label="Lesson type"
            options={CONTENT_TYPES.map((value) => ({
              value,
              label: TYPE_LABEL[value],
              icon: TYPE_ICON[value],
              disabled: typeLocked && value !== savedType,
            }))}
            value={type}
            onChange={onTypeChange}
            disabled={submitting}
            hint={
              typeLocked
                ? resource !== null
                  ? 'This lesson holds a file, so its type is fixed. Remove the file to change it.'
                  : 'The lesson’s file couldn’t be checked, so its type is fixed. Reload the page to change it.'
                : 'Type-specific fields below change with the selected type.'
            }
          />

          <TextField
            label="Title"
            required
            value={values.title}
            onChange={(event) => set('title')(event.target.value)}
            error={errors.title}
            maxLength={LIMITS.title}
            autoComplete="off"
            disabled={submitting}
          />

          <Textarea
            label="Description"
            rows={3}
            value={values.description}
            onChange={(event) => set('description')(event.target.value)}
            error={errors.description}
            hint="Shown under the lesson title for members."
            disabled={submitting}
          />

          {holdsFile(type) ? (
            <div ref={fileField} id="lesson-file" className={styles.file}>
              {/* The file belongs to the lesson as saved: one being turned
                  into a VIDEO here cannot receive a file until that is saved. */}
              {lesson !== null && type === lesson.content_type ? (
                <LessonFile
                  lesson={{ ...lesson, content_type: type }}
                  resource={resource}
                  unknown={resourcesFailed}
                  editable
                  onChanged={onResourceChanged}
                />
              ) : (
                <>
                  <p className={styles.fileLabel}>
                    {type === 'VIDEO' ? 'Video file' : 'Document file'}
                  </p>
                  <p className={styles.fileNote}>
                    <Icon name="info" size={18} className={styles.fileNoteGlyph} />
                    {creating
                      ? 'The file can be added once the lesson is saved.'
                      : 'Save the new lesson type first. The file can be added afterwards.'}
                  </p>
                </>
              )}
            </div>
          ) : type === 'TEXT' ? (
            <Textarea
              label={CONTENT_LABEL.TEXT}
              required
              rows={8}
              value={values.content}
              onChange={(event) => set('content')(event.target.value)}
              error={errors.content}
              hint={CONTENT_HELP.TEXT}
              disabled={submitting}
            />
          ) : (
            <TextField
              label={CONTENT_LABEL.LINK}
              required
              type="url"
              inputMode="url"
              placeholder="https://"
              iconLeft="link"
              value={values.content}
              onChange={(event) => set('content')(event.target.value)}
              error={errors.content}
              hint={CONTENT_HELP.LINK}
              maxLength={LIMITS.reference}
              autoComplete="off"
              disabled={submitting}
            />
          )}

          <div className={styles.pair}>
            {type === 'VIDEO' ? (
              <TextField
                label="Duration"
                placeholder="00:00"
                iconLeft="clock"
                value={values.durationSeconds}
                onChange={(event) => set('durationSeconds')(event.target.value)}
                error={errors.durationSeconds}
                hint="Format mm:ss"
                autoComplete="off"
                disabled={submitting}
              />
            ) : null}
            <TextField
              label="Position"
              required
              type="number"
              min={1}
              value={values.position}
              onChange={(event) => set('position')(event.target.value)}
              error={errors.position}
              hint="Order within the module"
              disabled={submitting}
            />
          </div>

          <div className={styles.checkboxRow}>
            <input
              id="lesson-preview"
              type="checkbox"
              className={styles.checkbox}
              checked={values.isPreview}
              onChange={(event) => set('isPreview')(event.target.checked)}
              disabled={submitting}
            />
            <label htmlFor="lesson-preview" className={styles.checkboxLabel}>
              <span className={styles.checkboxTitle}>Mark as preview</span>
              <span className={styles.checkboxHint}>
                Recorded on the lesson. The backend enforces no access rule from it today, so it
                grants nobody early access on its own.
              </span>
            </label>
          </div>

          <div className={styles.footer}>
            {creating ? null : (
              <Button
                variant="danger-outline"
                iconLeft="trash"
                disabled={submitting}
                onClick={() => {
                  setDeleteError(null)
                  setConfirmingDelete(true)
                }}
              >
                Delete lesson
              </Button>
            )}
            <div className={styles.footerActions}>
              <LinkButton variant="tertiary" to={back}>
                Cancel
              </LinkButton>
              <Button
                type="submit"
                disabled={!creating && !dirty}
                loading={submitting}
                loadingLabel={creating ? 'Adding…' : 'Saving…'}
              >
                {creating ? 'Add lesson' : 'Save lesson'}
              </Button>
            </div>
          </div>
        </form>

        <aside className={styles.aside}>
          <LessonPreview values={values} resource={resource} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete the lesson “${lesson?.title ?? ''}”?`}
        body={
          <>
            <span>This lesson will be removed from the module. This can’t be undone.</span>
            {deleteError === null ? null : (
              <span className={styles.dialogError} role="alert">
                {deleteError}
              </span>
            )}
          </>
        }
        confirmLabel="Delete lesson"
        tone="danger"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          setConfirmingDelete(false)
          setDeleteError(null)
        }}
      />

      <ConfirmDialog
        open={guard.asking}
        title="Discard your changes?"
        body="You have unsaved changes. If you leave this page now, they will be lost."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onCancel={guard.keepEditing}
        onConfirm={guard.discard}
      />
    </div>
  )
}
