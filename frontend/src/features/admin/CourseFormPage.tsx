import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { isApiError, useApiClient } from '../../api'
import { routes } from '../../app/routes'
import { Button, Icon, Skeleton, SkeletonGroup, TextField, Textarea } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { useFocusFirstError } from '../../shared/useFocusFirstError'

import { createAdminApi } from './api'
import {
  FORM_ERROR,
  LIMITS,
  createBodyFrom,
  emptyCourseForm,
  formFromCourse,
  isDirty,
  patchFrom,
  validateCourseForm,
  type CourseFieldErrors,
  type CourseFormValues,
} from './courseModel'
import { classifyWrite, useAdminCourse, type CourseWriteFailure } from './useAdminCourse'
import { LinkButton } from '../../app/LinkButton'
import styles from './CourseFormPage.module.css'

/** The backend's field names, as `fieldErrors()` keys them, mapped to the form. */
const FIELD_OF: Record<string, keyof CourseFormValues> = {
  title: 'title',
  description: 'description',
  slug: 'slug',
  thumbnail_url: 'thumbnailUrl',
}

function mergeServerErrors(
  local: CourseFieldErrors,
  server: Record<string, string>,
): CourseFieldErrors {
  const merged: CourseFieldErrors = { ...local }
  for (const [name, message] of Object.entries(server)) {
    const field = FIELD_OF[name]
    if (field !== undefined) merged[field] = message
  }
  return merged
}

interface FormProps {
  heading: string
  subtitle: string
  submitLabel: string
  submittingLabel: string
  initial: CourseFormValues
  /** The breadcrumb's last-but-one entry. */
  backTo: string
  backLabel: string
  onSubmit: (values: CourseFormValues, original: CourseFormValues) => Promise<{
    ok: boolean
    failure: CourseWriteFailure | null
    fieldErrors: Record<string, string>
  }>
  /** Whether an unchanged form may be submitted (never, for a patch). */
  requireChange: boolean
}

/**
 * The course form, shared by create and edit.
 *
 * Client-side validation exists for the person typing and restates only rules
 * the backend already has; the server's answer is what decides, and a 422 is
 * mapped back onto the fields it names. Nothing is invented: the four inputs
 * are exactly `CourseCreate` / `CourseUpdate`.
 */
function CourseForm({
  heading,
  subtitle,
  submitLabel,
  submittingLabel,
  initial,
  backTo,
  backLabel,
  onSubmit,
  requireChange,
}: FormProps) {
  const { formRef, focusFirstError } = useFocusFirstError()
  const [values, setValues] = useState<CourseFormValues>(initial)
  const [errors, setErrors] = useState<CourseFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = useCallback(
    (field: keyof CourseFormValues) => (value: string) => {
      setValues((previous) => ({ ...previous, [field]: value }))
      // Clearing as the person types keeps a stale message from contradicting
      // what is now in the box.
      setErrors((previous) => ({ ...previous, [field]: undefined }))
    },
    [],
  )

  const dirty = isDirty(values, initial)

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      setFormError(null)

      const local = validateCourseForm(values)
      if (Object.keys(local).length > 0) {
        setErrors(local)
        // Painting the fields red says nothing to anyone not looking at them.
        focusFirstError()
        return
      }
      if (requireChange && !dirty) {
        setFormError('Nothing has changed yet.')
        return
      }

      setSubmitting(true)
      void onSubmit(values, initial).then((result) => {
        setSubmitting(false)
        if (result.ok) return
        setErrors(mergeServerErrors({}, result.fieldErrors))
        setFormError(FORM_ERROR[result.failure ?? 'unavailable'])
        if (Object.keys(result.fieldErrors).length > 0) focusFirstError()
      })
    },
    [values, initial, dirty, requireChange, onSubmit, focusFirstError],
  )

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link className={styles.crumb} to={routes.adminCourses}>
          Courses
        </Link>
        <Icon name="chevron-right" size={16} className={styles.separator} />
        <span className={styles.current}>{heading}</span>
      </nav>

      <header className={styles.head}>
        <h1 className={styles.title}>{heading}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>

      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
        {formError === null ? null : (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}

        <TextField
          label="Title"
          required
          value={values.title}
          onChange={(event) => set('title')(event.target.value)}
          error={errors.title}
          maxLength={LIMITS.title}
          autoComplete="off"
        />

        <Textarea
          label="Description"
          required
          rows={6}
          value={values.description}
          onChange={(event) => set('description')(event.target.value)}
          error={errors.description}
          hint="What the course covers, for the catalogue."
        />

        <TextField
          label="Address"
          value={values.slug}
          onChange={(event) => set('slug')(event.target.value)}
          error={errors.slug}
          hint="Lowercase letters, digits and hyphens. Left blank, one is generated from the title."
          autoComplete="off"
        />

        <TextField
          label="Thumbnail URL"
          type="url"
          value={values.thumbnailUrl}
          onChange={(event) => set('thumbnailUrl')(event.target.value)}
          error={errors.thumbnailUrl}
          hint="A full http(s) address, or leave blank."
          autoComplete="off"
        />

        <div className={styles.actions}>
          <LinkButton variant="secondary" to={backTo}>
            {backLabel}
          </LinkButton>
          <Button type="submit" loading={submitting} loadingLabel={submittingLabel}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * `/admin/courses/new`.
 *
 * The new course is a DRAFT: `CourseService.create` sets the status itself and
 * accepts none from a client, so nothing here publishes anything. On success
 * the administrator lands on the new course's management page.
 */
export function CourseCreatePage() {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const navigate = useNavigate()

  const onSubmit = useCallback(
    async (values: CourseFormValues) => {
      try {
        const course = await api.createCourse(createBodyFrom(values))
        navigate(routes.adminCourse(course.id))
        return { ok: true, failure: null, fieldErrors: {} }
      } catch (error: unknown) {
        return {
          ok: false,
          failure: classifyWrite(error),
          fieldErrors: isApiError(error) ? error.fieldErrors() : {},
        }
      }
    },
    [api, navigate],
  )

  return (
    <CourseForm
      heading="Create course"
      subtitle="The course starts as a draft. Publish it once its content is ready."
      submitLabel="Create course"
      submittingLabel="Creating…"
      initial={emptyCourseForm}
      backTo={routes.adminCourses}
      backLabel="Cancel"
      onSubmit={onSubmit}
      requireChange={false}
    />
  )
}

/**
 * `/admin/courses/:courseId/edit`.
 *
 * Only a DRAFT can be edited - `require_draft` answers 409 for anything else -
 * so a published or archived course gets an explanation here rather than a form
 * whose every submission would be refused.
 */
export function CourseEditPage() {
  const { courseId = '' } = useParams<{ courseId: string }>()
  const navigate = useNavigate()
  const { status, course, failure, save } = useAdminCourse(courseId)

  const onSubmit = useCallback(
    async (values: CourseFormValues, original: CourseFormValues) => {
      const result = await save(patchFrom(values, original))
      if (result.ok) navigate(routes.adminCourse(courseId))
      return result
    },
    [save, navigate, courseId],
  )

  if (status === 'loading') {
    return (
      <SkeletonGroup label="Loading course" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={420} />
      </SkeletonGroup>
    )
  }

  if (status === 'error' || course === null) {
    return (
      <MessagePage
        icon={failure === 'forbidden' ? 'lock' : 'alert'}
        tone={failure === 'not-found' ? 'neutral' : undefined}
        title={failure === 'not-found' ? 'Course not found' : 'We couldn’t load this course'}
        body={
          failure === 'not-found'
            ? 'This course no longer exists, or the link is incorrect.'
            : 'Something went wrong while contacting the server.'
        }
        action={
          <LinkButton to={routes.adminCourses} variant="secondary" iconLeft="arrow-left">
            Back to courses
          </LinkButton>
        }
      />
    )
  }

  if (course.status !== 'DRAFT') {
    return (
      <MessagePage
        icon="lock"
        tone="neutral"
        title="This course can’t be edited"
        body="Only draft courses can be edited. A published course keeps the details it was published with."
        action={
          <LinkButton to={routes.adminCourse(courseId)} variant="secondary" iconLeft="arrow-left">
            Back to the course
          </LinkButton>
        }
      />
    )
  }

  return (
    <CourseForm
      heading="Edit course"
      subtitle={course.title}
      submitLabel="Save information"
      submittingLabel="Saving…"
      initial={formFromCourse(course)}
      backTo={routes.adminCourse(courseId)}
      backLabel="Cancel"
      onSubmit={onSubmit}
      requireChange
    />
  )
}
