import { type ChangeEvent, type FormEvent, useId, useRef, useState } from 'react'

import { Button, ConfirmDialog, Icon, Textarea, TextField } from '../../../design-system'
import { safeExternalUrl } from '../../../shared/safeExternalUrl'
import { useFocusFirstError } from '../../../shared/useFocusFirstError'
import profile from '../../profile/Profile.module.css'
import { ReadOnlyField, useUnsavedChanges } from '../../profile'
import type { AdminCourse } from '../api'
import {
  FORM_ERROR,
  LIMITS,
  THUMBNAIL_ERROR,
  THUMBNAIL_TYPES,
  checkThumbnail,
  formFromCourse,
  isDirty,
  isEditable,
  patchFrom,
  validateCourseForm,
  type CourseFieldErrors,
  type CourseFormValues,
  type ThumbnailFailure,
} from '../courseModel'
import type { AdminCourseState, CourseWriteFailure } from '../useAdminCourse'

import styles from './CourseEditorCards.module.css'

/**
 * The course's image, or the board's navy tile when it has none.
 *
 * The address is re-checked before it reaches `src`, as every backend URL the
 * application renders is, and an image that fails to load falls back to the
 * tile rather than a broken-image glyph.
 */
function ThumbnailPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const safe = safeExternalUrl(url === '' ? null : url)
  return (
    <span className={styles.thumb}>
      {safe === null || failed === safe ? null : <img src={safe} alt="" onError={() => setFailed(safe)} />}
    </span>
  )
}

/** The backend's field names, as `fieldErrors()` keys them, mapped to the card. */
const FIELD_OF: Record<string, keyof CourseFormValues> = {
  title: 'title',
  description: 'description',
  thumbnail_url: 'thumbnailUrl',
}

/**
 * The editor's Course information card (Admin-Course-Editor).
 *
 * A draft gets the board's form: Title, Description, the Thumbnail with
 * "Replace image" and "Remove", and "Save information", which sends
 * `PATCH /admin/courses/{id}` with only what changed.
 *
 * "Replace image" ("Upload image" while there is none) opens the file picker
 * and sends the chosen file at once to `PUT /admin/courses/{id}/thumbnail`
 * (FE-THUMBNAIL-UPLOAD-01) - never through the PATCH. The server's answer is
 * the stored course, and its `thumbnail_url` becomes the thumbnail the form
 * holds, so an upload is not an unsaved change and never asks to be saved.
 * Title and Description edits in progress are kept as they are. "Remove" is
 * unchanged: it clears the address, saved as `null` by "Save information".
 *
 * A published or archived course can no longer be edited - `require_draft`
 * answers 409 - so the same card shows its fields read-only instead.
 */
export function CourseInformationCard({
  course,
  save,
  uploadThumbnail,
  onSaved,
  onUploaded,
}: {
  course: AdminCourse
  save: AdminCourseState['save']
  uploadThumbnail: AdminCourseState['uploadThumbnail']
  onSaved: () => void
  /** The page confirms an upload with its own toast, as it confirms a save. */
  onUploaded: () => void
}) {
  if (!isEditable(course)) {
    return (
      <section className={styles.card} aria-labelledby="course-information">
        <h2 id="course-information" className={styles.cardTitle}>
          Course information
        </h2>
        <ReadOnlyField label="Title" value={course.title} />
        <Textarea label="Description" value={course.description} rows={4} readOnly aria-readonly="true" />
        <div className={styles.thumbGroup}>
          <span className={styles.groupLabel}>Thumbnail</span>
          <ThumbnailPreview url={course.thumbnail_url ?? ''} />
        </div>
        <p className={styles.body}>
          Only draft courses can be edited. A published course keeps the details it was published with.
        </p>
      </section>
    )
  }
  return (
    <CourseInformationForm
      course={course}
      save={save}
      uploadThumbnail={uploadThumbnail}
      onSaved={onSaved}
      onUploaded={onUploaded}
    />
  )
}

function CourseInformationForm({
  course,
  save,
  uploadThumbnail,
  onSaved,
  onUploaded,
}: {
  course: AdminCourse
  save: AdminCourseState['save']
  uploadThumbnail: AdminCourseState['uploadThumbnail']
  onSaved: () => void
  onUploaded: () => void
}) {
  const { formRef, focusFirstError } = useFocusFirstError()
  const original = formFromCourse(course)
  const [values, setValues] = useState<CourseFormValues>(original)
  const [errors, setErrors] = useState<CourseFieldErrors>({})
  const [failure, setFailure] = useState<CourseWriteFailure | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadFailure, setUploadFailure] = useState<ThumbnailFailure | null>(null)
  // A ref as well as state: two change events in one tick must not both send.
  const uploadingRef = useRef(false)
  const picker = useRef<HTMLInputElement>(null)
  const uploadErrorId = useId()

  const dirty = isDirty(values, original)
  const guard = useUnsavedChanges(dirty && !saving)

  function set(field: keyof CourseFormValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared so choosing the same file again is still a change.
    event.target.value = ''
    if (file === undefined || uploadingRef.current || saving) return

    const refused = checkThumbnail(file)
    if (refused !== null) {
      setUploadFailure(refused)
      return
    }
    uploadingRef.current = true
    setUploading(true)
    setUploadFailure(null)
    const result = await uploadThumbnail(file)
    uploadingRef.current = false
    setUploading(false)
    if (!result.ok) {
      setUploadFailure(result.failure)
      return
    }
    // The server's address, and only the thumbnail: the fields being edited stay.
    setValues((previous) => ({ ...previous, thumbnailUrl: result.course.thumbnail_url ?? '' }))
    setErrors((previous) => ({ ...previous, thumbnailUrl: undefined }))
    onUploaded()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || uploading) return
    setFailure(null)

    const local = validateCourseForm(values)
    if (Object.keys(local).length > 0) {
      setErrors(local)
      focusFirstError()
      return
    }
    if (!dirty) return

    setSaving(true)
    const result = await save(patchFrom(values, original))
    setSaving(false)
    if (result.ok) {
      // What was sent is what is now stored; the page holds the server's row.
      setValues((previous) => ({
        ...previous,
        title: previous.title.trim(),
        description: previous.description.trim(),
        thumbnailUrl: previous.thumbnailUrl.trim(),
      }))
      onSaved()
      return
    }
    const fieldErrors: CourseFieldErrors = {}
    for (const [name, message] of Object.entries(result.fieldErrors)) {
      const field = FIELD_OF[name]
      if (field !== undefined) fieldErrors[field] = message
    }
    setErrors(fieldErrors)
    setFailure(result.failure ?? 'unavailable')
    if (Object.keys(fieldErrors).length > 0) focusFirstError()
  }

  return (
    <section className={styles.card} aria-labelledby="course-information">
      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
        <h2 id="course-information" className={styles.cardTitle}>
          Course information
        </h2>

        {failure === null ? null : (
          <div className={profile.banner} role="alert">
            <span className={profile.bannerGlyph} aria-hidden="true">
              <Icon name="alert" size={20} />
            </span>
            <div className={profile.bannerText}>
              <p className={profile.bannerBody}>{FORM_ERROR[failure]}</p>
            </div>
          </div>
        )}

        <TextField
          label="Title"
          name="title"
          required
          autoComplete="off"
          value={values.title}
          error={errors.title}
          disabled={saving}
          maxLength={LIMITS.title}
          onChange={(event) => set('title', event.target.value)}
        />

        {/* The board draws no asterisk here, but `Description` is 1..20000
            characters on the server: an empty one is refused. */}
        <Textarea
          label="Description"
          name="description"
          required
          rows={4}
          value={values.description}
          error={errors.description}
          disabled={saving}
          onChange={(event) => set('description', event.target.value)}
        />

        <div className={styles.thumbGroup} role="group" aria-labelledby="course-thumbnail">
          <span id="course-thumbnail" className={styles.groupLabel}>
            Thumbnail
          </span>
          <div className={styles.thumbRow} aria-busy={uploading ? true : undefined}>
            <ThumbnailPreview url={values.thumbnailUrl} />
            <div className={styles.thumbActions}>
              {/* Never focused or announced itself: the button below is the
                  control, and opens the browser's own file picker. */}
              <input ref={picker} type="file" hidden accept={THUMBNAIL_TYPES.join(',')} onChange={upload} />
              <Button
                variant="secondary"
                size="md"
                iconLeft="upload"
                disabled={saving}
                loading={uploading}
                loadingLabel="Uploading…"
                aria-describedby={uploadFailure === null ? undefined : uploadErrorId}
                onClick={() => picker.current?.click()}
              >
                {values.thumbnailUrl === '' ? 'Upload image' : 'Replace image'}
              </Button>
              {values.thumbnailUrl === '' ? null : (
                <Button
                  variant="tertiary"
                  size="sm"
                  disabled={saving || uploading}
                  aria-label="Remove thumbnail"
                  onClick={() => set('thumbnailUrl', '')}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          {uploadFailure === null ? null : (
            <p id={uploadErrorId} className={styles.fieldError} role="alert">
              {THUMBNAIL_ERROR[uploadFailure]}
            </p>
          )}
          {errors.thumbnailUrl === undefined ? null : (
            <p className={styles.fieldError}>
              {errors.thumbnailUrl}
            </p>
          )}
        </div>

        <div className={styles.formFooter}>
          <Button
            type="submit"
            variant="secondary"
            disabled={!dirty || uploading}
            loading={saving}
            loadingLabel="Saving…"
          >
            Save information
          </Button>
          {dirty && !saving ? (
            <span className={profile.unsaved}>
              <span className={profile.unsavedDot} aria-hidden="true" />
              Unsaved changes
            </span>
          ) : null}
        </div>
      </form>

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
    </section>
  )
}
