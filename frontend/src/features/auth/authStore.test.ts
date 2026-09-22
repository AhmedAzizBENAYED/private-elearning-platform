import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, AuthSessionError, NetworkError } from '../../api'
import {
  type AuthHarness,
  createAuthHarness,
  stubSignIn,
  testAdmin,
  testUser,
} from '../../test/authHarness'

import { REFRESH_TOKEN_KEY } from './refreshTokenStorage'

const UNAUTHORIZED = { status: 401, json: { detail: 'Invalid authentication credentials' } }

describe('login', () => {
  let harness: AuthHarness

  beforeEach(() => {
    harness = createAuthHarness()
  })

  it('stores both tokens, loads the account and becomes authenticated', async () => {
    stubSignIn(harness.http, { accessToken: 'access-1', refreshToken: 'refresh-1' })

    const user = await harness.authStore.login({
      email: 'iyed@example.org',
      password: 'correct-horse',
    })

    expect(user).toEqual(testUser)
    expect(harness.authStore.getState()).toEqual({ status: 'authenticated', user: testUser })
    expect(harness.accessTokens.get()).toBe('access-1')
    expect(harness.refreshTokens.read()).toBe('refresh-1')
  })

  it('posts the credentials as JSON to the real login path', async () => {
    stubSignIn(harness.http)

    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })

    const call = harness.http.callsTo('/auth/login')[0]
    expect(call?.url).toBe('http://localhost:8000/api/v1/auth/login')
    expect(call?.method).toBe('POST')
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      email: 'iyed@example.org',
      password: 'correct-horse',
    })
  })

  it('calls /auth/me with the new access token', async () => {
    stubSignIn(harness.http, { accessToken: 'access-1' })

    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })

    expect(harness.http.callsTo('/auth/me')[0]?.headers.authorization).toBe('Bearer access-1')
  })

  it('keeps the backend role, rather than deriving one', async () => {
    stubSignIn(harness.http, { user: testAdmin })

    const user = await harness.authStore.login({ email: 'amal@example.org', password: 'x' })

    expect(user.role).toBe('ADMIN')
  })

  it('leaves no token behind when the credentials are rejected', async () => {
    harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })

    await expect(
      harness.authStore.login({ email: 'iyed@example.org', password: 'wrong' }),
    ).rejects.toMatchObject({ status: 401, detail: 'Invalid email or password' })

    expect(harness.authStore.getState().status).not.toBe('authenticated')
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('never leaves a half-authenticated session when /auth/me fails', async () => {
    harness.http.on('/auth/login', {
      json: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer' },
    })
    harness.http.on('/auth/me', { status: 500, json: { detail: 'Internal server error' } })

    await expect(
      harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' }),
    ).rejects.toMatchObject({ status: 500 })

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })
})

describe('logout', () => {
  it('revokes the refresh token server-side, then clears the local session', async () => {
    const harness = createAuthHarness()
    stubSignIn(harness.http)
    harness.http.on('/auth/logout', { status: 204 })
    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })

    harness.authStore.logout()
    await vi.waitFor(() =>
      expect(harness.http.calls.filter((call) => call.url.includes('/auth/logout'))).toHaveLength(1),
    )

    // BE-SEC-02: clearing browser storage is not revocation. The server has to
    // be told, or the token stays usable for its full seven days.
    const [revocation] = harness.http.calls.filter((call) => call.url.includes('/auth/logout'))
    expect(revocation!.method).toBe('POST')
    expect(JSON.parse(revocation!.body!)).toEqual({ refresh_token: 'refresh-1' })
    // Never in the URL, where it would reach logs and referrers.
    expect(revocation!.url).not.toContain('refresh-1')

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('still signs out locally when the revocation call fails', async () => {
    const harness = createAuthHarness()
    stubSignIn(harness.http)
    harness.http.failNetwork('/auth/logout')
    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })

    harness.authStore.logout()

    // Leaving someone signed in on the machine in front of them is the worse
    // of the two failures, so the local session goes first and unconditionally.
    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('asks the server for nothing when no refresh token is held', async () => {
    const harness = createAuthHarness()

    harness.authStore.logout()

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.http.calls).toHaveLength(0)
  })
})

describe('bootstrap', () => {
  it('is unauthenticated when nothing is persisted', async () => {
    const harness = createAuthHarness()

    await harness.authStore.bootstrap()

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.http.calls).toHaveLength(0)
  })

  it('refreshes first, then loads the account', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', { json: testUser })

    await harness.authStore.bootstrap()

    // Order matters: calling /auth/me first would be a guaranteed 401.
    expect(harness.http.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
    ])
    expect(harness.authStore.getState()).toEqual({ status: 'authenticated', user: testUser })
    expect(harness.accessTokens.get()).toBe('access-2')
  })

  it('sends the persisted refresh token in the body, never in the URL', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', { json: testUser })

    await harness.authStore.bootstrap()

    const call = harness.http.callsTo('/auth/refresh')[0]
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ refresh_token: 'refresh-1' })
    expect(call?.url).not.toContain('refresh-1')
  })

  it('clears the rejected refresh token and stays unauthenticated', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'expired')
    harness.http.on('/auth/refresh', UNAUTHORIZED)

    await harness.authStore.bootstrap()

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.refreshTokens.read()).toBeNull()
    expect(harness.accessTokens.get()).toBeNull()
  })

  it('clears the session when /auth/me fails after a good refresh', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', UNAUTHORIZED)

    await harness.authStore.bootstrap()

    expect(harness.authStore.getState().status).toBe('unauthenticated')
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('runs once even when called concurrently, as StrictMode does', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', { json: testUser })

    await Promise.all([harness.authStore.bootstrap(), harness.authStore.bootstrap()])

    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(1)
  })

  it('starts in the unknown state before bootstrap resolves', () => {
    const harness = createAuthHarness()

    expect(harness.authStore.getState()).toEqual({ status: 'unknown', user: null })
  })
})

describe('refreshAccessToken', () => {
  it('resolves null when nothing is persisted, without calling the backend', async () => {
    const harness = createAuthHarness()

    await expect(harness.authStore.refreshAccessToken()).resolves.toBeNull()
    expect(harness.http.calls).toHaveLength(0)
  })

  it('stores the new access token and keeps the refresh token unrotated', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })

    await expect(harness.authStore.refreshAccessToken()).resolves.toBe('access-2')

    expect(harness.accessTokens.get()).toBe('access-2')
    // The backend does not rotate it, so the frontend must not pretend it did.
    expect(harness.refreshTokens.read()).toBe('refresh-1')
  })

  it('signs the session out when the refresh token is rejected', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'expired')
    harness.http.on('/auth/refresh', UNAUTHORIZED)

    await expect(harness.authStore.refreshAccessToken()).rejects.toBeInstanceOf(AuthSessionError)

    expect(harness.authStore.getState().status).toBe('unauthenticated')
    expect(harness.refreshTokens.read()).toBeNull()
    expect(harness.accessTokens.get()).toBeNull()
  })

  it('keeps the session through a server error, which is transient', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { status: 503, json: { detail: 'Service unavailable' } })

    await expect(harness.authStore.refreshAccessToken()).rejects.toBeInstanceOf(ApiError)

    // A 503 says nothing about the credential, so signing the user out would
    // lose their place over a blip.
    expect(harness.refreshTokens.read()).toBe('refresh-1')
  })

  it('keeps the session through a network failure', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.failNetwork('/auth/refresh')

    await expect(harness.authStore.refreshAccessToken()).rejects.toBeInstanceOf(NetworkError)

    expect(harness.refreshTokens.read()).toBe('refresh-1')
  })

  it('allows a later refresh after an earlier one failed', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.once('/auth/refresh', { status: 503, json: { detail: 'Service unavailable' } })
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })

    await expect(harness.authStore.refreshAccessToken()).rejects.toBeInstanceOf(ApiError)
    // The in-flight promise must have been released, not left poisoned.
    await expect(harness.authStore.refreshAccessToken()).resolves.toBe('access-2')
  })
})

// FE-AUTH-SESSION-01 - how a session ends, and when it must not.
describe('session lifecycle', () => {
  async function signedIn() {
    const harness = createAuthHarness()
    stubSignIn(harness.http, { accessToken: 'access-1', refreshToken: 'refresh-1' })
    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })
    return harness
  }

  it('marks a signed-in session the server refused to renew as expired', async () => {
    const harness = await signedIn()
    harness.http.on('/auth/refresh', UNAUTHORIZED)

    await expect(harness.authStore.refreshAccessToken()).rejects.toBeInstanceOf(AuthSessionError)

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null, expired: true })
    expect(harness.refreshTokens.read()).toBeNull()
    expect(harness.accessTokens.get()).toBeNull()
  })

  it('never calls a sign-out an expiry', async () => {
    const harness = await signedIn()
    harness.http.on('/auth/logout', { status: 204 })

    harness.authStore.logout()

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
  })

  it('forgets the expiry once the person signs in again', async () => {
    const harness = await signedIn()
    harness.http.on('/auth/refresh', UNAUTHORIZED)
    await harness.authStore.refreshAccessToken().catch(() => undefined)

    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })

    expect(harness.authStore.getState()).toEqual({ status: 'authenticated', user: testUser })
  })

  it('ends a signed-in session that holds no refresh token, instead of failing forever', async () => {
    // Blocked or cleared storage: the access token was kept in memory, but
    // nothing can renew it.
    const harness = await signedIn()
    harness.storage.clear()

    await expect(harness.authStore.refreshAccessToken()).resolves.toBeNull()

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null, expired: true })
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(0)
  })

  it.each([
    ['a server error', (h: AuthHarness) => h.http.on('/auth/refresh', { status: 503, json: { detail: 'Service unavailable' } })],
    ['a network failure', (h: AuthHarness) => h.http.failNetwork('/auth/refresh')],
  ])('keeps the stored session when bootstrap meets %s', async (_name, fail) => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    fail(harness)

    await harness.authStore.bootstrap()

    // Nothing to show this time, but the credential is not thrown away over
    // an outage: the next load restores the session.
    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.refreshTokens.read()).toBe('refresh-1')

    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', { json: testUser })
    await harness.authStore.bootstrap()
    expect(harness.authStore.getState()).toEqual({ status: 'authenticated', user: testUser })
  })

  it('keeps the stored session when /auth/me fails for a transient reason at bootstrap', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', { status: 500, json: { detail: 'Internal server error' } })

    await harness.authStore.bootstrap()

    expect(harness.authStore.getState().status).toBe('unauthenticated')
    expect(harness.refreshTokens.read()).toBe('refresh-1')
    expect(harness.accessTokens.get()).toBeNull()
  })

  it('still discards a refresh token the server rejects at bootstrap, without calling it an expiry', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { status: 422, json: { detail: [] } })

    await harness.authStore.bootstrap()

    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.refreshTokens.read()).toBeNull()
  })
})

describe('single-flight refresh', () => {
  it('sends ONE refresh for five concurrent 401s, and retries all five', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.accessTokens.set('stale')

    let refreshResolved = false
    harness.http.on('/auth/refresh', async () => {
      // Hold the refresh open so all five 401s arrive while it is in flight.
      await new Promise((resolve) => setTimeout(resolve, 10))
      refreshResolved = true
      return { json: { access_token: 'access-2', token_type: 'bearer' } }
    })

    const paths = ['/courses', '/me/enrollments', '/auth/me', '/courses/a/content', '/lessons/b']
    for (const path of paths) {
      harness.http.once(path, UNAUTHORIZED)
      harness.http.on(path, (call) =>
        call.headers.authorization === 'Bearer access-2'
          ? { json: { path, ok: true } }
          : { status: 401, json: { detail: 'Invalid authentication credentials' } },
      )
    }

    const results = await Promise.all(
      paths.map((path) => harness.apiClient.request<{ path: string; ok: boolean }>(path)),
    )

    expect(refreshResolved).toBe(true)
    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(1)
    expect(results.map((result) => result.path)).toEqual(paths)
    expect(results.every((result) => result.ok)).toBe(true)
    for (const path of paths) {
      expect(harness.http.callsTo(path)).toHaveLength(2)
    }
  })

  it('shares one rejection across concurrent callers, clearing the session once', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'expired')
    harness.http.on('/auth/refresh', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return UNAUTHORIZED
    })

    const outcomes = await Promise.allSettled([
      harness.authStore.refreshAccessToken(),
      harness.authStore.refreshAccessToken(),
      harness.authStore.refreshAccessToken(),
    ])

    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true)
    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(1)
    expect(harness.refreshTokens.read()).toBeNull()
  })
})

describe('subscriptions', () => {
  it('notifies subscribers on a state change and stops after unsubscribe', async () => {
    const harness = createAuthHarness()
    stubSignIn(harness.http)

    let notifications = 0
    const unsubscribe = harness.authStore.subscribe(() => {
      notifications += 1
    })

    await harness.authStore.login({ email: 'iyed@example.org', password: 'correct-horse' })
    expect(notifications).toBe(1)

    unsubscribe()
    harness.authStore.logout()
    expect(notifications).toBe(1)
  })

  it('does not notify when the state is unchanged', async () => {
    const harness = createAuthHarness()
    await harness.authStore.bootstrap()

    let notifications = 0
    harness.authStore.subscribe(() => {
      notifications += 1
    })

    harness.authStore.logout()
    harness.authStore.logout()

    expect(notifications).toBe(0)
  })
})
