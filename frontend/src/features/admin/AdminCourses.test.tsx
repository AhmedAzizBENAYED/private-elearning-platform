import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminCourses, adminCoursesPage, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

const COURSES = '/admin/courses'
const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const ARCHIVED = adminCourses[2]!

/** The status a `/admin/courses` call asked for, or null for the whole list. */
const statusOf = (url: string) => new URL(url).searchParams.get('status')

/** Calls that read a page of rows, as opposed to the four tab counts. */
const listCalls = (harness: AuthHarness) =>
  harness.http
    .callsTo('/admin/courses')
    .filter((call) => new URL(call.url).searchParams.get('page_size') !== '1')

function stubCourses(harness: AuthHarness, page = adminCoursesPage()) {
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on('/admin/courses', (call) => {
    const status = statusOf(call.url)
    if (new URL(call.url).searchParams.get('page_size') === '1') {
      const items = status === null ? adminCourses : adminCourses.filter((c) => c.status === status)
      return { json: { items: items.slice(0, 1), total: items.length, page: 1, page_size: 1 } }
    }
    if (status === null) return { json: page }
    const items = page.items.filter((course) => course.status === status)
    return { json: { ...page, items, total: items.length } }
  })
}

const openCourses = (
  path = COURSES,
  beforeMount: (harness: AuthHarness) => void = stubCourses,
  width?: number,
) => renderRoute({ path, as: 'admin', beforeMount, ...(width ? { width } : {}) })

const rowFor = async (title: string) => {
  const table = await screen.findByRole('table')
  return within(table).getByRole('row', { name: new RegExp(title.replace(/[()]/g, '.')) })
}

/**
 * Opens a row's "More actions" (Admin-Courses) and returns the menu. Publish
 * and Archive live there since FE-ADMIN-COURSES-LIST-01, as the board draws.
 */
async function rowMenu(title: string) {
  await userEvent.click(within(await rowFor(title)).getByRole('button', { name: `More actions for ${title}` }))
  return screen.getByRole('menu', { name: `Actions for ${title}` })
}

async function chooseInMenu(title: string, action: string) {
  await userEvent.click(within(await rowMenu(title)).getByRole('menuitem', { name: action }))
}

/** The listing with each row's size, as `GET /admin/courses` returns it. */
const SIZES = [
  { module_count: 0, lesson_count: 0 },
  { module_count: 4, lesson_count: 16 },
  { module_count: 2, lesson_count: 8 },
]
const withSizes = () => adminCoursesPage(adminCourses.map((course, index) => ({ ...course, ...SIZES[index]! })))

describe('admin courses - routing', () => {
  it('lets an administrator open the course list', async () => {
    await openCourses()

    expect(await screen.findByRole('heading', { name: 'Courses', level: 1 })).toBeInTheDocument()
  })

  it('is reachable from the admin navigation', async () => {
    const { router } = await openCourses('/admin', (harness) => stubCourses(harness))
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    const nav = screen.getByRole('navigation', { name: 'Admin' })
    await userEvent.click(within(nav).getByRole('link', { name: 'Courses' }))

    expect(router.state.location.pathname).toBe(COURSES)
    expect(await screen.findByRole('heading', { name: 'Courses', level: 1 })).toBeInTheDocument()
  })

  it('keeps a member out of the admin courses area', async () => {
    const { harness } = await renderRoute({ path: COURSES, as: 'member' })

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('table')).toBeNull()
    expect(harness.http.calls.filter((call) => call.url.includes('/admin/'))).toEqual([])
  })

  it('opens the create route', async () => {
    await openCourses(`${COURSES}/new`)

    expect(
      await screen.findByRole('heading', { name: 'Create course', level: 1 }),
    ).toBeInTheDocument()
  })

  it('reads `new` as a route, never as a course id', async () => {
    const { harness } = await openCourses(`${COURSES}/new`)
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    expect(harness.http.callsTo('/admin/courses/new')).toHaveLength(0)
  })
})

describe('admin courses - the list', () => {
  it('holds the layout while the list is on its way', async () => {
    await openCourses(COURSES, (harness) => {
      harness.http.on('/admin/courses', () => new Promise(() => ({})))
    })

    expect(await screen.findByLabelText('Loading courses')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders the backend rows with a header for every column', async () => {
    await openCourses()
    const table = await screen.findByRole('table')

    // Admin-Courses: Course, Status, Modules, Lessons, Created, Modified.
    for (const column of ['Course', 'Status', 'Modules', 'Lessons', 'Created', 'Modified']) {
      expect(within(table).getByRole('columnheader', { name: column })).toBeInTheDocument()
    }

    const row = await rowFor(DRAFT.title)
    expect(within(row).getByRole('link', { name: DRAFT.title })).toHaveAttribute('href', `${COURSES}/${DRAFT.id}`)
    // The board shows no address under the title.
    expect(within(row).queryByText(DRAFT.slug)).toBeNull()
    expect(within(row).getByText('DRAFT')).toBeInTheDocument()
    expect(within(row).getAllByText('17 Sep 2026')).toHaveLength(2)
  })

  // The listing now carries `module_count` / `lesson_count` (CourseListItem);
  // this test used to pin their absence, from before the backend added them.
  it('shows the module and lesson counts the server returned', async () => {
    await openCourses(COURSES, (harness) => stubCourses(harness, withSizes()))

    const published = within(await rowFor(PUBLISHED.title)).getAllByRole('cell')
    // Status, Modules, Lessons, Created, Modified, actions.
    expect(published[1]).toHaveTextContent('4')
    expect(published[2]).toHaveTextContent('16')
    // A course with no module says so, as the board's "Empty course".
    expect(within(await rowFor(DRAFT.title)).getByText('Empty course')).toBeInTheDocument()
    expect(within(await rowFor(PUBLISHED.title)).queryByText('Empty course')).toBeNull()
  })

  it('invents no count for a row that arrives without one', async () => {
    await openCourses()

    const cells = within(await rowFor(PUBLISHED.title)).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('')
    expect(cells[2]).toHaveTextContent('')
    expect(screen.queryByText('Empty course')).toBeNull()
  })

  it('reports the server’s total, not the rows loaded', async () => {
    await openCourses(COURSES, (harness) =>
      stubCourses(harness, adminCoursesPage(adminCourses, { total: 10 })),
    )

    expect(await screen.findByText('10 courses')).toBeInTheDocument()
  })

  it('says so when there is no course at all', async () => {
    await openCourses(COURSES, (harness) =>
      stubCourses(harness, adminCoursesPage([], { total: 0 })),
    )

    expect(await screen.findByText('No courses yet')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /create course/i }).length).toBeGreaterThan(0)
  })

  it('reports a failed load and retries it', async () => {
    const { harness } = await openCourses(COURSES, (harness) => {
      stubCourses(harness)
      harness.http.once('/admin/courses', { status: 500, json: { detail: 'Traceback: internal' } })
    })

    expect(await screen.findByText('We couldn’t load the courses')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Traceback')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(listCalls(harness).length).toBeGreaterThanOrEqual(2)
  })

  it('handles a 403 from the API without showing a listing', async () => {
    await openCourses(COURSES, (harness) => {
      stubCourses(harness)
      harness.http.on('/admin/courses', { status: 403, json: { detail: 'Insufficient privileges' } })
    })

    expect(await screen.findByText('We couldn’t load the courses')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a dropped connection', async () => {
    await openCourses(COURSES, (harness) => {
      stubCourses(harness)
      harness.http.failNetwork('/admin/courses')
    })

    expect(await screen.findByText('We couldn’t load the courses')).toBeInTheDocument()
  })
})

describe('admin courses - filter, search and paging', () => {
  // FE-QA-FINAL-01: the filter is not a dense table, so each chip is a 44px
  // target (Handoff-A11y), as the board's 48px tabs are.
  it('makes each status filter a 44px target', async () => {
    await openCourses()
    const group = await screen.findByRole('group', { name: 'Filter by status' })

    for (const chip of within(group).getAllByRole('button')) {
      expect(getComputedStyle(chip).minHeight).toBe('var(--tap-target)')
    }
  })

  it('counts each status on the server, one row at a time', async () => {
    const { harness } = await openCourses()
    await screen.findByRole('table')

    const group = screen.getByRole('group', { name: 'Filter by status' })
    expect(await within(group).findByRole('button', { name: 'All: 3' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Draft: 1' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Published: 1' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Archived: 1' })).toBeInTheDocument()

    const counts = harness.http
      .callsTo('/admin/courses')
      .filter((call) => new URL(call.url).searchParams.get('page_size') === '1')
    expect(counts).toHaveLength(4)
  })

  it('sends the chosen status to the backend', async () => {
    const { harness, router } = await openCourses()
    await screen.findByRole('table')

    const group = screen.getByRole('group', { name: 'Filter by status' })
    await userEvent.click(within(group).getByRole('button', { name: /^Draft/ }))

    expect(router.state.location.search).toBe('?status=DRAFT')
    await waitFor(() => expect(statusOf(listCalls(harness).at(-1)!.url)).toBe('DRAFT'))
  })

  it('marks the chosen tab as pressed', async () => {
    await openCourses(`${COURSES}?status=PUBLISHED`)
    await screen.findByRole('table')

    const group = screen.getByRole('group', { name: 'Filter by status' })
    expect(within(group).getByRole('button', { name: /^Published/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(group).getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('sends the search term to the backend', async () => {
    const { harness } = await openCourses()
    await screen.findByRole('table')

    await userEvent.type(screen.getByPlaceholderText('Search courses'), 'excel')

    await waitFor(() =>
      expect(listCalls(harness).some((call) => call.url.includes('search=excel'))).toBe(true),
    )
  })

  it('restores status and search from the URL', async () => {
    const { harness } = await openCourses(`${COURSES}?search=data&status=PUBLISHED`)
    await screen.findByRole('table')

    const params = new URL(listCalls(harness)[0]!.url).searchParams
    expect(params.get('search')).toBe('data')
    expect(params.get('status')).toBe('PUBLISHED')
    expect(screen.getByPlaceholderText('Search courses')).toHaveValue('data')
  })

  it('offers a way back when a filter matches nothing', async () => {
    const { router } = await openCourses(`${COURSES}?status=ARCHIVED`, (harness) =>
      stubCourses(harness, adminCoursesPage([], { total: 0 })),
    )

    expect(await screen.findByText('No archived courses')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show all courses' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('pages through the server’s pages', async () => {
    const { harness, router } = await openCourses(COURSES, (harness) =>
      stubCourses(harness, adminCoursesPage(adminCourses, { total: 48 })),
    )
    await screen.findByRole('table')

    const pager = screen.getByRole('navigation', { name: 'Course pages' })
    await userEvent.click(within(pager).getByRole('button', { name: /next/i }))

    expect(router.state.location.search).toBe('?page=2')
    await waitFor(() =>
      expect(new URL(listCalls(harness).at(-1)!.url).searchParams.get('page')).toBe('2'),
    )
  })
})

describe('admin courses - lifecycle actions on a row', () => {
  it('offers only the transition the lifecycle allows', async () => {
    await openCourses()

    const items = async (title: string) => {
      const menu = await rowMenu(title)
      const labels = within(menu).getAllByRole('menuitem').map((item) => item.textContent)
      await userEvent.keyboard('{Escape}')
      return labels
    }

    expect(await items(DRAFT.title)).toEqual(['View details', 'Edit course', 'Publish'])
    expect(await items(PUBLISHED.title)).toEqual(['View details', 'Archive'])
    expect(await items(ARCHIVED.title)).toEqual(['View details'])
  })

  // Admin-Courses: "Edit" on every row opens the course editor; the course's
  // own information ("Edit course") can change only while it is a draft.
  it('opens the editor from Edit, and offers Edit course only while the course is a draft', async () => {
    await openCourses()

    for (const course of [DRAFT, PUBLISHED, ARCHIVED]) {
      expect(
        within(await rowFor(course.title)).getByRole('link', { name: `Edit ${course.title}` }),
      ).toHaveAttribute('href', `${COURSES}/${course.id}`)
    }
    const draftMenu = await rowMenu(DRAFT.title)
    expect(within(draftMenu).getByRole('menuitem', { name: 'Edit course' })).toHaveAttribute(
      'href',
      `${COURSES}/${DRAFT.id}/edit`,
    )
    expect(within(draftMenu).getByRole('menuitem', { name: 'View details' })).toHaveAttribute(
      'href',
      `${COURSES}/${DRAFT.id}`,
    )
    await userEvent.keyboard('{Escape}')
    expect(within(await rowMenu(PUBLISHED.title)).queryByRole('menuitem', { name: 'Edit course' })).toBeNull()
  })

  it('asks before publishing, and writes nothing until confirmed', async () => {
    const { harness } = await openCourses()

    await chooseInMenu(DRAFT.title, 'Publish')

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: `Publish “${DRAFT.title}”?` }),
    ).toBeInTheDocument()
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/publish`)).toHaveLength(0)
  })

  it('cancels without writing', async () => {
    const { harness } = await openCourses()

    await chooseInMenu(DRAFT.title, 'Publish')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.callsTo(`/admin/courses/${DRAFT.id}/publish`)).toHaveLength(0)
  })

  it('publishes and refreshes the list from the server', async () => {
    const published = { ...DRAFT, status: 'PUBLISHED' as const }
    const { harness } = await openCourses(COURSES, (harness) => {
      stubCourses(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, { json: DRAFT })
      harness.http.on(`/admin/courses/${DRAFT.id}/publish`, { json: published })
    })

    await chooseInMenu(DRAFT.title, 'Publish')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish course' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const call = harness.http.callsTo(`/admin/courses/${DRAFT.id}/publish`)[0]!
    expect(call.method).toBe('POST')
    // The list is re-read rather than patched in place, so the badge comes from
    // the server and not from the request that was sent.
    await waitFor(() => expect(listCalls(harness).length).toBeGreaterThanOrEqual(2))
  })

  // FE-QA-FINAL-01 (G30): Admin-Courses-States, "Feedback · toasts".
  it('confirms a publication with the board’s toast, and an archive with none', async () => {
    const PUB = adminCourses[1]!
    await openCourses(COURSES, (harness) => {
      stubCourses(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, { json: DRAFT })
      harness.http.on(`/admin/courses/${DRAFT.id}/publish`, { json: { ...DRAFT, status: 'PUBLISHED' } })
      harness.http.on(`/admin/courses/${PUB.id}`, { json: PUB })
      harness.http.on(`/admin/courses/${PUB.id}/archive`, { json: { ...PUB, status: 'ARCHIVED' } })
    })

    await chooseInMenu(DRAFT.title, 'Publish')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish course' }),
    )

    const status = await screen.findByRole('status')
    expect(await within(status).findByText('Course published')).toBeInTheDocument()
    expect(within(status).getByText(`“${DRAFT.title}” is now visible to members.`)).toBeInTheDocument()

    await userEvent.click(within(status).getByRole('button', { name: 'Dismiss' }))
    await chooseInMenu(PUB.title, 'Archive')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive course' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('Course published')).toBeNull()
  })

  it('explains a refused transition without showing it as done', async () => {
    await openCourses(COURSES, (harness) => {
      stubCourses(harness)
      harness.http.on(`/admin/courses/${DRAFT.id}`, { json: DRAFT })
      harness.http.on(`/admin/courses/${DRAFT.id}/publish`, {
        status: 409,
        json: { detail: 'Cannot transition ARCHIVED to PUBLISHED' },
      })
    })

    await chooseInMenu(DRAFT.title, 'Publish')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish course' }),
    )

    expect(await screen.findByText(/no longer in a state that allows this change/i)).toBeInTheDocument()
    expect(within(await rowFor(DRAFT.title)).getByText('DRAFT')).toBeInTheDocument()
  })
})

describe('admin courses - on a phone', () => {
  // Admin-Mobile-Courses draws a card per course rather than the table.
  it('shows a card per course, with its actions reachable', async () => {
    await openCourses(COURSES, stubCourses, viewports.mobile)

    const list = await screen.findByRole('list', { name: 'Courses' })
    expect(screen.queryByRole('table')).toBeNull()
    expect(within(list).getAllByRole('listitem')).toHaveLength(adminCourses.length)
    expect(screen.getByRole('link', { name: /create course/i })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: `Edit ${DRAFT.title}` })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: `More actions for ${DRAFT.title}` })).toBeInTheDocument()
  })
})
