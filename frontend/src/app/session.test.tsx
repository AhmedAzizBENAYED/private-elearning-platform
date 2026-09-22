import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { REFRESH_TOKEN_KEY } from '../features/auth/refreshTokenStorage'
import { type AuthHarness, testUser } from '../test/authHarness'
import type { RecordedCall } from '../test/fetchMock'
import { renderRoute } from '../test/renderRoute'

/**
 * FE-AUTH-SESSION-01 - the session lifecycle, end to end through the real
 * route tree, store and API client.
 *
 * Each test starts the way the application does on a reload: a persisted
 * refresh token, which the startup refresh trades for access token `access-1`
 * before any page renders. After that, `/auth/refresh` answers `access-2`
 * unless a test says otherwise - so every refresh counted beyond the startup
 * one is a refresh the session lifecycle caused. The member dashboard reads
 * `/me/enrollments` and `/courses` at the same time, which makes it a natural
 * place to watch concurrent 401s.
 */

const EMPTY_PAGE = { items: [], total: 0, page: 1, page_size: 20 }
const UNAUTHORIZED = { status: 401, json: { detail: 'Invalid authentication credentials' } }

/** Refuses the first access token, as the backend does once it has expired. */
function expiredAccessToken(call: RecordedCall) {
  return call.headers.authorization === 'Bearer access-1' ? UNAUTHORIZED : { json: EMPTY_PAGE }
}

function expireAccessToken(harness: AuthHarness) {
  harness.http.on('/me/enrollments', expiredAccessToken)
  harness.http.on('/courses', expiredAccessToken)
}

const TOKENS = (accessToken: string) => ({ json: { access_token: accessToken, token_type: 'bearer' } })

const openDashboard = (beforeMount?: (harness: AuthHarness) => void) =>
  renderRoute({
    path: '/dashboard',
    beforeMount: (harness) => {
      harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
      harness.http.once('/auth/refresh', TOKENS('access-1'))
      harness.http.on('/auth/refresh', TOKENS('access-2'))
      harness.http.on('/auth/me', { json: testUser })
      beforeMount?.(harness)
    },
  })

/** Refreshes after the startup one - the ones the lifecycle itself caused. */
const laterRefreshes = (harness: AuthHarness) => harness.http.callsTo('/auth/refresh').length - 1

const dashboardHeading = () => screen.findByRole('heading', { name: 'Welcome back, Iyed', level: 1 })

describe('session - a valid access token', () => {
  it('is used as it is, with no refresh', async () => {
    const { harness } = await openDashboard()

    await dashboardHeading()
    await waitFor(() => expect(harness.http.callsTo('/me/enrollments').length).toBeGreaterThan(0))
    expect(harness.http.callsTo('/me/enrollments')[0]?.headers.authorization).toBe('Bearer access-1')
    expect(laterRefreshes(harness)).toBe(0)
  })
})

describe('session - an expired access token with a valid refresh token', () => {
  it('refreshes once and replays the original requests, which then succeed', async () => {
    const { harness, router } = await openDashboard(expireAccessToken)

    await dashboardHeading()
    await waitFor(() => {
      const replayed = harness.http.callsTo('/me/enrollments').at(-1)
      expect(replayed?.headers.authorization).toBe('Bearer access-2')
    })
    expect(harness.http.callsTo('/courses').at(-1)?.headers.authorization).toBe('Bearer access-2')
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(harness.authStore.getState().status).toBe('authenticated')
  })

  it('sends a single refresh when several requests get a 401 at the same time', async () => {
    let refreshes = 0
    const { harness } = await openDashboard((harness) => {
      expireAccessToken(harness)
      // Held open a moment, so every 401 lands while the refresh is in flight.
      harness.http.on('/auth/refresh', async () => {
        // The startup refresh is the `once` above; this counts the others.
        refreshes += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { json: { access_token: 'access-2', token_type: 'bearer' } }
      })
    })

    await dashboardHeading()
    await waitFor(() => {
      expect(harness.http.callsTo('/me/enrollments').at(-1)?.headers.authorization).toBe('Bearer access-2')
      expect(harness.http.callsTo('/courses').at(-1)?.headers.authorization).toBe('Bearer access-2')
    })
    // Both requests were refused with the old token...
    const refused = [...harness.http.callsTo('/me/enrollments'), ...harness.http.callsTo('/courses')].filter(
      (call) => call.headers.authorization === 'Bearer access-1',
    )
    expect(refused.length).toBeGreaterThanOrEqual(2)
    // ...and shared one refresh.
    expect(refreshes).toBe(1)
  })
})

describe('session - a refused refresh', () => {
  function refuseEverything(harness: AuthHarness) {
    harness.http.on('/me/enrollments', UNAUTHORIZED)
    harness.http.on('/courses', UNAUTHORIZED)
    // The startup refresh succeeds; the next one - the session's - is refused.
    harness.http.on('/auth/refresh', { status: 401, json: { detail: 'Refresh token expired' } })
  }

  it('clears the session and sends the person to sign in, saying the session expired', async () => {
    const { harness, router } = await openDashboard(refuseEverything)

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('?expired=1')
    expect(await screen.findByRole('status')).toHaveTextContent('Your session has expired')

    expect(harness.authStore.getState().status).toBe('unauthenticated')
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('does not loop: one refresh attempt, and each request replayed at most once', async () => {
    const { harness, router } = await openDashboard(refuseEverything)

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    // Give any would-be retry loop time to show itself.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(laterRefreshes(harness)).toBe(1)
    expect(harness.http.callsTo('/me/enrollments').length).toBeLessThanOrEqual(2)
    expect(harness.http.callsTo('/courses').length).toBeLessThanOrEqual(2)
  })

  it('keeps the page the person was on, for after they sign in again', async () => {
    const { router } = await openDashboard(refuseEverything)

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    const from = (router.state.location.state as { from?: { pathname: string } } | null)?.from
    expect(from?.pathname).toBe('/dashboard')
  })
})

describe('session - ordinary API errors are not an expiry', () => {
  it.each([
    [403, 'Insufficient privileges'],
    [404, 'Not found'],
    [500, 'Internal server error'],
  ])('a %i leaves the session and the page alone', async (status, detail) => {
    const { harness, router } = await openDashboard((harness) => {
      harness.http.on('/me/enrollments', { status, json: { detail } })
    })

    await dashboardHeading()
    await waitFor(() => expect(harness.http.callsTo('/me/enrollments').length).toBeGreaterThan(0))

    expect(laterRefreshes(harness)).toBe(0)
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(harness.authStore.getState().status).toBe('authenticated')
    expect(harness.refreshTokens.read()).toBe('refresh-1')
  })
})

describe('session - signing out', () => {
  it('clears the session and shows sign-in without an expiry notice', async () => {
    const { harness, router } = await openDashboard((harness) => {
      harness.http.on('/auth/logout', { status: 204 })
    })

    await userEvent.click(await screen.findByRole('button', { name: /Iyed Belghith/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('')
    expect(screen.queryByText('Your session has expired')).toBeNull()
    expect(harness.authStore.getState()).toEqual({ status: 'unauthenticated', user: null })
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })
})

describe('session - route protection after the session ends', () => {
  it('keeps signed-in and administration pages closed once the session has ended', async () => {
    const { router } = await openDashboard((harness) => {
      harness.http.on('/me/enrollments', UNAUTHORIZED)
      harness.http.on('/courses', UNAUTHORIZED)
      harness.http.on('/auth/refresh', { status: 401, json: { detail: 'Refresh token expired' } })
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    for (const path of ['/admin', '/courses']) {
      await router.navigate(path)
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
      // The router's location changes before React commits the page it leads
      // to: wait for the sign-in page itself, then check what else is shown.
      expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull()
    }
  })
})
