import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { REFRESH_TOKEN_KEY } from '../features/auth/refreshTokenStorage'
import { adminCourses, catalogEnrolled, page } from '../test/courseFixtures'
import { renderRoute } from '../test/renderRoute'
import { safeExternalUrl } from '../shared/safeExternalUrl'

/**
 * FE-15 - the security properties this frontend is responsible for.
 *
 * Authorization itself belongs to the backend and is measured there; what is
 * pinned here is what the browser does: which credentials it stores and where,
 * what it puts in a URL, what it renders into an `href`, and what it shows a
 * member when the server refuses.
 */

const DRAFT = adminCourses[0]!

// ----------------------------------------------- URLs that reach an href

describe('backend-supplied URLs are re-checked before they reach an href', () => {
  it('accepts http and https and nothing else', () => {
    expect(safeExternalUrl('https://example.org/a')).toBe('https://example.org/a')
    expect(safeExternalUrl('http://example.org/')).toBe('http://example.org/')

    for (const hostile of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.org/abc',
      'not a url',
      '',
      null,
      undefined,
    ]) {
      expect(safeExternalUrl(hostile)).toBeNull()
    }
  })

  it('does not render a hostile thumbnail address as a link', async () => {
    await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        // The backend types this field as HttpUrl and would answer 422, so this
        // value could only arrive from a compromised or changed server. The
        // browser must still refuse to make it clickable.
        harness.http.on(`/admin/courses/${DRAFT.id}`, {
          json: { ...DRAFT, thumbnail_url: 'javascript:alert(document.cookie)' },
        })
        harness.http.on(`/admin/courses/${DRAFT.id}/modules`, { json: page([]) })
        harness.http.on(`/admin/courses/${DRAFT.id}/resources`, { json: [] })
      },
    })
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    // Admin-Course-Editor shows the thumbnail as an image (FE-ADMIN-COURSE-
    // EDITOR-01), so the address must reach neither an anchor nor an image: the
    // navy tile stands in, and "Remove" lets the administrator clear the value
    // (still readable in the "Edit course" form's Thumbnail URL field).
    const thumbnail = screen.getByRole('group', { name: 'Thumbnail' })
    expect(thumbnail.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove thumbnail' })).toBeInTheDocument()
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
    for (const image of document.querySelectorAll('img')) {
      expect(image.getAttribute('src') ?? '').not.toMatch(/^javascript:/i)
    }
  })

  it('shows a legitimate https thumbnail as the image', async () => {
    await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        harness.http.on(`/admin/courses/${DRAFT.id}`, {
          json: { ...DRAFT, thumbnail_url: 'https://cdn.example.org/cover.png' },
        })
        harness.http.on(`/admin/courses/${DRAFT.id}/modules`, { json: page([]) })
        harness.http.on(`/admin/courses/${DRAFT.id}/resources`, { json: [] })
      },
    })
    await screen.findByRole('heading', { name: DRAFT.title, level: 1 })

    // The board draws the image itself, no longer the address as a link.
    const image = screen.getByRole('group', { name: 'Thumbnail' }).querySelector('img')
    expect(image).toHaveAttribute('src', 'https://cdn.example.org/cover.png')
    expect(screen.queryByRole('link', { name: 'https://cdn.example.org/cover.png' })).toBeNull()
  })
})

// ------------------------------------------------------- credential handling

describe('credentials', () => {
  it('never puts a token in a request URL', async () => {
    const { harness } = await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => expect(harness.http.calls.length).toBeGreaterThan(1))

    for (const call of harness.http.calls) {
      expect(call.url).not.toMatch(/token|password|secret|authorization=/i)
    }
  })

  it('sends the session in the Authorization header, and only there', async () => {
    const { harness } = await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => expect(harness.http.calls.length).toBeGreaterThan(1))

    const authenticated = harness.http.calls.filter((call) => call.url.includes('/me/'))
    expect(authenticated.length).toBeGreaterThan(0)
    for (const call of authenticated) {
      expect(call.headers.authorization).toMatch(/^Bearer \S+$/)
      // Nothing authenticating is duplicated into the body of a GET.
      expect(call.body).toBeUndefined()
    }
  })

  it('keeps only the refresh token in web storage, and nothing else', async () => {
    const { harness } = await renderRoute({ path: '/dashboard', as: 'member' })
    await screen.findByRole('heading', { level: 1 })

    // The access token - the credential that actually authorizes requests -
    // lives in a closure and must never be persisted.
    expect([...harness.storage.keys()]).toEqual([REFRESH_TOKEN_KEY])
  })

  it('clears every stored credential on sign-out', async () => {
    const { harness, router } = await renderRoute({ path: '/dashboard', as: 'member' })
    await screen.findByRole('button', { name: /Iyed Belghith/ })

    await userEvent.click(screen.getByRole('button', { name: /Iyed Belghith/ }))
    const menu = await screen.findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: /sign out|log out/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(harness.storage.get(REFRESH_TOKEN_KEY)).toBeUndefined()
    expect(harness.authStore.getState().status).toBe('unauthenticated')
    expect(harness.authStore.getState().user).toBeNull()

    // Nothing signed leaves the app afterwards.
    const after = harness.http.calls.length
    await userEvent.click(document.body)
    expect(harness.http.calls.slice(after).every((call) => !call.headers.authorization)).toBe(true)
  })
})

// --------------------------------------------------------- route protection

describe('route protection reflects the backend model', () => {
  it('sends an anonymous visitor to sign-in instead of a protected page', async () => {
    for (const path of ['/dashboard', '/courses', '/admin', '/admin/members', '/admin/courses']) {
      const { router, harness } = await renderRoute({ path })
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
      // No protected read is attempted on the way.
      expect(harness.http.calls.filter((call) => call.url.includes('/admin/'))).toEqual([])
    }
  })

  it('keeps a member out of the admin area and asks the server for nothing there', async () => {
    for (const path of ['/admin', '/admin/members', '/admin/courses', `/admin/courses/${DRAFT.id}`]) {
      // Scoped to this render: the loop mounts several in one document.
      const { harness, container } = await renderRoute({ path, as: 'member' })
      const view = within(container)

      // The guard renders a refusal rather than the page.
      await waitFor(() =>
        expect(view.getByRole('heading', { name: /don.t have access/i })).toBeInTheDocument(),
      )
      expect(view.queryByRole('navigation', { name: 'Admin' })).toBeNull()
      expect(harness.http.calls.filter((call) => call.url.includes('/api/v1/admin/'))).toEqual([])
    }
  })

  it('shows a member no administration entry point', async () => {
    await renderRoute({ path: '/dashboard', as: 'member' })
    await screen.findByRole('navigation', { name: 'Main' })

    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toContain('/admin')
    }
  })
})

// ------------------------------------------------- refusals reveal nothing

describe('server refusals are reported without internal detail', () => {
  it('shows no traceback, path or query when a read fails', async () => {
    await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (harness) =>
        harness.http.on('/courses', {
          status: 500,
          json: {
            detail:
              'Traceback (most recent call last): File "/srv/app/services/course_service.py", '
              + 'line 88, in list\n  SELECT * FROM courses WHERE 1=1 -- asyncpg.exceptions',
          },
        }),
    })
    await screen.findByRole('heading', { name: /couldn’t load the courses/i })

    const rendered = document.body.textContent ?? ''
    for (const secret of ['Traceback', '/srv/app', 'SELECT', 'asyncpg', 'course_service.py']) {
      expect(rendered).not.toContain(secret)
    }
  })

  it('does not treat a 403 as an expired session', async () => {
    const { harness, router } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      beforeMount: (harness) =>
        harness.http.on(`/courses/${catalogEnrolled.id}`, {
          status: 403,
          json: { detail: 'Forbidden' },
        }),
    })
    await waitFor(() =>
      expect(
        harness.http.calls.some((call) => call.url.includes(`/courses/${catalogEnrolled.id}`)),
      ).toBe(true),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    // The session bootstrap refreshes exactly once on mount. A 403 handled as
    // if it were a 401 would add a second one - only 401 may refresh, because
    // a 403 is a decision about permissions, not about the token.
    expect(
      harness.http.calls.filter((call) => call.url.includes('/auth/refresh')).length,
    ).toBeLessThanOrEqual(1)
    // And the session is untouched: not signed out, not bounced to login.
    expect(router.state.location.pathname).not.toBe('/login')
    expect(harness.authStore.getState().status).toBe('authenticated')
  })

  it('refreshes once on a 401 and does not loop', async () => {
    const { harness } = await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (harness) => {
        // The access token is stale and the refreshed one is refused too.
        harness.http.on('/courses', { status: 401, json: { detail: 'Not authenticated' } })
      },
    })
    await waitFor(() =>
      expect(harness.http.calls.filter((call) => call.url.includes('/courses?'))).not.toEqual([]),
    )

    await new Promise((resolve) => setTimeout(resolve, 100))
    const settled = harness.http.calls.length

    // At most one original attempt plus one replay, after at most one refresh
    // per attempt: the retry calls the transport directly instead of
    // re-entering the client, so a second 401 cannot start a third round.
    expect(
      harness.http.calls.filter((call) => call.url.includes('/courses?')).length,
    ).toBeLessThanOrEqual(2)
    expect(
      harness.http.calls.filter((call) => call.url.includes('/auth/refresh')).length,
    ).toBeLessThanOrEqual(2)

    // And it has stopped: nothing further is attempted once it has settled.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(harness.http.calls.length).toBe(settled)
  })
})
