import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { LinkButton } from '../../app/LinkButton'
import { Avatar, Badge, Button, Icon, Toast } from '../../design-system'
import { formatDate } from '../../shared/formatDate'
import { media, useMediaQuery } from '../../shared/useMediaQuery'
import { useAuth } from '../auth'

import { isProfileNotice, profilePaths, type ProfileAreaProps } from './paths'
import styles from './Profile.module.css'

/** One line of the "Personal information" card. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>{label}</dt>
      <dd className={styles.rowValue}>{children}</dd>
    </div>
  )
}

/** The role chip the boards draw: uppercase, with a person glyph. */
export function RoleChip({ role }: { role: 'ADMIN' | 'MEMBER' }) {
  return (
    <span className={styles.roleChip}>
      <Icon name="user" size={14} />
      <span>{role === 'ADMIN' ? 'ADMINISTRATOR' : 'MEMBER'}</span>
    </span>
  )
}

/**
 * My profile - the signed-in account, read only (Profile, Admin-Profile and
 * Profile-Mobile boards).
 *
 * Everything shown is what `GET /auth/me` already returned at sign-in and the
 * session holds, so there is nothing to load and no loading or error state to
 * draw: the page cannot be reached without it.
 *
 * The photo is not here: no endpoint stores one, and the admin states board
 * says to keep the initials avatar when photos are not supported.
 */
export function ProfilePage({ area }: ProfileAreaProps) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isPhone = useMediaQuery(media.belowSm)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const paths = profilePaths[area]
  // Read once, on arrival: the edit page leaves this after a successful save.
  const [updated, setUpdated] = useState(() => isProfileNotice(location.state))

  useEffect(() => {
    if (!isProfileNotice(location.state)) return
    // Profile-States: "focus goes to the page title". The notice is then
    // dropped from history, so a reload or a Back does not announce it again.
    titleRef.current?.focus()
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  const dismiss = useCallback(() => setUpdated(false), [])

  if (!user) return null

  const name = `${user.first_name} ${user.last_name}`
  const created = formatDate(user.created_at)

  return (
    <div className={styles.page}>
      {area === 'admin' ? (
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <span className={styles.current} aria-current="page">
            My profile
          </span>
        </nav>
      ) : null}

      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
            My profile
          </h1>
          <p className={styles.lede}>
            {area === 'admin'
              ? 'Your personal information as an administrator.'
              : 'Your personal information on the platform.'}
          </p>
        </div>
        {/* Profile-Mobile and Admin-Profile-Mobile move "Edit profile" to the
            foot of the page; from 600px it stays in the header. One link,
            placed by width - never a second copy hidden in CSS. */}
        {isPhone ? null : (
          <LinkButton to={paths.edit} iconLeft="edit" className={styles.headAction}>
            Edit profile
          </LinkButton>
        )}
      </header>
      <div className={styles.rule} aria-hidden="true">
        <div className={styles.ruleAccent} />
        <div className={styles.ruleMuted} />
      </div>

      <div className={styles.viewGrid}>
        <section className={[styles.card, styles.identityCard].join(' ')} aria-labelledby="profile-name">
          <Avatar name={name} size={128} />
          <h2 id="profile-name" className={styles.identityName}>
            {name}
          </h2>
          <p className={styles.identityEmail}>{user.email}</p>
          <RoleChip role={user.role} />
          <p className={styles.caption}>Account created {created}</p>
        </section>

        <div className={styles.stack}>
          <section className={styles.card} aria-labelledby="personal-information">
            <h2 id="personal-information" className={styles.cardTitle}>
              Personal information
            </h2>
            <dl className={styles.rows}>
              <Row label="First name">{user.first_name}</Row>
              <Row label="Last name">{user.last_name}</Row>
              <Row label="Email address">
                <span className={styles.locked}>
                  <Icon name="lock" size={14} />
                  <span className={styles.breakAll}>{user.email}</span>
                </span>
                <span className={styles.caption}>Managed by the association</span>
              </Row>
              <Row label="Role">
                <RoleChip role={user.role} />
              </Row>
              <Row label="Status">
                <Badge kind="member-status" value={user.is_active ? 'active' : 'inactive'} />
              </Row>
              <Row label="Account created">{created}</Row>
            </dl>
          </section>

          <section className={[styles.card, styles.securityCard].join(' ')} aria-labelledby="account-security">
            <div className={styles.securityHead}>
              <span className={styles.shield} aria-hidden="true">
                <Icon name="shield" size={22} />
              </span>
              <div>
                <h2 id="account-security" className={styles.cardTitleSm}>
                  Account &amp; security
                </h2>
                <p className={styles.caption}>Sign-in details</p>
              </div>
            </div>
            <div className={styles.passwordRow}>
              <div>
                <p className={styles.rowLabel}>Password</p>
                {/* Never the password itself - the board draws only dots. */}
                <p className={styles.dots}>
                  <span aria-hidden="true">••••••••••</span>
                  <span className="dsVisuallyHidden">Hidden</span>
                </p>
              </div>
              <LinkButton to={`${paths.edit}#security`} variant="secondary" iconLeft="lock">
                Change password
              </LinkButton>
            </div>
          </section>
        </div>
      </div>

      {/* Profile-Mobile and Admin-Profile-Mobile: the page ends with "Edit
          profile" and "Sign out", full width and stacked. */}
      {isPhone ? (
        <div className={styles.mobileActions}>
          <LinkButton to={paths.edit} iconLeft="edit" size="lg">
            Edit profile
          </LinkButton>
          <Button variant="secondary" size="lg" iconLeft="logout" fullWidth onClick={logout}>
            Sign out
          </Button>
        </div>
      ) : null}

      <Toast
        open={updated}
        title="Profile updated"
        body="Your changes have been saved."
        onDismiss={dismiss}
      />
    </div>
  )
}
