import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import indexHtml from '../../index.html?raw'
import { catalogEnrolled, courseContent } from '../test/courseFixtures'
import type { AuthHarness } from '../test/authHarness'
import { renderRoute } from '../test/renderRoute'
import { viewports } from '../test/viewport'

/** The learning route reads one course tree; `abc` is the course in these tests. */
const LESSON_ID = courseContent.modules[0]?.lessons[0]?.id ?? ''

function stubLearning(harness: AuthHarness) {
  harness.http.on('/courses/abc/content', { json: courseContent })
}

describe('public routing', () => {
  it('renders the login page at /login', async () => {
    await renderRoute({ path: '/login' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })
  })

  it('renders the 404 page for an unknown route', async () => {
    await renderRoute({ path: '/nope' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'We can’t find this page' })).toBeInTheDocument()
    })
    expect(screen.getByText('Error 404')).toBeInTheDocument()
  })

  // FE-QA-FINAL-01: an unknown path under /admin is answered by the admin
  // subtree, so it goes through the same guards as every admin URL.
  it('answers an unknown admin path with the 404 inside the admin shell', async () => {
    await renderRoute({ path: '/admin/nope', as: 'admin' })

    expect(await screen.findByRole('heading', { name: 'We can’t find this page' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    // One shell, not the admin shell wrapped around a second one.
    expect(screen.getAllByRole('navigation', { name: 'Admin' })).toHaveLength(1)
  })

  it('shows a member the 403 page on an unknown admin path, as on any admin path', async () => {
    await renderRoute({ path: '/admin/courses/abc/nope', as: 'member' })

    expect(
      await screen.findByRole('heading', { name: 'You don’t have access to this page' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Error 404')).toBeNull()
  })

  it('sends a visitor on an unknown admin path to sign in', async () => {
    const { router } = await renderRoute({ path: '/admin/nope' })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  // LANDING-01: `/` is the public landing page (Data-Needs "Routing
  // proposal"), no longer a redirect. A visitor stays on it, with Sign in.
  it('keeps a signed-out visitor on the public landing page at /', async () => {
    const { router } = await renderRoute({ path: '/' })

    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('bootstrap state', () => {
  it('shows the loading screen and never flashes login while the session is unknown', async () => {
    // A persisted refresh token with a refresh that never resolves keeps the
    // store in `unknown`, which is exactly the window a flash would happen in.
    const { harness, router } = await renderRoute({ path: '/dashboard' })
    harness.storage.set('jeeniso.auth.refresh_token', 'refresh-1')
    harness.http.on('/auth/refresh', () => new Promise<never>(() => undefined))

    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    // The URL is preserved while waiting, so the deep link still works after.
    expect(router.state.location.pathname).toBe('/dashboard')
  })
})

describe('unauthenticated access', () => {
  it.each(['/dashboard', '/courses', '/courses/abc', '/admin', '/admin/members'])(
    'redirects %s to /login',
    async (path) => {
      const { router } = await renderRoute({ path })

      // findBy* retries until the page has actually painted. Waiting on
      // router.state instead would resolve one render too early.
      expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/login')
    },
  )

  it('remembers where the person was going', async () => {
    const { router } = await renderRoute({ path: '/courses/abc' })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect((router.state.location.state as { from?: { pathname: string } }).from?.pathname).toBe(
      '/courses/abc',
    )
  })
})

describe('member access', () => {
  it.each([
    ['/dashboard', 'Welcome back, Iyed'],
    ['/courses', 'Courses'],
  ])('allows %s', async (path, heading) => {
    await renderRoute({ path, as: 'member' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
    })
  })

  it('allows /courses/:courseId', async () => {
    await renderRoute({
      path: '/courses/abc',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/courses/abc', { json: catalogEnrolled })
      },
    })

    expect(
      await screen.findByRole('heading', { name: 'Python Fundamentals', level: 1 }),
    ).toBeInTheDocument()
  })

  it('renders a deep link directly, without navigating from the list first', async () => {
    const path = `/courses/abc/lessons/${LESSON_ID}`
    const { router } = await renderRoute({ path, as: 'member', beforeMount: stubLearning })

    expect(
      await screen.findByRole('heading', { name: 'Introduction', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(path)
  })

  it('allows /courses/:courseId/lessons/:lessonId', async () => {
    await renderRoute({
      path: `/courses/abc/lessons/${LESSON_ID}`,
      as: 'member',
      beforeMount: stubLearning,
    })

    expect(
      await screen.findByRole('heading', { name: 'Introduction', level: 1 }),
    ).toBeInTheDocument()
  })

  it('sends an already signed-in member away from /login', async () => {
    const { router } = await renderRoute({ path: '/login', as: 'member' })

    expect(
      await screen.findByRole('heading', { name: 'Welcome back, Iyed', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  // LANDING-01: a signed-in member reaches the dashboard from the landing
  // page's "Go to my dashboard", which leads to the role's own landing.
  it('offers a signed-in member the way to their dashboard from /', async () => {
    const { router } = await renderRoute({ path: '/', as: 'member' })

    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getAllByRole('link', { name: /Go to my dashboard/ })[0]).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })
})

describe('admin authorization', () => {
  it.each(['/admin', '/admin/members', '/admin/courses'])('allows an admin on %s', async (path) => {
    await renderRoute({ path, as: 'admin' })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })
  })

  it('sends an already signed-in admin from /login to /admin', async () => {
    const { router } = await renderRoute({ path: '/login', as: 'admin' })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin')
    })
  })

  it.each(['/admin', '/admin/members', '/admin/courses', '/admin/courses/abc'])(
    'shows a member the 403 page on %s, never the admin UI',
    async (path) => {
      await renderRoute({ path, as: 'member' })

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'You don’t have access to this page' }),
        ).toBeInTheDocument()
      })
      expect(screen.getByText('Error 403')).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument()
    },
  )

  it('keeps the member navigation on the 403 page so there is a way out', async () => {
    await renderRoute({ path: '/admin', as: 'member' })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument()
  })
})

describe('navigation', () => {
  it('marks the current page with aria-current and follows a link', async () => {
    const { router } = await renderRoute({ path: '/dashboard', as: 'member' })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })
    expect(screen.getByRole('link', { name: 'Courses' })).not.toHaveAttribute('aria-current')

    await userEvent.click(screen.getByRole('link', { name: 'Courses' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/courses')
    })
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps /admin unmarked while a child admin route is active', async () => {
    await renderRoute({ path: '/admin/members', as: 'admin' })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page')
    })
    // `/admin` is the parent of every admin route; without `end` it would stay lit.
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('supports browser back and forward', async () => {
    const { router } = await renderRoute({ path: '/dashboard', as: 'member' })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Courses' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('link', { name: 'Courses' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/courses')
    })

    router.navigate(-1)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })

    router.navigate(1)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/courses')
    })
  })
})

describe('role-scoped navigation', () => {
  it('gives a member no admin links', async () => {
    await renderRoute({ path: '/dashboard', as: 'member' })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument()
  })

  it('gives an admin the administration navigation', async () => {
    await renderRoute({ path: '/admin', as: 'admin' })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })
    for (const label of ['Dashboard', 'Members', 'Courses']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})

// FE-QA-FIX-01 (G36): the browser tab names the application, as the landing
// overline does, not the design-system gallery it started from.
describe('document title', () => {
  it('names the learning platform', () => {
    const title = new DOMParser().parseFromString(indexHtml, 'text/html').title
    expect(title).toBe('JEENISo · Learning platform')
    expect(title).not.toMatch(/design system/i)
  })
})

describe('logout', () => {
  it('returns the person to the login page through the FE-02 action', async () => {
    const { router } = await renderRoute({ path: '/dashboard', as: 'member' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Iyed Belghith/ })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Iyed Belghith/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('clears the persisted session on sign out', async () => {
    const { harness } = await renderRoute({ path: '/admin', as: 'admin' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(harness.authStore.getState().status).toBe('unauthenticated')
    })
    expect(harness.accessTokens.get()).toBeNull()
    expect(harness.refreshTokens.read()).toBeNull()
  })
})

describe('responsive shell', () => {
  it('gives a member the header navigation on desktop and no bottom bar', async () => {
    await renderRoute({ path: '/dashboard', as: 'member', width: viewports.desktop })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('gives a member the bottom bar on a phone', async () => {
    await renderRoute({ path: '/dashboard', as: 'member', width: viewports.mobile })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument()
    })
    // Exactly one Main landmark: the header nav is not rendered at this width.
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1)
  })

  it('hides the bottom bar on the learning page', async () => {
    await renderRoute({
      path: `/courses/abc/lessons/${LESSON_ID}`,
      as: 'member',
      width: viewports.mobile,
      beforeMount: stubLearning,
    })

    await screen.findByRole('heading', { name: 'Introduction', level: 1 })
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument()
  })

  it('gives an admin the expanded sidebar on a laptop', async () => {
    await renderRoute({ path: '/admin', as: 'admin', width: viewports.laptop })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument()
  })

  it('gives an admin the icon rail on a tablet', async () => {
    await renderRoute({ path: '/admin', as: 'admin', width: viewports.tablet })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })
    // Icons only: the label survives as the accessible name.
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument()
  })

  // FE-QA-FINAL-01: Handoff-A11y, "Interactive elements ≥ 44 px (36 px small
  // buttons only in dense desktop tables)". The expanded sidebar's Sign out is
  // not in a table, so it is the 44px `md` button, not the 36px `sm` one.
  it('gives the expanded admin sidebar a 44px Sign out', async () => {
    await renderRoute({ path: '/admin', as: 'admin', width: viewports.wide })

    const nav = await screen.findByRole('navigation', { name: 'Admin' })
    const signOut = within(nav.parentElement!).getByRole('button', { name: 'Sign out' })
    expect(getComputedStyle(signOut).height).toBe('var(--control-h-md)')
  })

  // FE-ADMIN-SHELL-01 (Admin-Tablet): the rail ends with an icon-only Sign
  // out, and the top bar carries the account chip with My profile.
  it('lets an admin sign out from the icon rail on a tablet', async () => {
    const { router, harness } = await renderRoute({ path: '/admin', as: 'admin', width: viewports.tablet })

    const nav = await screen.findByRole('navigation', { name: 'Admin' })
    // Visible straight away, without opening anything.
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(nav.parentElement).toContainElement(signOut)

    await userEvent.click(signOut)

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('opens the admin’s own profile from the top bar chip on a tablet', async () => {
    const { router } = await renderRoute({ path: '/admin', as: 'admin', width: viewports.tablet })

    await userEvent.click(await screen.findByRole('button', { name: /Amal Dridi/ }))
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(screen.getByRole('menuitem', { name: 'My profile' })).toHaveFocus()
    expect(menu).toContainElement(screen.getByRole('menuitem', { name: 'Sign out' }))

    await userEvent.click(screen.getByRole('menuitem', { name: 'My profile' }))

    // The administration profile, inside the admin shell - not the member one.
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/profile'))
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
  })

  it.each([
    ['laptop', viewports.laptop],
    ['phone', viewports.mobile],
  ])('keeps the account chip off the admin top bar on a %s', async (_name, width) => {
    await renderRoute({ path: '/admin', as: 'admin', width })

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    expect(screen.queryByRole('button', { name: /Amal Dridi/ })).not.toBeInTheDocument()
  })

  it('keeps one labelled Sign out in the expanded sidebar on a laptop', async () => {
    await renderRoute({ path: '/admin', as: 'admin', width: viewports.laptop })

    await screen.findByRole('navigation', { name: 'Admin' })
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'My profile — Amal Dridi, Administrator' })).toBeInTheDocument()
  })

  it('gives an admin a drawer on a phone', async () => {
    await renderRoute({ path: '/admin', as: 'admin', width: viewports.mobile })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    const drawer = screen.getByRole('dialog', { name: 'Administration menu' })
    expect(drawer).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
  })

  it('closes the drawer after following a link', async () => {
    const { router } = await renderRoute({ path: '/admin', as: 'admin', width: viewports.mobile })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    await userEvent.click(screen.getByRole('link', { name: 'Members' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(router.state.location.pathname).toBe('/admin/members')
  })

  // FE-MOBILE-01 (G32): Admin-Mobile-Nav names the drawer's identity block by
  // where it leads - "My profile" - not by the role.
  it.each([
    ['390', viewports.mobile],
    ['375', 375],
    ['599', 599],
  ])('says "My profile" under the name in the drawer at %spx', async (_name, width) => {
    const { router } = await renderRoute({ path: '/admin', as: 'admin', width })

    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Administration menu' })

    const identity = within(drawer).getByRole('link', { name: 'My profile — Amal Dridi' })
    expect(identity).toHaveTextContent('Amal Dridi')
    expect(identity).toHaveTextContent('My profile')
    expect(identity).not.toHaveTextContent('Administrator')
    expect(identity).toHaveAttribute('href', '/admin/profile')

    await userEvent.click(identity)
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/profile'))
    expect(screen.queryByRole('dialog', { name: 'Administration menu' })).toBeNull()
  })

  it('keeps the role under the name in the expanded sidebar', async () => {
    await renderRoute({ path: '/admin', as: 'admin', width: viewports.laptop })

    const identity = await screen.findByRole('link', { name: 'My profile — Amal Dridi, Administrator' })
    expect(identity).toHaveTextContent('Administrator')
    expect(identity).not.toHaveTextContent('My profile')
  })
})
