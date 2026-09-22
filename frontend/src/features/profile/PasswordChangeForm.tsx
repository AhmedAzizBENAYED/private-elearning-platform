import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'

import { useApiClient } from '../../api'
import { Button, Icon, TextField } from '../../design-system'
import { useFocusFirstError } from '../../shared/useFocusFirstError'

import { createProfileApi } from './api'
import {
  PASSWORD_MESSAGES,
  PROFILE_LIMITS,
  WRONG_CURRENT_FIELD,
  classifyPasswordError,
  confirmError,
  emptyPassword,
  isPasswordReady,
  meetsLength,
  passwordBody,
  passwordReason,
  passwordStrength,
  type PasswordStrength,
  type PasswordErrors,
  type PasswordFailure,
  type PasswordValues,
} from './model'
import styles from './Profile.module.css'

type Field = keyof PasswordValues

interface PasswordInputProps {
  field: Field
  label: string
  autoComplete: 'current-password' | 'new-password'
  value: string
  error?: string
  disabled: boolean
  revealed: boolean
  onChange: (value: string) => void
  onToggle: () => void
  onBlur?: () => void
}

/** One password box with its own show / hide button (Password-States). */
function PasswordInput({
  field,
  label,
  autoComplete,
  value,
  error,
  disabled,
  revealed,
  onChange,
  onToggle,
  onBlur,
}: PasswordInputProps) {
  return (
    <TextField
      label={label}
      name={field}
      type={revealed ? 'text' : 'password'}
      autoComplete={autoComplete}
      iconLeft="lock"
      required
      value={value}
      error={error}
      disabled={disabled}
      maxLength={PROFILE_LIMITS.passwordMax}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      rightSlot={
        <Button
          variant="tertiary"
          iconOnly
          iconLeft={revealed ? 'eye-off' : 'eye'}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          disabled={disabled}
          onClick={onToggle}
        />
      }
    />
  )
}

const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
}

/** Bars lit for each strength: one, two, three (Password-States). */
const STRENGTH_BARS: Record<PasswordStrength, number> = { weak: 1, fair: 2, strong: 3 }

/**
 * The meter under "New password" (Password-States). Before anything is typed
 * it says where the strength will appear; then a `role="status"` region gives
 * the verdict in words - the bars repeat it for the eye, never alone.
 */
function StrengthMeter({ password }: { password: string }) {
  const strength = passwordStrength(password)

  return (
    <div className={styles.strength} role="status">
      {strength === null ? (
        <p className={styles.strengthHint}>Strength shows here as you type.</p>
      ) : (
        <>
          <span className={styles.strengthBars} aria-hidden="true">
            {[1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={[
                  styles.strengthBar,
                  bar <= STRENGTH_BARS[strength] ? styles[strength] : undefined,
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
          </span>
          <span className={styles.strengthVerdict}>
            <Icon name={strength === 'strong' ? 'check-circle' : 'info'} size={16} />
            {`Strength: ${STRENGTH_LABEL[strength]}`}
          </span>
          <p className={styles.strengthHint}>A guide only. The requirements above are what count.</p>
        </>
      )}
    </div>
  )
}

export interface PasswordChangeFormProps {
  /** Set when the page was opened from "Change password", to start here. */
  autoFocus?: boolean
}

/**
 * Change my password (Password-States board), `POST /auth/change-password`.
 *
 * Kept apart from the profile on purpose, with its own submit: saving the
 * profile never sends a password and changing the password never saves the
 * profile.
 *
 * The one requirement listed is the backend's own - twelve characters. The
 * button stays disabled until the three fields are filled, the requirement is
 * met and both entries match; the line beside it says why. The confirmation
 * never leaves the page.
 *
 * A wrong current password comes back as a 400 and is shown on that field -
 * it is a form error, not a sign that the session ended. Sessions already open
 * are left as they are by the backend, so the success message promises
 * nothing about them.
 */
export function PasswordChangeForm({ autoFocus = false }: PasswordChangeFormProps) {
  const client = useApiClient()
  const api = useMemo(() => createProfileApi(client), [client])
  const { formRef, focusFirstError } = useFocusFirstError()
  const reasonId = useId()
  const requirementsId = useId()
  const successRef = useRef<HTMLDivElement>(null)

  const [values, setValues] = useState<PasswordValues>(emptyPassword)
  const [revealed, setRevealed] = useState<Record<Field, boolean>>({
    current: false,
    next: false,
    confirm: false,
  })
  const [confirmLeft, setConfirmLeft] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<PasswordErrors>({})
  const [failure, setFailure] = useState<PasswordFailure['kind'] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)

  useEffect(() => {
    if (autoFocus) formRef.current?.querySelector<HTMLInputElement>('input[name="current"]')?.focus()
  }, [autoFocus, formRef])

  useEffect(() => {
    // "After success the form is cleared, a confirmation replaces the errors
    // and focus moves to the confirmation."
    if (succeeded) successRef.current?.focus()
  }, [succeeded])

  const ready = isPasswordReady(values)
  const empty = values.current === '' && values.next === '' && values.confirm === ''
  const lengthMet = meetsLength(values.next)
  // Judged once the person has left the box, or typed as much as the new
  // password: not on the first character of an entry still being typed.
  const mismatch =
    confirmLeft || values.confirm.length >= values.next.length ? confirmError(values) : undefined

  function set(field: Field, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }))
    setSucceeded(false)
    if (field === 'confirm') setConfirmLeft(false)
  }

  function clear() {
    setValues(emptyPassword)
    setFieldErrors({})
    setFailure(null)
    setSucceeded(false)
    setConfirmLeft(false)
    setRevealed({ current: false, next: false, confirm: false })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting || !ready) return

    setFailure(null)
    setFieldErrors({})
    setSubmitting(true)
    try {
      await api.changePassword(passwordBody(values))
      clear()
      setSucceeded(true)
    } catch (error: unknown) {
      const result = classifyPasswordError(error)
      // The entries are kept: nothing was changed, and retyping three
      // passwords to fix one would be the wrong cost.
      setFailure(result.kind)
      if (result.kind === 'wrong-current') {
        setFieldErrors({ current: WRONG_CURRENT_FIELD })
        focusFirstError()
      } else if (result.kind === 'invalid') {
        setFieldErrors(result.fieldErrors)
        focusFirstError()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const toggle = (field: Field) => () =>
    setRevealed((previous) => ({ ...previous, [field]: !previous[field] }))

  return (
    <form ref={formRef} className={styles.passwordForm} onSubmit={submit} noValidate>
      {failure === null ? null : (
        <div className={styles.banner} role="alert">
          <span className={styles.bannerGlyph} aria-hidden="true">
            <Icon name="alert" size={20} />
          </span>
          <div className={styles.bannerText}>
            <p className={styles.bannerTitle}>{PASSWORD_MESSAGES[failure].title}</p>
            <p className={styles.bannerBody}>{PASSWORD_MESSAGES[failure].body}</p>
          </div>
        </div>
      )}

      {succeeded ? (
        <div ref={successRef} tabIndex={-1} className={styles.success} role="status">
          <span className={styles.successGlyph} aria-hidden="true">
            <Icon name="check-circle" size={20} />
          </span>
          <div className={styles.bannerText}>
            <p className={styles.bannerTitle}>Password updated</p>
            <p className={styles.bannerBody}>
              Your new password is active. Use it the next time you sign in.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.passwordGrid}>
        <div className={styles.passwordFields}>
          <PasswordInput
            field="current"
            label="Current password"
            autoComplete="current-password"
            value={values.current}
            error={fieldErrors.current}
            disabled={submitting}
            revealed={revealed.current}
            onChange={(value) => {
              set('current', value)
              if (failure === 'wrong-current') setFailure(null)
            }}
            onToggle={toggle('current')}
          />
          <div className={styles.newPassword}>
            <PasswordInput
              field="next"
              label="New password"
              autoComplete="new-password"
              value={values.next}
              error={fieldErrors.next}
              disabled={submitting}
              revealed={revealed.next}
              onChange={(value) => set('next', value)}
              onToggle={toggle('next')}
            />
            <StrengthMeter password={values.next} />
          </div>
          <PasswordInput
            field="confirm"
            label="Confirm new password"
            autoComplete="new-password"
            value={values.confirm}
            error={fieldErrors.confirm ?? mismatch}
            disabled={submitting}
            revealed={revealed.confirm}
            onChange={(value) => set('confirm', value)}
            onToggle={toggle('confirm')}
            onBlur={() => setConfirmLeft(true)}
          />
        </div>

        <div className={styles.requirements}>
          <p className={styles.requirementsTitle} id={requirementsId}>
            Your password must have
          </p>
          <ul className={styles.requirementList} aria-labelledby={requirementsId}>
            <li className={[styles.requirement, lengthMet ? styles.met : undefined].filter(Boolean).join(' ')}>
              <Icon name={lengthMet ? 'check-circle' : 'circle'} size={18} />
              <span>
                At least {PROFILE_LIMITS.passwordMin} characters
                <span className="dsVisuallyHidden">{lengthMet ? ' — met' : ' — not met'}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerStatus} role="status">
          {submitting ? (
            <span className={styles.statusText}>Updating your password…</span>
          ) : succeeded ? (
            <span className={styles.statusMuted}>You can change it again at any time.</span>
          ) : null}
        </div>
        {submitting || succeeded ? null : (
          <p className={styles.statusMuted} id={reasonId}>
            {passwordReason(values)}
          </p>
        )}
        <div className={styles.footerSpacer} />
        <div className={styles.footerActions}>
          <Button variant="tertiary" disabled={empty || submitting} onClick={clear}>
            Clear form
          </Button>
          <Button
            type="submit"
            disabled={!ready}
            loading={submitting}
            loadingLabel="Updating…"
            aria-describedby={submitting || succeeded ? undefined : reasonId}
          >
            Update password
          </Button>
        </div>
      </div>
    </form>
  )
}
