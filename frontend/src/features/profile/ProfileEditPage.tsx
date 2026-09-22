import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useApiClient } from '../../api'
import { Button, ConfirmDialog, Icon, TextField } from '../../design-system'
import { formatDate } from '../../shared/formatDate'
import { useFocusFirstError } from '../../shared/useFocusFirstError'
import { useAuth } from '../auth'

import { createProfileApi } from './api'
import {
  PROFILE_LIMITS,
  PROFILE_MESSAGES,
  classifyProfileError,
  isProfileDirty,
  profilePatch,
  profileValuesFrom,
  validateProfile,
  type ProfileErrors,
  type ProfileValues,
} from './model'
import { PasswordChangeForm } from './PasswordChangeForm'
import { profilePaths, roleLabel, type ProfileAreaProps, type ProfileNotice } from './paths'
import styles from './Profile.module.css'
import { useUnsavedChanges } from './useUnsavedChanges'

type Banner = keyof typeof PROFILE_MESSAGES

/** A field the association manages: readable, never editable here. */
export function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <TextField
      label={label}
      value={value}
      hint={hint}
      readOnly
      aria-readonly="true"
      rightSlot={
        <span className={styles.readOnlyGlyph}>
          <Icon name="lock" size={18} title="Read-only" />
        </span>
      }
    />
  )
}

/**
 * Edit profile (Profile-Edit, Admin-Profile-Edit, Profile-Edit-Mobile and
 * Profile-Tablet boards), for the signed-in account only.
 *
 * Three cards, as drawn:
 *  1. Personal information - first and last name, `PATCH /auth/me`;
 *  2. Account information - email, role and creation date, read only;
 *  3. Account & security - the password change, with its own submit.
 *
 * What the boards draw and the backend cannot do is left out rather than
 * shown disabled: the Photo card (no photo storage - the admin states board's
 * "photos not supported" fallback), email change, password reset.
 *
 * On success the server's `UserResponse` replaces the session's copy of the
 * account - the header shows the new name at once, with no second
 * `GET /auth/me` - and the page returns to the read view, which announces it.
 */
export function ProfileEditPage({ area }: ProfileAreaProps) {
  const { user, replaceUser } = useAuth()
  const client = useApiClient()
  const api = useMemo(() => createProfileApi(client), [client])
  const navigate = useNavigate()
  const location = useLocation()
  const { formRef, focusFirstError } = useFocusFirstError()
  const securityRef = useRef<HTMLElement>(null)
  const paths = profilePaths[area]

  const [values, setValues] = useState<ProfileValues>(() =>
    user ? profileValuesFrom(user) : { firstName: '', lastName: '' },
  )
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [banner, setBanner] = useState<Banner | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = user !== null && isProfileDirty(values, user)
  const guard = useUnsavedChanges(dirty && !saving)
  const fromChangePassword = location.hash === '#security'

  useEffect(() => {
    // Opened from "Change password": start at that card.
    if (fromChangePassword) securityRef.current?.scrollIntoView?.({ block: 'start' })
  }, [fromChangePassword])

  if (!user) return null

  function set(field: keyof ProfileValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || user === null) return
    setBanner(null)

    const local = validateProfile(values)
    const count = Object.keys(local).length
    if (count > 0) {
      setErrors(local)
      // "Two or more errors add a summary at the top and focus moves to the
      // first invalid field."
      if (count > 1) setBanner('validation')
      focusFirstError()
      return
    }
    if (!isProfileDirty(values, user)) return

    setSaving(true)
    try {
      const updated = await api.updateProfile(profilePatch(values, user))
      replaceUser(updated)
      guard.allowNextNavigation()
      navigate(paths.view, { state: { notice: 'profile-updated' } satisfies ProfileNotice })
    } catch (error: unknown) {
      const failure = classifyProfileError(error)
      setSaving(false)
      setBanner(failure.kind)
      if (failure.kind === 'invalid') {
        setErrors(failure.fieldErrors)
        focusFirstError()
      }
    }
  }

  const created = formatDate(user.created_at)

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link className={styles.crumb} to={paths.view}>
          My profile
        </Link>
        <Icon name="chevron-right" size={14} className={styles.separator} />
        <span className={styles.current} aria-current="page">
          Edit profile
        </span>
      </nav>

      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Edit profile</h1>
          <p className={styles.lede}>Update your name, or change your password.</p>
        </div>
      </header>
      <div className={styles.rule} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>

      <div className={styles.editStack}>
        <section className={styles.card} aria-labelledby="edit-personal">
          <form ref={formRef} className={styles.profileForm} onSubmit={submit} noValidate>
            {banner === null ? null : (
              <div className={styles.banner} role="alert">
                <span className={styles.bannerGlyph} aria-hidden="true">
                  <Icon name="alert" size={20} />
                </span>
                <div className={styles.bannerText}>
                  <p className={styles.bannerTitle}>{PROFILE_MESSAGES[banner].title}</p>
                  <p className={styles.bannerBody}>{PROFILE_MESSAGES[banner].body}</p>
                </div>
              </div>
            )}

            <div className={styles.sectionHead}>
              <span className={styles.step} aria-hidden="true">
                1
              </span>
              <div>
                <h2 id="edit-personal" className={styles.cardTitleMd}>
                  Personal information
                </h2>
                <p className={styles.caption}>Editable. Saved with “Save changes”.</p>
              </div>
            </div>

            <div className={styles.nameFields}>
              <TextField
                label="First name"
                name="first_name"
                autoComplete="given-name"
                required
                value={values.firstName}
                error={errors.firstName}
                disabled={saving}
                maxLength={PROFILE_LIMITS.name}
                onChange={(event) => set('firstName', event.target.value)}
              />
              <TextField
                label="Last name"
                name="last_name"
                autoComplete="family-name"
                required
                value={values.lastName}
                error={errors.lastName}
                disabled={saving}
                maxLength={PROFILE_LIMITS.name}
                onChange={(event) => set('lastName', event.target.value)}
              />
            </div>

            <div className={styles.footer}>
              <div className={styles.footerStatus} role="status">
                {saving ? (
                  <span className={styles.statusText}>Saving your changes…</span>
                ) : dirty ? (
                  <span className={styles.unsaved}>
                    <span className={styles.unsavedDot} aria-hidden="true" />
                    Unsaved changes
                  </span>
                ) : null}
              </div>
              <div className={styles.footerSpacer} />
              <div className={styles.footerActions}>
                <Button variant="tertiary" disabled={saving} onClick={() => navigate(paths.view)}>
                  Cancel
                </Button>
                {/* "Save changes stays disabled until a field changes." */}
                <Button type="submit" disabled={!dirty} loading={saving} loadingLabel="Saving…">
                  Save changes
                </Button>
              </div>
            </div>
          </form>
        </section>

        <section className={styles.card} aria-labelledby="edit-account">
          <div className={styles.sectionHead}>
            <span className={styles.step} aria-hidden="true">
              <Icon name="lock" size={18} />
            </span>
            <div>
              <h2 id="edit-account" className={styles.cardTitleMd}>
                Account information
              </h2>
              <p className={styles.caption}>Read-only. These details are managed by the association.</p>
            </div>
          </div>
          <div className={styles.accountFields}>
            <ReadOnlyField
              label="Email address"
              value={user.email}
              hint={
                area === 'admin'
                  ? 'Managed by the platform.'
                  : 'Managed by the association. Contact an administrator to change it.'
              }
            />
            <ReadOnlyField label="Role" value={roleLabel[user.role]} />
            <ReadOnlyField label="Account created" value={created} />
          </div>
        </section>

        <section
          ref={securityRef}
          id="security"
          className={[styles.card, styles.securityCard].join(' ')}
          aria-labelledby="edit-security"
        >
          <div className={styles.securityHead}>
            <span className={styles.shield} aria-hidden="true">
              <Icon name="shield" size={22} />
            </span>
            <div>
              <h2 id="edit-security" className={styles.cardTitleMd}>
                Account &amp; security
              </h2>
              <p className={styles.caption}>
                How you sign in. Kept apart from your profile details on purpose.
              </p>
            </div>
          </div>

          <div className={styles.passwordSection}>
            <h3 className={styles.subTitle}>
              <Icon name="lock" size={18} />
              Change my password
            </h3>
            <p className={styles.sectionBody}>
              Enter your current password, then choose a new one. Changing it is separate from
              saving your profile.
            </p>
            <PasswordChangeForm autoFocus={fromChangePassword} />
          </div>
        </section>
      </div>

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
