import { render, type RenderResult } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import { ApiClientProvider } from '../api'
import { AuthProvider } from '../features/auth'
import { routeTree } from '../app/router'

import { type AuthHarness, createAuthHarness, stubSignIn, testAdmin, testUser } from './authHarness'
import { REFRESH_TOKEN_KEY } from '../features/auth/refreshTokenStorage'
import { setViewport, viewports } from './viewport'

const emptyPage = { items: [], total: 0, page: 1, page_size: 100 }

export interface RenderRouteOptions {
  /** Where the browser is, including deep links. */
  path?: string
  /** Pre-authenticate the session with this account before mounting. */
  as?: 'member' | 'admin' | null
  width?: number
  /**
   * Runs after the session is established and the default stubs are installed,
   * but before mounting. Feature routes fetch on mount, so a test that needs
   * specific responses has to install them here rather than after render.
   */
  beforeMount?: (harness: AuthHarness) => void
  /** Mounts under `<StrictMode>`, as `main.tsx` does in development. */
  strict?: boolean
}

export interface RenderRouteResult extends RenderResult {
  harness: AuthHarness
  /** The memory router, for asserting on the current location. */
  router: ReturnType<typeof createMemoryRouter>
}

/**
 * Mounts the real route tree in a memory router, over an isolated FE-02
 * session.
 *
 * The same `routeTree` the browser uses, so a guard cannot pass in tests and
 * fail in the application. Pre-authentication goes through the real store -
 * login, or a persisted refresh token - rather than by faking a state, so the
 * bootstrap path is exercised too.
 */
export async function renderRoute({
  path = '/',
  as = null,
  width = viewports.wide,
  beforeMount,
  strict = false,
}: RenderRouteOptions = {}): Promise<RenderRouteResult> {
  setViewport(width)

  const harness = createAuthHarness()
  const user = as === 'admin' ? testAdmin : testUser

  if (as !== null) {
    stubSignIn(harness.http, { user })
    await harness.authStore.login({ email: user.email, password: 'correct-horse' })
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
  }

  // Feature routes now fetch. Default to an account with nothing enrolled and
  // an empty catalogue; a test that cares overrides these before asserting.
  harness.http.on('/me/enrollments', { json: emptyPage })
  harness.http.on('/courses', { json: emptyPage })
  // The course details page also asks whether the member is enrolled. 404 is
  // the backend's own answer for "not enrolled", so that is the default.
  harness.http.on('/content', { status: 404, json: { detail: 'Enrollment not found' } })
  harness.http.on('/modules', { json: emptyPage })
  // The learning pages record openings (FE-LEARNING-TRACKING-01); the backend
  // answers 201 with the stored event, which nothing reads.
  harness.http.on('/me/learning-events', { status: 201, json: {} })

  beforeMount?.(harness)

  const router = createMemoryRouter(routeTree, { initialEntries: [path] })

  const tree = (
    <AuthProvider store={harness.authStore}>
      <ApiClientProvider client={harness.apiClient}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </AuthProvider>
  )
  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree)

  return { ...result, harness, router }
}
