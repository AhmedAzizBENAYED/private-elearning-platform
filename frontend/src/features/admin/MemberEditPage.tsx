import { type FormEvent, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { isApiError, useApiClient } from '../../api'
import { LinkButton } from '../../app/LinkButton'
import { routes } from '../../app/routes'
import { Button, ConfirmDialog, Icon, Skeleton, SkeletonGroup, TextField } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { formatDate } from '../../shared/formatDate'
import { useFocusFirstError } from '../../shared/useFocusFirstError'
import profile from '../profile/Profile.module.css'
import {
  PROFILE_LIMITS,
  PROFILE_MESSAGES,
  ReadOnlyField,
  classifyProfileError,
  isProfileDirty,
  profilePatch,
  profileValuesFrom,
  useUnsavedChanges,
  validateProfile,
  type ProfileErrors,
  type ProfileValues,
} from '../profile'

import { createAdminApi, fullName, type Member } from './api'
import styles from './MemberEditPage.module.css'
import { isListOrigin, type MemberSavedNotice } from './memberEditState'
import { useMember } from './useMember'

/** Admin-Profile-States "Member edit · not allowed (403)" and "· not found (404)". */
const LOAD_FAILURE = {
  forbidden: {
    icon: 'lock',
    overline: 'Error 403',
    title: 'You can’t edit this profile',
    body: 'Only administrators with the right permission can edit member profiles.',
  },
  'not-found': {
    icon: 'alert',
    overline: 'Error 404',
    title: 'This member doesn’t exist any more',
    body: 'The member may have been removed, or the link is incorrect.',
  },
} as const

/**
 * Why a save was refused, as a banner above the form. The entered names stay
 * in the fields whatever happened, so nothing typed is lost.
 */
type SaveBanner = keyof typeof PROFILE_MESSAGES | 'forbidden' | 'not-found'

const SAVE_MESSAGES: Record<SaveBanner, { title: string; body: string }> = {
  ...PROFILE_MESSAGES,
  forbidden: LOAD_FAILURE.forbidden,
  'not-found': LOAD_FAILURE['not-found'],
}

function saveFailureOf(error: unknown): { banner: SaveBanner; fieldErrors?: ProfileErrors } {
  if (isApiError(error) && error.isForbidden) return { banner: 'forbidden' }
  if (isApiError(error) && error.isNotFound) return { banner: 'not-found' }
  // 401 (session), 422 (fields) and the rest (409, 5xx, network) follow the
  // profile form's own classification, so both forms answer alike.
  const failure = classifyProfileError(error)
  return failure.kind === 'invalid'
    ? { banner: 'invalid', fieldErrors: failure.fieldErrors }
    : { banner: failure.kind }
}

/**
 * Edit member profile (`/admin/members/:memberId/edit`; Admin-Member-Edit,
 * Admin-Member-Edit-Mobile and the member-edit states of Admin-Profile-States).
 *
 * The same name form as the signed-in account's own Edit profile - same
 * rules, same messages, same unsaved-changes guard - pointed at another
 * account through `PATCH /admin/members/{id}`. What the boards draw and the
 * backend cannot do is left out rather than shown disabled: the Photo card
 * (the board's own "photos not supported" fallback) and the password reset
 * card (no endpoint). Email, role, status and creation date are read-only,
 * as drawn; the account status keeps its own action on the member's page.
 */
export function MemberEditPage() {
  const { memberId = '' } = useParams<{ memberId: string }>()
  const { status, member, failure, reload } = useMember(memberId)

  if (status === 'loading') {
    return (
      <SkeletonGroup label="Loading member" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={220} />
        <Skeleton variant="block" height={180} />
      </SkeletonGroup>
    )
  }

  if (status === 'error' || member === null) {
    if (failure === 'forbidden' || failure === 'not-found') {
      const text = LOAD_FAILURE[failure]
      return (
        <MessagePage
          icon={text.icon}
          tone={failure === 'not-found' ? 'neutral' : undefined}
          overline={text.overline}
          title={text.title}
          body={text.body}
          action={
            <LinkButton to={routes.adminMembers} variant="secondary" iconLeft="arrow-left">
              Back to members
            </LinkButton>
          }
        />
      )
    }
    return (
      <MessagePage
        icon="alert"
        title="We couldn’t load this member"
        body="Something went wrong while contacting the server."
        action={
          <Button iconLeft="refresh" onClick={reload}>
            Try again
          </Button>
        }
      />
    )
  }

  // Keyed by the loaded record, so the form starts from what the server holds.
  return <MemberEditForm key={member.updated_at} member={member} />
}

function MemberEditForm({ member }: { member: Member }) {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])
  const navigate = useNavigate()
  const location = useLocation()
  const { formRef, focusFirstError } = useFocusFirstError()

  const [values, setValues] = useState<ProfileValues>(() => profileValuesFrom(member))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [banner, setBanner] = useState<SaveBanner | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = isProfileDirty(values, member)
  const guard = useUnsavedChanges(dirty && !saving)
  const name = fullName(member)

  const origin = isListOrigin(location.state) ? location.state : null
  const back = origin ? `${routes.adminMembers}${origin.search}` : routes.adminMember(member.id)

  function set(field: keyof ProfileValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // The button is busy while saving; Enter in a field is guarded here too.
    if (saving) return
    setBanner(null)

    const local = validateProfile(values, 'member')
    const count = Object.keys(local).length
    if (count > 0) {
      setErrors(local)
      if (count > 1) setBanner('validation')
      focusFirstError()
      return
    }
    if (!dirty) return

    setSaving(true)
    try {
      const saved = await api.updateMember(member.id, profilePatch(values, member))
      guard.allowNextNavigation()
      navigate(back, { state: { savedMember: saved } satisfies MemberSavedNotice })
    } catch (error: unknown) {
      const refused = saveFailureOf(error)
      setSaving(false)
      setBanner(refused.banner)
      if (refused.fieldErrors) {
        setErrors(refused.fieldErrors)
        focusFirstError()
      }
    }
  }

  return (
    <div className={profile.page}>
      <nav className={profile.breadcrumb} aria-label="Breadcrumb">
        <Link className={profile.crumb} to={routes.adminMembers}>
          Members
        </Link>
        <Icon name="chevron-right" size={14} className={profile.separator} />
        <Link className={profile.crumb} to={routes.adminMember(member.id)}>
          {name}
        </Link>
        <Icon name="chevron-right" size={14} className={profile.separator} />
        <span className={profile.current} aria-current="page">
          Edit profile
        </span>
      </nav>

      <header className={profile.head}>
        <div className={profile.headText}>
          <h1 className={profile.title}>Edit member profile</h1>
          <p className={profile.lede}>{`Update ${name}’s personal information.`}</p>
        </div>
      </header>
      <div className={profile.rule} aria-hidden="true">
        <div className={profile.ruleAccent} />
        <div className={profile.ruleMuted} />
      </div>

      {/* DEV NOTE: "The banner 'You are editing the profile of another
          member' is always visible." */}
      <p className={styles.otherMember}>
        <Icon name="info" size={20} className={styles.otherMemberGlyph} />
        You are editing the profile of another member. Only administrators can do this.
      </p>

      <div className={profile.editStack}>
        <section className={profile.card} aria-labelledby="member-personal">
          <form ref={formRef} className={profile.profileForm} onSubmit={submit} noValidate>
            {banner === null ? null : (
              <div className={profile.banner} role="alert">
                <span className={profile.bannerGlyph} aria-hidden="true">
                  <Icon name="alert" size={20} />
                </span>
                <div className={profile.bannerText}>
                  <p className={profile.bannerTitle}>{SAVE_MESSAGES[banner].title}</p>
                  <p className={profile.bannerBody}>{SAVE_MESSAGES[banner].body}</p>
                </div>
              </div>
            )}

            <div className={profile.sectionHead}>
              <span className={profile.step} aria-hidden="true">
                1
              </span>
              <div>
                <h2 id="member-personal" className={profile.cardTitleMd}>
                  Personal information
                </h2>
                <p className={profile.caption}>Editable. Saved with “Save changes”.</p>
              </div>
            </div>

            <div className={profile.nameFields}>
              <TextField
                label="First name"
                name="first_name"
                autoComplete="off"
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
                autoComplete="off"
                required
                value={values.lastName}
                error={errors.lastName}
                disabled={saving}
                maxLength={PROFILE_LIMITS.name}
                onChange={(event) => set('lastName', event.target.value)}
              />
            </div>

            <div className={profile.footer}>
              <div className={profile.footerStatus} role="status">
                {saving ? (
                  <span className={profile.statusText}>Saving your changes…</span>
                ) : dirty ? (
                  <span className={profile.unsaved}>
                    <span className={profile.unsavedDot} aria-hidden="true" />
                    Unsaved changes
                  </span>
                ) : null}
              </div>
              <div className={profile.footerSpacer} />
              <div className={profile.footerActions}>
                <Button variant="tertiary" disabled={saving} onClick={() => navigate(back)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!dirty} loading={saving} loadingLabel="Saving…">
                  Save changes
                </Button>
              </div>
            </div>
          </form>
        </section>

        <section className={profile.card} aria-labelledby="member-account">
          <div className={profile.sectionHead}>
            <span className={profile.step} aria-hidden="true">
              <Icon name="lock" size={18} />
            </span>
            <div>
              <h2 id="member-account" className={profile.cardTitleMd}>
                Account information
              </h2>
              <p className={profile.caption}>Read-only. These details are controlled by the platform.</p>
            </div>
          </div>
          <div className={profile.accountFields}>
            <ReadOnlyField label="Email address" value={member.email} hint="Not editable from this page." />
            <ReadOnlyField label="Role" value={member.role === 'ADMIN' ? 'Administrator' : 'Member'} />
            <ReadOnlyField label="Status" value={member.is_active ? 'Active' : 'Inactive'} />
            <ReadOnlyField label="Account created" value={formatDate(member.created_at)} />
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
