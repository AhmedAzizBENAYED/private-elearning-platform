import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'

import { useApiClient } from '../../../api'
import { Button, Dialog, Icon, TextField } from '../../../design-system'
import { useFocusFirstError } from '../../../shared/useFocusFirstError'

import { createAdminApi, type Member } from '../api'
import {
  classifyCreateError,
  createMemberBody,
  emptyAddMember,
  FAILURE_MESSAGE,
  MEMBER_LIMITS,
  validateAddMember,
  type AddMemberErrors,
  type AddMemberFailure,
  type AddMemberValues,
} from '../addMemberModel'

import styles from './AddMemberDialog.module.css'

export interface AddMemberDialogProps {
  open: boolean
  onClose: () => void
  /** The account the server created. The dialog has already let go of it. */
  onCreated: (member: Member) => void
}

/**
 * "Add a member" (Admin-Members-States).
 *
 * The board's modal, field for field, with one necessary difference: the
 * board drew a single "Full name", but the account stores a first and a last
 * name separately and the API takes them separately, so there are two fields.
 * Splitting one string would mean guessing where a name ends, and getting it
 * wrong for anyone with a compound name.
 *
 * The password the administrator types exists only in this component's state
 * and in the body of the one request that sends it. It is never logged, never
 * put in a URL, never kept after the dialog closes - the dialog is remounted
 * for every opening - and the field asks the browser not to fill in the
 * administrator's own saved password (`autoComplete="new-password"`).
 */
export function AddMemberDialog({ open, onClose, onCreated }: AddMemberDialogProps) {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const titleId = useId()

  const [values, setValues] = useState<AddMemberValues>(emptyAddMember)
  const [errors, setErrors] = useState<AddMemberErrors>({})
  const [failure, setFailure] = useState<AddMemberFailure['kind'] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const { formRef, focusFirstError } = useFocusFirstError()

  // The fields are disabled while a request runs, as the board draws it, so a
  // press of Enter in a field leaves focus nowhere once that field is
  // disabled. After a failure that no single field explains, focus returns to
  // the button a retry starts from - read after the render that re-enables it.
  const [focusSubmit, setFocusSubmit] = useState(0)
  useEffect(() => {
    if (focusSubmit === 0) return
    formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
  }, [focusSubmit, formRef])

  // A request still running when the dialog goes away is abandoned, so its
  // answer cannot land on an unmounted form.
  const inFlight = useRef<AbortController | null>(null)
  useEffect(() => () => inFlight.current?.abort(), [])

  const set = useCallback(
    (field: keyof AddMemberValues) => (event: { target: { value: string } }) => {
      const value = event.target.value
      setValues((previous) => ({ ...previous, [field]: value }))
    },
    [],
  )

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      // One request at a time: a second press while the first is running is
      // ignored rather than creating the account twice.
      if (submitting) return

      const local = validateAddMember(values)
      setErrors(local)
      setFailure(null)
      if (Object.keys(local).length > 0) {
        focusFirstError()
        return
      }

      const controller = new AbortController()
      inFlight.current = controller
      setSubmitting(true)
      try {
        const member = await api.createMember(createMemberBody(values), controller.signal)
        inFlight.current = null
        onCreated(member)
      } catch (error) {
        if (controller.signal.aborted) return
        inFlight.current = null
        const result = classifyCreateError(error)
        setFailure(result.kind)
        if (result.kind === 'duplicate') {
          setErrors({ email: 'Use another email address' })
          focusFirstError()
        } else if (result.kind === 'invalid' && Object.keys(result.fieldErrors).length > 0) {
          setErrors(result.fieldErrors)
          focusFirstError()
        } else {
          setFocusSubmit((previous) => previous + 1)
        }
        // Everything typed stays where it was, the password included, so a
        // failed attempt costs nothing to retry.
        setSubmitting(false)
      }
    },
    [submitting, values, api, onCreated, focusFirstError],
  )

  const message = failure === null ? null : FAILURE_MESSAGE[failure]

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={submitting}
      labelledBy={titleId}
      initialFocus="input"
      width="wide"
    >
      <div className={styles.head}>
        <span className={styles.glyph} aria-hidden="true">
          <Icon name="user" size={20} />
        </span>
        <h2 id={titleId} className={styles.title}>
          Add a member
        </h2>
        <Button
          variant="tertiary"
          size="sm"
          iconOnly
          iconLeft="x"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={submitting}
        />
      </div>

      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate aria-busy={submitting}>
        {message ? (
          <div className={styles.banner} role="alert">
            <span className={styles.bannerGlyph} aria-hidden="true">
              <Icon name="alert" size={20} />
            </span>
            <div className={styles.bannerText}>
              <p className={styles.bannerTitle}>{message.title}</p>
              <p className={styles.bannerBody}>{message.body}</p>
            </div>
          </div>
        ) : null}

        <TextField
          label="First name"
          name="first_name"
          autoComplete="off"
          placeholder="e.g. Hedi"
          required
          value={values.firstName}
          onChange={set('firstName')}
          error={errors.firstName}
          disabled={submitting}
        />

        <TextField
          label="Last name"
          name="last_name"
          autoComplete="off"
          placeholder="e.g. Bouzid"
          required
          value={values.lastName}
          onChange={set('lastName')}
          error={errors.lastName}
          disabled={submitting}
        />

        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="off"
          placeholder="name@example.org"
          required
          value={values.email}
          onChange={set('email')}
          error={errors.email}
          disabled={submitting}
        />

        <TextField
          label="Password"
          type={revealed ? 'text' : 'password'}
          name="password"
          autoComplete="new-password"
          placeholder="Set a password"
          required
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          hint={`At least ${MEMBER_LIMITS.passwordMin} characters. The member will use it to sign in. Share it through a secure channel.`}
          disabled={submitting}
          rightSlot={
            <Button
              variant="tertiary"
              size="sm"
              iconOnly
              iconLeft={revealed ? 'eye-off' : 'eye'}
              aria-label={revealed ? 'Hide password' : 'Show password'}
              onClick={() => setRevealed((shown) => !shown)}
              disabled={submitting}
            />
          }
        />

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} loadingLabel="Creating…">
            Create member
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
