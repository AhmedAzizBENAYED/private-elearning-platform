import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react'

import { isApiError, useApiClient } from '../../../api'
import { Button, Dialog, Icon, TextField, Textarea } from '../../../design-system'
import { useFocusFirstError } from '../../../shared/useFocusFirstError'

import { createAdminApi, type AdminModule } from '../api'
import {
  LIMITS,
  moduleCreateBody,
  moduleFormFrom,
  modulePatch,
  validateModuleForm,
  type FieldErrors,
  type ModuleFormValues,
} from '../structureModel'
import { classifyWrite, type CourseWriteFailure } from '../useAdminCourse'

// The form dialog's content styles, shared with "Add a member": the same head,
// banner and actions, drawn by two boards of the same design system.
import styles from './AddMemberDialog.module.css'

export type ModuleDialogMode =
  | { kind: 'add'; courseId: string; position: number }
  | { kind: 'edit'; module: AdminModule }

export interface ModuleDialogProps {
  mode: ModuleDialogMode
  onClose: () => void
  /** The module as the server now holds it. */
  onSaved: (module: AdminModule) => void
}

const FAILURE: Record<CourseWriteFailure, string> = {
  // A 409 on a new module is the one position collision the dialog can cause:
  // it offered the first free position, and another write took it meanwhile.
  lifecycle: 'Another module took that place in the meantime. Close this dialog and try again.',
  'not-draft': 'The course is no longer a draft, so its structure can’t be changed.',
  'slug-taken': 'The change conflicts with another record.',
  invalid: 'Some of the details were rejected. Check the fields below.',
  'not-found': 'This module or its course no longer exists. Reload the page.',
  forbidden: 'Your administrator access may have changed. Sign in again.',
  unavailable: 'It could not be saved. Check your connection and try again.',
}

/**
 * "Add a module" and "Edit module" (Admin-Editor-States).
 *
 * The board draws one field, "Module title". The description is kept as a
 * second, optional one because members read it above the module's lessons
 * (`CourseOutline`) and this dialog is now the only place it can be written;
 * dropping it would silently remove an existing capability.
 *
 * There is no position field. A new module takes the first free position -
 * positions are unique per course and a collision is a 409 - and the order is
 * changed with the ↑ ↓ buttons, as the board prescribes.
 */
export function ModuleDialog({ mode, onClose, onSaved }: ModuleDialogProps) {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const titleId = useId()
  const { formRef, focusFirstError } = useFocusFirstError()

  const initial = useMemo<ModuleFormValues>(
    () =>
      mode.kind === 'edit'
        ? moduleFormFrom(mode.module)
        : { title: '', description: '', position: String(mode.position) },
    [mode],
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors<ModuleFormValues>>({})
  const [failure, setFailure] = useState<CourseWriteFailure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Enter pressed twice in the title, before the first answer: one request.
  const inFlight = useRef(false)

  const unchanged = mode.kind === 'edit' && Object.keys(modulePatch(values, initial)).length === 0

  const set = useCallback(
    (field: 'title' | 'description') => (event: { target: { value: string } }) => {
      const value = event.target.value
      setValues((previous) => ({ ...previous, [field]: value }))
      setErrors((previous) => ({ ...previous, [field]: undefined }))
    },
    [],
  )

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (inFlight.current) return
      setFailure(null)

      const local = validateModuleForm(values)
      if (Object.keys(local).length > 0) {
        setErrors(local)
        focusFirstError()
        return
      }
      if (unchanged) return

      inFlight.current = true
      setSubmitting(true)
      try {
        const saved =
          mode.kind === 'add'
            ? await api.createModule(mode.courseId, moduleCreateBody(values))
            : await api.updateModule(mode.module.id, modulePatch(values, initial))
        inFlight.current = false
        onSaved(saved)
      } catch (error: unknown) {
        inFlight.current = false
        setSubmitting(false)
        const reason = classifyWrite(error)
        setFailure(reason)
        if (reason === 'invalid' && isApiError(error)) {
          const fields = error.fieldErrors()
          setErrors({ title: fields.title, description: fields.description })
          focusFirstError()
        }
      }
    },
    [values, unchanged, mode, api, initial, onSaved, focusFirstError],
  )

  const heading = mode.kind === 'add' ? 'Add a module' : 'Edit module'

  return (
    <Dialog
      open
      onClose={onClose}
      busy={submitting}
      labelledBy={titleId}
      initialFocus="input"
      width="wide"
    >
      <div className={styles.head}>
        <span className={styles.glyph} aria-hidden="true">
          <Icon name="layers" size={20} />
        </span>
        <h2 id={titleId} className={styles.title}>
          {heading}
        </h2>
        <Button
          variant="tertiary"
          iconOnly
          iconLeft="x"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={submitting}
        />
      </div>

      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate aria-busy={submitting}>
        {failure === null ? null : (
          <div className={styles.banner} role="alert">
            <span className={styles.bannerGlyph} aria-hidden="true">
              <Icon name="alert" size={20} />
            </span>
            <div className={styles.bannerText}>
              <p className={styles.bannerBody}>{FAILURE[failure]}</p>
            </div>
          </div>
        )}

        <TextField
          label="Module title"
          required
          autoComplete="off"
          placeholder="e.g. Emails and reports"
          value={values.title}
          onChange={set('title')}
          error={errors.title}
          hint="Shown to members in the course outline."
          maxLength={LIMITS.title}
          disabled={submitting}
        />

        <Textarea
          label="Description"
          rows={3}
          value={values.description}
          onChange={set('description')}
          error={errors.description}
          hint="Optional. Shown to members above the module’s lessons."
          disabled={submitting}
        />

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={unchanged}
            loading={submitting}
            loadingLabel={mode.kind === 'add' ? 'Adding…' : 'Saving…'}
          >
            {mode.kind === 'add' ? 'Add module' : 'Save module'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
