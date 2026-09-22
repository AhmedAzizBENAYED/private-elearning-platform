import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminCourses, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-ADMIN-DASHBOARD-01 - the Admin-Dashboard board's header and card links.
 *
 * "Add member" and "Create course" lead into the existing creation flows (the
 * member list's Add member dialog, the course form); "View published" and
 * "View drafts" open the course list on its own server-side status filter.
 */

const SUBTITLE = 'Overview of the members and courses of the platform.'

/** Counts for the cards (no `sort`), the recent listing (with `sort`), and the course list. */
function stubBoard(harness: AuthHarness) {
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on('/admin/courses', (call) => {
    const url = new URL(call.url)
    const status = url.searchParams.get('status')
    if (url.searchParams.get('page_size') === '1') {
      const total = status === 'PUBLISHED' ? 6 : status === 'DRAFT' ? 3 : 10
      return { json: { items: [], total, page: 1, page_size: 1 } }
    }
    const items = status === null ? adminCourses : adminCourses.filter((course) => course.status === status)
    return {
      json: {
        items: items.map((course) => ({ ...course, module_count: 0, lesson_count: 0 })),
        total: items.length,
        page: 1,
        page_size: 20,
      },
    }
  })
}

async function openBoard(width?: number) {
  const result = await renderRoute({
    path: '/admin',
    as: 'admin',
    beforeMount: stubBoard,
    ...(width ? { width } : {}),
  })
  await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
  return result
}

const header = () => screen.getByRole('heading', { name: 'Dashboard', level: 1 }).closest('header')!

describe('admin dashboard - header', () => {
  it('says what the board says, whoever is signed in', async () => {
    await openBoard()

    expect(within(header()).getByText(SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByText(/Welcome back/)).toBeNull()
  })

  it('offers the two header actions, in the board’s order', async () => {
    await openBoard()

    const actions = within(header()).getAllByRole('link').map((link) => link.textContent)
    expect(actions).toEqual(['Add member', 'Create course'])
  })

  it('"Add member" opens the member list with its Add member dialog', async () => {
    const { router, harness } = await openBoard()

    await userEvent.click(within(header()).getByRole('link', { name: 'Add member' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/members'))
    expect(await screen.findByRole('dialog', { name: 'Add a member' })).toBeInTheDocument()
    // Nothing is created by opening it.
    expect(harness.http.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/admin/members'))).toEqual(
      [],
    )
  })

  it('opens the dialog once: going back and forward does not reopen it', async () => {
    const { router } = await openBoard()
    await userEvent.click(within(header()).getByRole('link', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a member' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await router.navigate(-1)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    await router.navigate(1)

    await screen.findByRole('heading', { name: 'Members', level: 1 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Create course" opens the existing course form', async () => {
    const { router } = await openBoard()

    const create = within(header()).getByRole('link', { name: 'Create course' })
    expect(create).toHaveAttribute('href', '/admin/courses/new')
    await userEvent.click(create)

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/courses/new'))
  })
})

describe('admin dashboard - card links', () => {
  it.each([
    ['Published', 'View published', 'PUBLISHED', 6],
    ['Drafts', 'View drafts', 'DRAFT', 3],
  ])('%s opens the course list filtered by the server', async (label, action, status, count) => {
    const { router, harness } = await openBoard()

    const card = await screen.findByRole('link', { name: `${label}: ${count}. ${action}` })
    expect(card).toHaveAttribute('href', `/admin/courses?status=${status}`)
    await userEvent.click(card)

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/courses'))
    expect(router.state.location.search).toBe(`?status=${status}`)
    // The list asks the server for that status - it does not filter a full list.
    await waitFor(() => {
      const listing = harness.http
        .callsTo('/admin/courses')
        .map((call) => new URL(call.url))
        .filter((url) => url.searchParams.get('page_size') !== '1')
        .at(-1)
      expect(listing?.searchParams.get('status')).toBe(status)
    })
  })

  it('keeps the Members and Courses cards and the recent courses section', async () => {
    await openBoard()

    expect(await screen.findByRole('link', { name: /^Members: \d+\. Manage members$/ })).toHaveAttribute(
      'href',
      '/admin/members',
    )
    expect(screen.getByRole('link', { name: 'Courses: 10. Manage courses' })).toHaveAttribute('href', '/admin/courses')
    expect(screen.getByRole('region', { name: 'Recently created courses' })).toBeInTheDocument()
  })
})

describe('admin dashboard - responsive', () => {
  it.each([
    ['1440', viewports.wide],
    ['1024', viewports.laptop],
    ['768', viewports.tablet],
    ['390', viewports.mobile],
  ])('shows the header actions at %s px', async (_width, width) => {
    await openBoard(width)

    expect(within(header()).getByRole('link', { name: 'Add member' })).toBeInTheDocument()
    expect(within(header()).getByRole('link', { name: 'Create course' })).toBeInTheDocument()
    expect(within(header()).getByText(SUBTITLE)).toBeInTheDocument()
  })
})
