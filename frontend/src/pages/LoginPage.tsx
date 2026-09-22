import { type FormEvent, useId, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { ApiError, NetworkError } from '../api'
import { landingPathFor, routes } from '../app/routes'
import heroImage from '../assets/photo-mesh-band.jpg'
import logoReverse from '../assets/logo-reverse.png'
import { Button, Icon, TextField } from '../design-system'
import { useAuth } from '../features/auth'
import { useFocusFirstError } from '../shared/useFocusFirstError'
import { media, useMediaQuery } from '../shared/useMediaQuery'
import { EMAIL_PATTERN } from '../shared/validation'

import styles from './LoginPage.module.css'

interface FieldErrors {
  email?: string
  password?: string
}

/**
 * Only what the backend's own contract already requires: both fields present,
 * and an address that could plausibly be one. Anything subtler stays on the
 * server, which remains authoritative and answers with a 422 we surface.
 */
function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  if (email.trim() === '') errors.email = 'Enter your email address'
  else if (!EMAIL_PATTERN.test(email.trim()))
    errors.email = 'Enter a valid email address, for example name@example.org'
  if (password === '') errors.password = 'Enter your password'
  return errors
}

interface Failure {
  title: string
  body: string
}

/** Login-States "Invalid credentials". */
const CREDENTIALS_TITLE = 'Incorrect email or password'
/** Access-States "Server / network error": nothing about the credentials. */
const SERVER_TITLE = 'Something went wrong'

/**
 * Turns a failure into copy a member can act on.
 *
 * The Login-States board is explicit that server messages stay generic - "no
 * 'email not found'" - and nothing technical is shown: no token, no stack, no
 * backend internals. A 401 is deliberately the same message whether the
 * password was wrong or the account is inactive, because the backend itself
 * does not distinguish the two.
 */
function describeFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 422)
      return { title: CREDENTIALS_TITLE, body: 'Check your details and try again.' }
    if (error.isServerError)
      return { title: SERVER_TITLE, body: 'The server is unavailable right now. Try again in a moment.' }
  }
  // Only a refusal of the credentials is titled as one: an unreachable or
  // failing server says nothing about what was typed.
  if (error instanceof NetworkError)
    return {
      title: SERVER_TITLE,
      body: 'We couldn’t reach the server. Check your connection and try again.',
    }
  return { title: SERVER_TITLE, body: 'Something went wrong. Try again in a moment.' }
}

/**
 * "Back to home" (Login and Login-Mobile boards): to the public landing page,
 * the one way back for a visitor who opened Sign in from it.
 */
function BackToHome({ className }: { className: string }) {
  return (
    <Link to={routes.home} className={className}>
      <Icon name="arrow-left" size={18} />
      Back to home
    </Link>
  )
}

/** The sign-in screen (Login and Login-Mobile boards). */
export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const alertId = useId()
  const { formRef, focusFirstError } = useFocusFirstError()
  // Below 1024px the brand panel is a band above the form, and the boards put
  // "Back to home" under its logo; beside the form it sits in the panel's
  // corner. One link, mounted where the layout draws it.
  const stacked = !useMediaQuery(media.mdAndUp)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<Failure | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Guarded by the route as well; this covers a sign-in completing while the
  // page is still mounted.
  if (isAuthenticated && user) {
    return <Navigate to={landingPathFor(user.role)} replace />
  }

  const expired = new URLSearchParams(location.search).get('expired') === '1'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    // Guard the handler too: Enter can fire while the button is already busy.
    if (submitting) return

    const errors = validate(email, password)
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) {
      // Painting the fields red says nothing to someone not looking at them:
      // focus lands on the first one to fix, which announces its message.
      focusFirstError()
      return
    }

    setSubmitting(true)
    try {
      const signedIn = await login({ email: email.trim(), password })
      navigate(landingPathFor(signedIn.role), { replace: true })
    } catch (error) {
      // The email is kept and the password is left untouched, so a mistyped
      // character can be fixed rather than retyped.
      setFormError(describeFailure(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.brandStrip} aria-hidden="true">
        <div className={styles.brandAccent} />
        <div className={styles.brandMuted} />
      </div>

      <div className={styles.split}>
        <aside className={styles.aside}>
          <div className={styles.asideHead}>
            <img
              className={styles.logo}
              src={logoReverse}
              alt="JEENISo"
              width={148}
              height={66}
            />
          </div>
          {stacked ? (
            <div className={styles.backRow}>
              <BackToHome className={styles.back} />
            </div>
          ) : null}
          <div className={styles.asideMedia}>
            <img className={styles.photo} src={heroImage} alt="" />
            <div className={styles.caption}>
              <p className={styles.captionOverline}>Junior Entreprise ENISo</p>
              <p className={styles.captionTitle}>Members’ training platform</p>
              <p className={styles.captionBody}>
                Courses, videos and resources reserved for the members of the association.
              </p>
            </div>
          </div>
        </aside>

        <main className={styles.panel}>
          {stacked ? null : <BackToHome className={[styles.back, styles.backCorner].join(' ')} />}
          <div className={styles.form}>
            <h1 className={styles.title}>Sign in</h1>
            <div className={styles.titleRule} aria-hidden="true">
              <div className={styles.titleRuleAccent} />
              <div className={styles.titleRuleMuted} />
            </div>
            <p className={styles.lede}>Use the account created for you by the association.</p>

            {expired && formError === null ? (
              <div className={styles.notice} role="status">
                <Icon name="info" size={20} className={styles.noticeIcon} />
                <span>
                  <strong className={styles.noticeTitle}>Your session has expired</strong>
                  Sign in again to continue where you left off.
                </span>
              </div>
            ) : null}

            {formError ? (
              <div className={styles.alert} role="alert" id={alertId}>
                <Icon name="alert" size={20} className={styles.alertIcon} />
                <span>
                  <strong className={styles.alertTitle}>{formError.title}</strong>
                  {formError.body}
                </span>
              </div>
            ) : null}

            <form ref={formRef} className={styles.fields} onSubmit={onSubmit} noValidate>
              <TextField
                label="Email address"
                type="email"
                name="email"
                autoComplete="username"
                placeholder="name@example.org"
                iconLeft="mail"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={fieldErrors.email}
              />

              <TextField
                label="Password"
                type={revealed ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="Your password"
                iconLeft="lock"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={fieldErrors.password}
                rightSlot={
                  <Button
                    variant="tertiary"
                    size="sm"
                    iconOnly
                    iconLeft={revealed ? 'eye-off' : 'eye'}
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                    onClick={() => setRevealed((shown) => !shown)}
                  />
                }
              />

              <div className={styles.submit}>
                <Button
                  type="submit"
                  size="lg"
                  fullWidth
                  loading={submitting}
                  loadingLabel="Signing in…"
                >
                  Sign in
                </Button>
              </div>
            </form>

            <p className={styles.foot}>
              Accounts are created by an administrator. Need access? Write to{' '}
              <a className={styles.mail} href="mailto:contact@jeeniso.com">
                contact@jeeniso.com
              </a>
              .
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
