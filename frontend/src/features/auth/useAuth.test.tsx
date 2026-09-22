import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import type { Role as DesignRole } from '../../design-system/tokens'
import { createAuthHarness, stubSignIn, testUser } from '../../test/authHarness'

import { AuthProvider } from './AuthProvider'
import { REFRESH_TOKEN_KEY } from './refreshTokenStorage'
import type { UserRole } from './types'
import { useAuth } from './useAuth'

/**
 * There must be exactly one role vocabulary in the frontend. These two
 * assignments fail to compile if the API's `UserRole` and the design system's
 * `Role` token ever diverge.
 */
const _apiRoleIsDesignRole: DesignRole = 'ADMIN' satisfies UserRole
const _designRoleIsApiRole: UserRole = 'MEMBER' satisfies DesignRole

function Probe() {
  const { user, status, isAuthenticated, login, logout } = useAuth()

  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="authenticated">{String(isAuthenticated)}</output>
      <output data-testid="user">{user ? user.email : 'none'}</output>
      <button
        type="button"
        onClick={() => {
          void login({ email: 'iyed@example.org', password: 'correct-horse' }).catch(
            () => undefined,
          )
        }}
      >
        Sign in
      </button>
      <button type="button" onClick={logout}>
        Sign out
      </button>
    </div>
  )
}

describe('useAuth', () => {
  it('requires a provider', () => {
    expect(() => render(<Probe />)).toThrow('useAuth must be used inside an <AuthProvider>')
  })

  it('reports the roles the design system also knows about', () => {
    expect([_apiRoleIsDesignRole, _designRoleIsApiRole]).toEqual(['ADMIN', 'MEMBER'])
  })

  it('settles on unauthenticated when nothing is persisted', async () => {
    const harness = createAuthHarness()

    render(
      <AuthProvider store={harness.authStore}>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
  })

  it('restores a session from the persisted refresh token on mount', async () => {
    const harness = createAuthHarness()
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    harness.http.on('/auth/me', { json: testUser })

    render(
      <AuthProvider store={harness.authStore}>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    })
    expect(screen.getByTestId('user')).toHaveTextContent('iyed@example.org')
    // StrictMode mounts effects twice; bootstrap must still refresh once.
    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(1)
  })

  it('re-renders through sign in and sign out', async () => {
    const harness = createAuthHarness()
    stubSignIn(harness.http)

    render(
      <AuthProvider store={harness.authStore}>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    })
    expect(screen.getByTestId('user')).toHaveTextContent('iyed@example.org')

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })

  it('stays unauthenticated when the credentials are rejected', async () => {
    const harness = createAuthHarness()
    harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })

    render(
      <AuthProvider store={harness.authStore}>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(harness.http.callsTo('/auth/login')).toHaveLength(1)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    expect(harness.accessTokens.get()).toBeNull()
  })

  it('exposes no token or storage mechanics to the UI', async () => {
    const harness = createAuthHarness()
    stubSignIn(harness.http)

    const captured: Record<string, unknown> = {}
    function Capture() {
      const auth = useAuth()
      useEffect(() => {
        Object.assign(captured, auth)
      }, [auth])
      return null
    }

    render(
      <AuthProvider store={harness.authStore}>
        <Capture />
      </AuthProvider>,
    )
    await waitFor(() => {
      expect(Object.keys(captured).length).toBeGreaterThan(0)
    })

    expect(Object.keys(captured).sort()).toEqual([
      'isAuthenticated',
      'login',
      'logout',
      'refresh',
      // FE-PROFILE-01: publishes the account PATCH /auth/me returned. It takes
      // a user and never a credential.
      'replaceUser',
      // FE-AUTH-SESSION-01: whether the server ended the session - a boolean,
      // never a credential.
      'sessionExpired',
      'status',
      'user',
    ])
    expect(JSON.stringify(captured)).not.toContain('access')
  })
})
