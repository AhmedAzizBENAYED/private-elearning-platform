import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { routes } from '../../app/routes'
import { Avatar, Badge, Button, ConfirmDialog, Icon, Skeleton, SkeletonGroup, Toast } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'

import { fullName } from './api'
import { formatDate } from './model'
import { LinkButton } from '../../app/LinkButton'
import profile from '../profile/Profile.module.css'
import { RoleChip } from '../profile'
import learning from './learning/Learning.module.css'
import styles from './MemberDetailPage.module.css'
import { isMemberSavedNotice, isMemberStatusIntent } from './memberEditState'
import { useMember, type MemberFailure, type StatusFailure } from './useMember'

const NOT_FOUND: Record<MemberFailure, { title: string; body: string }> = {
  'not-found': {
    title: 'Member not found',
    body: 'This account no longer exists, or the link is incorrect.',
  },
  forbidden: {
    title: 'Access denied',
    body: 'Your administrator access may have changed. Sign in again, or contact another administrator.',
  },
  unavailable: {
    title: 'We couldn’t load this member',
    body: 'Something went wrong while contacting the server.',
  },
}

const SAVE_FAILURE: Record<StatusFailure, string> = {
  'last-admin': 'This is the last active administrator, so the account cannot be deactivated.',
  'not-found': 'This account no longer exists. Go back to the member list.',
  forbidden: 'Your own administrator account is no longer active, so this change was refused.',
  unavailable: 'The change could not be saved. Check your connection and try again.',
}

/** One label / value row, as the profile pages draw them. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={profile.row}>
      <dt className={profile.rowLabel}>{label}</dt>
      <dd className={profile.rowValue}>{children}</dd>
    </div>
  )
}

/**
 * One member account (`/admin/members/:memberId`).
 *
 * Shows what `MemberResponse` carries and nothing more. The one action offered
 * is the one mutation the backend exposes for a member's account state:
 * `PATCH /admin/members/{id}/status`. It is confirmed first, because switching
 * an account off stops that person signing in.
 *
 * The design draws "Deactivate account" in two places - on this member view,
 * under Status, and in each row's "more actions" menu - and in both it is
 * disabled and tagged BACKEND GAP, because the designer did not know the
 * endpoint existed. It does (MEMBERS-02), so the action works here, on the
 * member's own page. The row menu is not built: it also carries Edit profile
 * and Reset password, which do not exist yet, and a menu of one item would be
 * a different design rather than this one.
 *
 * The board draws no confirmation, success or error copy for the action; the
 * wording follows the application's existing conventions (MEMBERS-01's
 * "X can now sign in.").
 */
export function MemberDetailPage() {
  const { memberId = '' } = useParams<{ memberId: string }>()
  const { status, member, failure, saving, saveFailure, reload, setActive } = useMember(memberId)
  const location = useLocation()
  const navigate = useNavigate()
  // "Deactivate / Activate account" from a row's menu opens this page with the
  // confirmation already asking - the same dialog, the same flow.
  const [confirming, setConfirming] = useState(() => isMemberStatusIntent(location.state))
  // The change that just landed, for the toast: the state the server stored,
  // not the one that was asked for.
  const [changed, setChanged] = useState<{ active: boolean; name: string } | null>(null)

  const onConfirm = useCallback(() => {
    if (member === null) return
    const name = fullName(member)
    void setActive(!member.is_active).then((ok) => {
      // Left open on failure, with the reason inside the dialog, so the
      // administrator is not left guessing whether the change landed.
      if (!ok) return
      setConfirming(false)
      setChanged({ active: !member.is_active, name })
    })
  }, [member, setActive])

  const dismissChanged = useCallback(() => setChanged(null), [])

  // Back from Edit member profile: the same toast as the member list shows.
  // The record itself is read again on arrival, so it already has the names.
  const [savedName, setSavedName] = useState<string | null>(() =>
    isMemberSavedNotice(location.state) ? fullName(location.state.savedMember) : null,
  )
  useEffect(() => {
    // Read once, then dropped from the history entry, so Back and Forward do
    // not replay the toast or the confirmation.
    if (isMemberSavedNotice(location.state) || isMemberStatusIntent(location.state)) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
    }
  }, [location, navigate])
  const dismissSaved = useCallback(() => setSavedName(null), [])

  if (status === 'loading') {
    return (
      <SkeletonGroup label="Loading member" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={260} />
      </SkeletonGroup>
    )
  }

  if (status === 'error' || member === null) {
    const text = NOT_FOUND[failure ?? 'unavailable']
    return (
      <MessagePage
        icon={failure === 'forbidden' ? 'lock' : 'alert'}
        tone={failure === 'not-found' ? 'neutral' : undefined}
        title={text.title}
        body={text.body}
        action={
          failure === 'not-found' ? (
            <LinkButton to={routes.adminMembers} variant="secondary" iconLeft="arrow-left">
              Back to members
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

  const name = fullName(member)
  const active = member.is_active

  const created = formatDate(member.created_at)

  // Admin-Member-View: the identity card beside three cards - personal
  // information, account information (read only, controlled by the platform)
  // and account & security, where the one administrator action the backend
  // offers on the account lives. The board's Reset password is not offered:
  // there is no endpoint for it. The layout is the profile pages' own.
  return (
    <div className={profile.page}>
      <nav className={profile.breadcrumb} aria-label="Breadcrumb">
        <Link className={profile.crumb} to={routes.adminMembers}>
          Members
        </Link>
        <Icon name="chevron-right" size={14} className={profile.separator} />
        <span className={profile.current} aria-current="page">
          {name}
        </span>
      </nav>

      <header className={profile.head}>
        <div className={profile.headText}>
          <h1 className={profile.title}>{name}</h1>
          <p className={profile.lede}>Member profile. Read-only view for administrators.</p>
        </div>
        {/* Admin-Member-View: "Edit profile" in the header (Admin-Member-Edit). */}
        <LinkButton to={routes.adminMemberEdit(member.id)} iconLeft="edit" className={profile.headAction}>
          Edit profile
        </LinkButton>
      </header>
      <div className={profile.rule} aria-hidden="true">
        <div className={profile.ruleAccent} />
        <div className={profile.ruleMuted} />
      </div>

      {/* Admin-Member-View draws two tabs on a member's page: their learning
          progress (FE-LEARNING-TRACKING-02) and this profile. Real links, so
          each is its own route. */}
      <nav className={learning.tabs} aria-label="Member views">
        <Link className={learning.tab} to={routes.adminMemberLearning(member.id)}>
          Learning progress
        </Link>
        <span className={[learning.tab, learning.tabCurrent].join(' ')} aria-current="page">
          Profile &amp; account
        </span>
      </nav>

      <div className={profile.viewGrid}>
        <section className={[profile.card, profile.identityCard].join(' ')} aria-labelledby="member-name">
          <Avatar name={name} size={128} tone={active ? 'brand' : 'inactive'} />
          <h2 id="member-name" className={profile.identityName}>
            {name}
          </h2>
          <p className={profile.identityEmail}>{member.email}</p>
          <RoleChip role={member.role} />
          <p className={profile.caption}>Account created {created}</p>
        </section>

        <div className={profile.stack}>
          <section className={profile.card} aria-labelledby="member-personal">
            <div className={profile.sectionHead}>
              <span className={profile.step} aria-hidden="true">
                1
              </span>
              <h2 id="member-personal" className={profile.cardTitleMd}>
                Personal information
              </h2>
            </div>
            <dl className={profile.rows}>
              <Row label="First name">{member.first_name}</Row>
              <Row label="Last name">{member.last_name}</Row>
            </dl>
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
                <p className={profile.caption}>Read-only. Controlled by the platform.</p>
              </div>
            </div>
            <dl className={profile.rows}>
              <Row label="Email address">{member.email}</Row>
              <Row label="Role">
                <RoleChip role={member.role} />
              </Row>
              <Row label="Status">
                <Badge kind="member-status" value={active ? 'active' : 'inactive'} />
              </Row>
              <Row label="Account created">
                <time dateTime={member.created_at}>{created}</time>
              </Row>
            </dl>
          </section>

          <section
            className={[profile.card, profile.securityCard].join(' ')}
            aria-labelledby="member-security"
          >
            <div className={profile.securityHead}>
              <span className={profile.shield} aria-hidden="true">
                <Icon name="shield" size={22} />
              </span>
              <div>
                <h2 id="member-security" className={profile.cardTitleSm}>
                  Account &amp; security
                </h2>
                <p className={profile.caption}>Administrator actions on this account.</p>
              </div>
            </div>
            <div className={profile.passwordRow}>
              <div>
                <p className={profile.rowLabel}>Account status</p>
                <Badge kind="member-status" value={active ? 'active' : 'inactive'} />
              </div>
              <Button
                variant={active ? 'danger-outline' : 'primary'}
                iconLeft={active ? 'lock' : 'check'}
                onClick={() => setConfirming(true)}
              >
                {active ? 'Deactivate account' : 'Activate account'}
              </Button>
            </div>
            <p className={styles.sectionBody}>
              {active
                ? 'This member can sign in. Deactivating the account stops that immediately; their progress is kept.'
                : 'This member cannot sign in. Reactivating the account restores their access and their progress.'}
            </p>

            {/* While the dialog is open the reason is shown inside it - behind the
                scrim it would be announced but not seen. Once the dialog is
                closed it stays here, so a cancelled retry is still explained. */}
            {saveFailure === null || confirming ? null : (
              <p className={styles.saveError} role="alert">
                {SAVE_FAILURE[saveFailure]}
              </p>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={active ? 'Deactivate this account?' : 'Activate this account?'}
        body={
          <>
            {active
              ? `${name} will no longer be able to sign in. Their enrollments and progress are kept, and you can reactivate the account at any time.`
              : `${name} will be able to sign in again, with their enrollments and progress as they left them.`}
            {saveFailure === null ? null : (
              <p className={styles.dialogError} role="alert">
                {SAVE_FAILURE[saveFailure]}
              </p>
            )}
          </>
        }
        confirmLabel={active ? 'Deactivate' : 'Activate'}
        tone={active ? 'danger' : 'primary'}
        busy={saving}
        onConfirm={onConfirm}
        onCancel={() => setConfirming(false)}
      />

      {/* One toast, and so one live region, for both confirmations. */}
      <Toast
        open={changed !== null || savedName !== null}
        title={
          changed !== null
            ? changed.active
              ? 'Member activated'
              : 'Member deactivated'
            : 'Profile updated'
        }
        body={
          changed !== null
            ? changed.active
              ? `${changed.name} can sign in again.`
              : `${changed.name} can no longer sign in.`
            : savedName !== null
              ? `${savedName}’s profile has been saved.`
              : undefined
        }
        onDismiss={changed !== null ? dismissChanged : dismissSaved}
      />
    </div>
  )
}
