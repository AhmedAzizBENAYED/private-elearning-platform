import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminMembers, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

const MEMBERS = '/admin/members'
const SARRA = adminMembers[0]!
const YASSINE = adminMembers[2]!

/** The four counts the landing page reads, plus the member list. */
function stubAdmin(harness: AuthHarness) {
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on('/admin/courses', { json: { items: [], total: 10, page: 1, page_size: 1 } })
}

const openAdmin = (path: string, beforeMount: (harness: AuthHarness) => void = stubAdmin, width?: number) =>
  renderRoute({ path, as: 'admin', beforeMount, ...(width ? { width } : {}) })

/** The `is_active` parameter a call carried, or null when it sent none. */
const isActiveOf = (url: string) => new URL(url).searchParams.get('is_active')

describe('admin - route protection', () => {
  it('lets an administrator open the dashboard', async () => {
    await openAdmin('/admin')

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
  })

  it('lets an administrator open the member list', async () => {
    await openAdmin(MEMBERS)

    expect(await screen.findByRole('heading', { name: 'Members', level: 1 })).toBeInTheDocument()
  })

  it('shows a member the access-denied page instead of admin content', async () => {
    const { harness } = await renderRoute({ path: MEMBERS, as: 'member' })

    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Members')
    expect(screen.queryByRole('table')).toBeNull()
    // The guard renders before any admin page mounts, so no admin request is
    // ever made. The backend refuses these routes independently.
    expect(harness.http.calls.filter((call) => call.url.includes('/admin/'))).toEqual([])
  })

  it('sends an unauthenticated visitor to the existing login flow', async () => {
    const { router } = await renderRoute({ path: MEMBERS })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})

describe('admin - shell', () => {
  it('renders the administration navigation', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('heading', { name: 'Members', level: 1 })

    const nav = screen.getByRole('navigation', { name: 'Admin' })
    for (const label of ['Dashboard', 'Members', 'Courses']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('highlights the route being viewed', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('heading', { name: 'Members', level: 1 })

    const nav = screen.getByRole('navigation', { name: 'Admin' })
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('offers the existing sign-out action', async () => {
    const { harness } = await openAdmin(MEMBERS)
    await screen.findByRole('heading', { name: 'Members', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(harness.authStore.getState().status).toBe('unauthenticated'))
  })
})

describe('admin - dashboard', () => {
  it('shows only counts the backend actually returns', async () => {
    await openAdmin('/admin', (harness) => {
      harness.http.on('/admin/members', { json: membersPage([], { total: 48 }) })
      harness.http.on('/admin/courses', (call) => {
        const status = new URL(call.url).searchParams.get('status')
        const total = status === 'PUBLISHED' ? 6 : status === 'DRAFT' ? 3 : 10
        return { json: { items: [], total, page: 1, page_size: 1 } }
      })
    })

    const members = await screen.findByRole('link', { name: 'Members: 48. Manage members' })
    expect(members).toHaveAttribute('href', MEMBERS)
    expect(screen.getByRole('link', { name: 'Courses: 10. Manage courses' })).toBeInTheDocument()
    // Admin-Dashboard: "View published" / "View drafts", each to its filter.
    expect(screen.getByRole('link', { name: 'Published: 6. View published' })).toHaveAttribute(
      'href',
      '/admin/courses?status=PUBLISHED',
    )
    expect(screen.getByRole('link', { name: 'Drafts: 3. View drafts' })).toHaveAttribute(
      'href',
      '/admin/courses?status=DRAFT',
    )
  })

  it('reads each count with one row, never a listing', async () => {
    const { harness } = await openAdmin('/admin')
    await screen.findByRole('link', { name: /^Members: / })

    // The recent-courses table is the one request that is meant to be a
    // listing; every other admin call on this page exists to read a total.
    const counting = harness.http.calls.filter(
      (entry) =>
        entry.url.includes('/admin/') && new URL(entry.url).searchParams.get('sort') === null,
    )
    expect(counting.length).toBe(4)
    for (const call of counting) {
      expect(new URL(call.url).searchParams.get('page_size')).toBe('1')
    }
  })

  /* ---- FE-18 ------------------------------------------------------------ */

  it('no longer claims course management is coming in a later ticket', async () => {
    await openAdmin('/admin')
    await screen.findByRole('link', { name: /^Members: / })

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('later ticket')
    expect(text).not.toContain('Where to go next')
    expect(screen.queryByRole('heading', { name: 'Where to go next' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Go to members/ })).toBeNull()
  })

  it('keeps the approved structure: a heading, four cards, and the table', async () => {
    await openAdmin('/admin', (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/courses', (call) =>
        new URL(call.url).searchParams.get('sort') === null
          ? { json: { items: [], total: 10, page: 1, page_size: 1 } }
          : { json: { items: [], total: 0, page: 1, page_size: 5 } },
      )
    })

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    for (const label of ['Members', 'Courses', 'Published', 'Drafts']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}: `) })).toBeInTheDocument()
    }
    // Exactly one <h2> remains, the one the design draws.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(headings).toEqual(['Recently created courses'])
  })

  it('loads the board with five requests, in parallel and without duplicates', async () => {
    // FE-18 regression guard. The board is deliberately five parallel reads
    // rather than one aggregate: measurement showed the aggregate would save
    // about 13 ms on loopback and roughly nothing over a real network, where
    // the five share one round trip, while coupling the failure of the figures
    // to the failure of the table. This pins that decision - a silent drift
    // back to sequential reads, a duplicate, or a per-course request fails here.
    const { harness } = await openAdmin('/admin', (instance) => {
      stubAdmin(instance)
      instance.http.on('/admin/courses', (call) =>
        new URL(call.url).searchParams.get('sort') === null
          ? { json: { items: [], total: 10, page: 1, page_size: 1 } }
          : { json: { items: [], total: 0, page: 1, page_size: 5 } },
      )
    })
    await screen.findByRole('link', { name: /^Members: / })
    await screen.findByRole('heading', { name: 'Recently created courses', level: 2 })

    const admin = harness.http.calls.filter((call) => call.url.includes('/admin/'))
    expect(admin).toHaveLength(5)
    expect(new Set(admin.map((call) => call.url)).size).toBe(5)

    // Parallel: all five were issued before any of them was answered. The
    // harness records a call when it is made, so the four counts and the
    // listing are all present by the time the first result is rendered.
    const paths = admin.map((call) => new URL(call.url).pathname + new URL(call.url).search)
    expect(paths.filter((path) => path.includes('sort=-created_at'))).toHaveLength(1)
    expect(paths.filter((path) => path.includes('page_size=1'))).toHaveLength(4)

    // And no N+1: nothing is fetched per course, per module or per lesson.
    for (const call of harness.http.calls) {
      expect(call.url).not.toMatch(/\/modules(\?|$)/)
      expect(call.url).not.toMatch(/\/lessons(\?|$)/)
    }
  })

  it('reports a failure rather than showing partial figures', async () => {
    await openAdmin('/admin', (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/courses', { status: 500, json: { detail: 'boom' } })
    })

    expect(await screen.findByText('We couldn’t load the overview')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Members: / })).toBeNull()
    expect(document.body.textContent).not.toContain('boom')
  })

  it('retries the counts', async () => {
    await openAdmin('/admin', (harness) => {
      stubAdmin(harness)
      harness.http.once('/admin/courses', { status: 503, json: { detail: 'later' } })
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: /^Members: 3/ })).toBeInTheDocument()
  })
})

describe('admin - member list', () => {
  it('holds the layout while the list is on its way', async () => {
    await openAdmin(MEMBERS, (harness) => {
      harness.http.on('/admin/members', () => new Promise(() => ({})))
    })

    expect(await screen.findByLabelText('Loading members')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders the real rows, with a header for every column', async () => {
    await openAdmin(MEMBERS)

    const table = await screen.findByRole('table')
    for (const column of ['Member', 'Email', 'Status', 'Created']) {
      expect(within(table).getByRole('columnheader', { name: column })).toBeInTheDocument()
    }

    const row = within(table).getByRole('row', { name: /Sarra Mansour/ })
    expect(within(row).getByText(SARRA.email)).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getByText('12 Sep 2026')).toBeInTheDocument()
  })

  it('shows the inactive badge from the backend flag, not from a guess', async () => {
    await openAdmin(MEMBERS)
    const table = await screen.findByRole('table')

    const row = within(table).getByRole('row', { name: /Ben Ammar/ })
    expect(within(row).getByText('Inactive')).toBeInTheDocument()
  })

  it('reports the server’s own total, not the number of rows loaded', async () => {
    await openAdmin(MEMBERS, (harness) => {
      harness.http.on('/admin/members', { json: membersPage(adminMembers, { total: 48 }) })
      harness.http.on('/admin/courses', { json: { items: [], total: 0, page: 1, page_size: 1 } })
    })

    expect(await screen.findByText('48 members')).toBeInTheDocument()
    expect(screen.getByText('Showing 3 of 48 members')).toBeInTheDocument()
  })

  it('exposes no credential of any kind', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('table')

    const markup = document.body.innerHTML
    for (const secret of ['hashed_password', 'activation_token', 'Bearer ', 'password']) {
      expect(markup).not.toContain(secret)
    }
  })

  it('says so when no member exists at all', async () => {
    await openAdmin(MEMBERS, (harness) => {
      harness.http.on('/admin/members', { json: membersPage([], { total: 0 }) })
      harness.http.on('/admin/courses', { json: { items: [], total: 0, page: 1, page_size: 1 } })
    })

    expect(await screen.findByText('No members yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('offers a way out when a search matches nothing', async () => {
    const { router } = await openAdmin(`${MEMBERS}?search=trab`, (harness) => {
      harness.http.on('/admin/members', { json: membersPage([], { total: 0 }) })
      harness.http.on('/admin/courses', { json: { items: [], total: 0, page: 1, page_size: 1 } })
    })

    expect(await screen.findByText('No member matches “trab”')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  // FE-QA-FIX-01 (G13): a list emptied by the status filter alone must not
  // keep that filter after "Clear search", or the way out leads nowhere.
  it.each([
    ['the status filter alone', `${MEMBERS}?status=inactive`, 'No member matches this filter'],
    ['a search and the status filter', `${MEMBERS}?search=trab&status=active`, 'No member matches “trab”'],
  ])('clears every filter behind an empty result: %s', async (_case, path, title) => {
    const { router, harness } = await openAdmin(path, (harness) => {
      harness.http.on('/admin/members', { json: membersPage([], { total: 0 }) })
      harness.http.on('/admin/courses', { json: { items: [], total: 0, page: 1, page_size: 1 } })
    })

    expect(await screen.findByText(title)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all')
    expect(screen.getByRole('searchbox', { name: 'Search members' })).toHaveValue('')
    // The list is read again with no filter at all.
    await waitFor(() => {
      const last = harness.http.callsTo('/admin/members').at(-1)!
      expect(isActiveOf(last.url)).toBeNull()
      expect(new URL(last.url).searchParams.get('search')).toBeNull()
    })
  })

  it('reports a failed load and retries it', async () => {
    const { harness } = await openAdmin(MEMBERS, (harness) => {
      stubAdmin(harness)
      harness.http.once('/admin/members', { status: 500, json: { detail: 'Traceback: internal' } })
    })

    expect(await screen.findByText('We couldn’t load the members')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Traceback')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(harness.http.callsTo('/admin/members').length).toBeGreaterThanOrEqual(2)
  })

  it('handles a 403 from the API without showing a listing', async () => {
    await openAdmin(MEMBERS, (harness) => {
      stubAdmin(harness)
      harness.http.on('/admin/members', {
        status: 403,
        json: { detail: 'Insufficient privileges' },
      })
    })

    expect(await screen.findByText('We couldn’t load the members')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a dropped connection', async () => {
    await openAdmin(MEMBERS, (harness) => {
      stubAdmin(harness)
      harness.http.failNetwork('/admin/members')
    })

    expect(await screen.findByText('We couldn’t load the members')).toBeInTheDocument()
  })
})

describe('admin - filter row layout', () => {
  it('starts both filters at the same top edge', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('table')

    const search = screen.getByPlaceholderText('Search members')
    const select = screen.getByLabelText('Status')
    const row = search.closest('div[class*="field"]')!.parentElement!

    // One row, two fields, neither pushed down by the other's height.
    expect(row).toContainElement(select)
    expect(getComputedStyle(row).alignItems).toBe('flex-start')
  })

  it('hides both labels visually, so the two controls sit on one line', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('table')

    const labels = [...document.querySelectorAll('label[for]')]
    const searchLabel = labels.find((label) => label.textContent === 'Search members')!
    const statusLabel = labels.find((label) => label.textContent === 'Status')!

    // Clipped, not removed: each control keeps its accessible name, and
    // neither field carries a label row that would offset the other.
    expect(searchLabel.className).toMatch(/labelHidden/)
    expect(statusLabel.className).toMatch(/labelHidden/)
    expect(getComputedStyle(statusLabel).display).not.toBe('none')
  })

  it('keeps both controls reachable by their accessible names', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('table')

    expect(screen.getByRole('searchbox', { name: 'Search members' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument()
  })
})

describe('admin - search, filter and paging', () => {
  it('sends the search term to the backend, not a local filter', async () => {
    const { harness } = await openAdmin(MEMBERS)
    await screen.findByRole('table')

    await userEvent.type(screen.getByPlaceholderText('Search members'), 'trab')

    await waitFor(() =>
      expect(harness.http.callsTo('/admin/members').some((call) => call.url.includes('search=trab'))).toBe(true),
    )
  })

  it('maps the status filter onto is_active', async () => {
    const { harness } = await openAdmin(MEMBERS)
    await screen.findByRole('table')

    // The unfiltered load must not send the parameter at all.
    expect(isActiveOf(harness.http.callsTo('/admin/members')[0]!.url)).toBeNull()

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'inactive')

    await waitFor(() => {
      const last = harness.http.callsTo('/admin/members').at(-1)!
      expect(isActiveOf(last.url)).toBe('false')
    })
  })

  it('restores search and filter from the URL on a refresh', async () => {
    const { harness } = await openAdmin(`${MEMBERS}?search=mehdi&status=active`)
    await screen.findByRole('table')

    const call = harness.http.callsTo('/admin/members')[0]!
    const params = new URL(call.url).searchParams
    expect(params.get('search')).toBe('mehdi')
    expect(params.get('is_active')).toBe('true')
    expect(screen.getByPlaceholderText('Search members')).toHaveValue('mehdi')
  })

  it('pages through the server’s pages', async () => {
    const { harness, router } = await openAdmin(MEMBERS, (harness) => {
      harness.http.on('/admin/members', { json: membersPage(adminMembers, { total: 48 }) })
      harness.http.on('/admin/courses', { json: { items: [], total: 0, page: 1, page_size: 1 } })
    })
    await screen.findByRole('table')

    const pager = screen.getByRole('navigation', { name: 'Member pages' })
    await userEvent.click(within(pager).getByRole('button', { name: /next/i }))

    expect(router.state.location.search).toBe('?page=2')
    await waitFor(() => {
      const last = harness.http.callsTo('/admin/members').at(-1)!
      expect(new URL(last.url).searchParams.get('page')).toBe('2')
    })
  })

  it('shows no pager when one page covers everything', async () => {
    await openAdmin(MEMBERS)
    await screen.findByRole('table')

    expect(screen.queryByRole('navigation', { name: 'Member pages' })).toBeNull()
  })
})

describe('admin - member detail', () => {
  const detailPath = `${MEMBERS}/${SARRA.id}`

  function stubDetail(harness: AuthHarness, member = SARRA) {
    stubAdmin(harness)
    harness.http.on(`/admin/members/${member.id}`, { json: member })
  }

  it('opens from the list', async () => {
    const { router } = await openAdmin(MEMBERS, (harness) => stubDetail(harness))
    const table = await screen.findByRole('table')

    await userEvent.click(within(table).getByRole('link', { name: 'Sarra Mansour' }))

    expect(router.state.location.pathname).toBe(detailPath)
    expect(
      await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 }),
    ).toBeInTheDocument()
  })

  it('shows the fields the backend returns', async () => {
    await openAdmin(detailPath, (harness) => stubDetail(harness))
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    expect(screen.getAllByText(SARRA.email).length).toBeGreaterThan(0)
    // Admin-Member-View draws the role as the uppercase chip, in the identity
    // card and again under Account information (FE-ADMIN-MEMBERS-MENU-01).
    expect(screen.getAllByText('MEMBER')).toHaveLength(2)
    expect(screen.getAllByText('12 Sep 2026').length).toBeGreaterThan(0)
  })

  it('holds the layout while the record loads', async () => {
    await openAdmin(detailPath, (harness) => {
      stubAdmin(harness)
      harness.http.on(`/admin/members/${SARRA.id}`, () => new Promise(() => ({})))
    })

    expect(await screen.findByLabelText('Loading member')).toBeInTheDocument()
  })

  it('reports an unknown member', async () => {
    await openAdmin(detailPath, (harness) => {
      stubAdmin(harness)
      harness.http.on(`/admin/members/${SARRA.id}`, {
        status: 404,
        json: { detail: 'Member not found' },
      })
    })

    expect(await screen.findByText('Member not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to members/i })).toHaveAttribute('href', MEMBERS)
  })

  it('reports a refused read', async () => {
    await openAdmin(detailPath, (harness) => {
      stubAdmin(harness)
      harness.http.on(`/admin/members/${SARRA.id}`, {
        status: 403,
        json: { detail: 'Insufficient privileges' },
      })
    })

    expect(await screen.findByText('Access denied')).toBeInTheDocument()
  })

  it('retries a failed read', async () => {
    const { harness } = await openAdmin(detailPath, (harness) => {
      stubDetail(harness)
      harness.http.once(`/admin/members/${SARRA.id}`, { status: 500, json: { detail: 'x' } })
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 }),
    ).toBeInTheDocument()
    expect(harness.http.callsTo(`/admin/members/${SARRA.id}`)).toHaveLength(2)
  })
})

describe('admin - changing account access', () => {
  const detailPath = `${MEMBERS}/${SARRA.id}`
  const statusPath = `/admin/members/${SARRA.id}/status`

  function stubDetail(harness: AuthHarness, member = SARRA) {
    stubAdmin(harness)
    harness.http.on(`/admin/members/${member.id}`, { json: member })
  }

  it('asks before deactivating, and writes nothing until confirmed', async () => {
    const { harness } = await openAdmin(detailPath, (harness) => stubDetail(harness))
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Deactivate this account?' })).toBeInTheDocument()
    expect(harness.http.callsTo(statusPath)).toHaveLength(0)
  })

  it('cancels without writing', async () => {
    const { harness } = await openAdmin(detailPath, (harness) => stubDetail(harness))
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.callsTo(statusPath)).toHaveLength(0)
  })

  it('closes on Escape without writing', async () => {
    const { harness } = await openAdmin(detailPath, (harness) => stubDetail(harness))
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.callsTo(statusPath)).toHaveLength(0)
  })

  it('sends exactly { is_active: false } and shows the row the server returned', async () => {
    const { harness } = await openAdmin(detailPath, (harness) => {
      stubDetail(harness)
      harness.http.on(statusPath, { json: { ...SARRA, is_active: false } })
    })
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByRole('button', { name: 'Activate account' })).toBeInTheDocument()

    const call = harness.http.callsTo(statusPath)[0]!
    expect(call.method).toBe('PATCH')
    expect(JSON.parse(call.body ?? '{}')).toEqual({ is_active: false })
    // The badge follows the server's answer, not the request that was sent.
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0)
  })

  it('activates an inactive account', async () => {
    const { harness } = await openAdmin(`${MEMBERS}/${YASSINE.id}`, (harness) => {
      stubDetail(harness, YASSINE)
      harness.http.on(`/admin/members/${YASSINE.id}/status`, { json: { ...YASSINE, is_active: true } })
    })
    await screen.findByRole('heading', { name: 'Yassine Ben Ammar', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activate' }))

    expect(await screen.findByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
    const call = harness.http.callsTo(`/admin/members/${YASSINE.id}/status`)[0]!
    expect(JSON.parse(call.body ?? '{}')).toEqual({ is_active: true })
  })

  it('explains the backend’s last-administrator refusal', async () => {
    await openAdmin(detailPath, (harness) => {
      stubDetail(harness)
      harness.http.on(statusPath, {
        status: 409,
        json: { detail: 'Cannot deactivate the last active administrator' },
      })
    })
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }))

    expect(
      await screen.findByText(/last active administrator, so the account cannot be deactivated/i),
    ).toBeInTheDocument()
    // Still active: nothing is shown as done that the server refused.
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
  })

  it('reports a failed write without claiming success', async () => {
    await openAdmin(detailPath, (harness) => {
      stubDetail(harness)
      harness.http.on(statusPath, { status: 500, json: { detail: 'Traceback: internal' } })
    })
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Traceback')
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
  })
})

describe('admin - on a phone', () => {
  it('keeps the table usable and the menu reachable', async () => {
    await openAdmin(MEMBERS, stubAdmin, viewports.mobile)

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  })
})
