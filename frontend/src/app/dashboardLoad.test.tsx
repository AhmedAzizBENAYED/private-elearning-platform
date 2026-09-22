import { StrictMode } from 'react'

import { render, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ApiClientProvider } from '../api'
import { routeTree } from './router'
import { AuthProvider } from '../features/auth'
import { REFRESH_TOKEN_KEY } from '../features/auth/refreshTokenStorage'
import type { AuthHarness } from '../test/authHarness'
import { createAuthHarness, stubSignIn, testAdmin } from '../test/authHarness'
import { adminCourses, membersPage, page } from '../test/courseFixtures'
import { renderRoute } from '../test/renderRoute'
import { setViewport, viewports } from '../test/viewport'

/**
 * FE-18-BIS - how the administration board loads.
 *
 * A real browser showed five dashboard requests cancelled and five more taking
 * ~2.6 s. Two separate things were behind that, and only the tests for what
 * was actually confirmed live here:
 *
 *  - the cancelled set is React's StrictMode double-invoking effects in
 *    development. The hooks abort on cleanup, which is what StrictMode exists
 *    to exercise; it is not a defect and it does not happen in a production
 *    build. Asserted below so the abort-on-cleanup contract cannot be dropped.
 *
 *  - the 2.6 s was connection establishment, not the server. `uvicorn --reload`
 *    binds 127.0.0.1 (IPv4 only) while the front end was configured to call
 *    `localhost`, which resolves to ::1 first on Windows; the refused IPv6
 *    connect takes ~2 s to give up before falling back. That is configuration,
 *    not code: `frontend/.env.example` now names 127.0.0.1 and explains why.
 *    Vite refuses to import .env files, so it is documented there rather than
 *    asserted here.
 *
 * The hypothesis that the board mounted before authentication settled was
 * investigated and **disproved** - `AuthBootstrapGate` already holds the tree.
 * The first test pins that, so a later change cannot reintroduce it.
 */

const RECENT = 'sort=-created_at'

function stubBoard(harness: AuthHarness) {
  harness.http.on('/admin/members', { json: membersPage([], { total: 48 }) })
  harness.http.on('/admin/courses', (call) =>
    new URL(call.url).searchParams.get('sort') === null
      ? { json: { items: [], total: 10, page: 1, page_size: 1 } }
      : { json: page(adminCourses.map((c) => ({ ...c, module_count: 3, lesson_count: 8 }))) },
  )
}

const adminCalls = (harness: AuthHarness) =>
  harness.http.calls.filter((call) => call.url.includes('/admin/'))

describe('admin dashboard - load sequence', () => {
  it('issues no dashboard request until the session is settled', async () => {
    // The order the harness records is the order the application asked for:
    // every /admin/ call must come after the bootstrap has answered, because
    // AuthBootstrapGate renders nothing while the status is unknown.
    const { harness } = await renderRoute({ path: '/admin', as: 'admin', beforeMount: stubBoard })
    await within(document.body).findByRole('link', { name: /^Members: / })

    const urls = harness.http.calls.map((call) => call.url)
    const firstAdmin = urls.findIndex((url) => url.includes('/admin/'))
    const me = urls.findIndex((url) => url.includes('/auth/me'))

    expect(firstAdmin).toBeGreaterThan(-1)
    expect(me).toBeGreaterThan(-1)
    // /auth/me is the last step of the bootstrap, and it precedes the board.
    expect(me).toBeLessThan(firstAdmin)
  })

  it('sends an abort signal with every dashboard request', async () => {
    // What makes the cancelled set in the browser *correct* rather than a
    // leak: each request is attached to an AbortController the effect cleans
    // up. Without a signal, an unmount would leave the response to land on a
    // dead component instead of being cancelled.
    const { harness } = await renderRoute({ path: '/admin', as: 'admin', beforeMount: stubBoard })
    await within(document.body).findByRole('link', { name: /^Members: / })

    const admin = adminCalls(harness)
    expect(admin).toHaveLength(5)
    for (const call of admin) {
      expect(call.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('asks for each dashboard URL exactly once per mount', async () => {
    const { harness } = await renderRoute({ path: '/admin', as: 'admin', beforeMount: stubBoard })
    await within(document.body).findByRole('link', { name: /^Members: / })

    const admin = adminCalls(harness)
    expect(admin).toHaveLength(5)
    expect(new Set(admin.map((call) => call.url)).size).toBe(5)
    expect(admin.filter((call) => call.url.includes(RECENT))).toHaveLength(1)
  })

  it('under StrictMode asks twice and still renders one correct board', async () => {
    // Development double-invoke, reproduced. The point is not the count - that
    // is React's behaviour, not the application's - but that the board survives
    // it: one set of figures, one table, no duplicated rows, no crash.
    setViewport(viewports.wide)
    const harness = createAuthHarness()
    stubSignIn(harness.http, { user: testAdmin })
    await harness.authStore.login({ email: testAdmin.email, password: 'correct-horse' })
    harness.storage.set(REFRESH_TOKEN_KEY, 'refresh-1')
    harness.http.on('/auth/refresh', { json: { access_token: 'access-2', token_type: 'bearer' } })
    stubBoard(harness)

    const router = createMemoryRouter(routeTree, { initialEntries: ['/admin'] })
    const { container } = render(
      <StrictMode>
        <AuthProvider store={harness.authStore}>
          <ApiClientProvider client={harness.apiClient}>
            <RouterProvider router={router} />
          </ApiClientProvider>
        </AuthProvider>
      </StrictMode>,
    )
    const view = within(container)

    await view.findByRole('link', { name: /^Members: / })
    await view.findByRole('heading', { name: 'Recently created courses', level: 2 })
    await waitFor(() => expect(view.queryByLabelText(/Loading recently/)).toBeNull())

    const admin = adminCalls(harness)
    // Two per URL, never three: the effect runs twice, not in a loop.
    expect(new Set(admin.map((call) => call.url)).size).toBe(5)
    for (const url of new Set(admin.map((call) => call.url))) {
      expect(admin.filter((call) => call.url === url)).toHaveLength(2)
    }
    // And the screen shows one board, not two.
    expect(view.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(view.getAllByRole('link', { name: /^Members: / })).toHaveLength(1)
    expect(view.getAllByRole('table')).toHaveLength(1)
  })
})
