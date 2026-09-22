import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import type { MockResponse, RouteHandler } from '../../test/fetchMock'
import { adminCourses, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-17 - "Recently created courses" on the administration board.
 *
 * The counts are the server's: `CourseListItem` carries `module_count` and
 * `lesson_count`, computed on the one statement that reads the page. Nothing
 * in these tests lets the component invent, derive or default them, and the
 * N+1 test pins the request count so a later refactor cannot start fetching
 * modules per row.
 */

/** `Page[CourseListItem]` rows: the admin course, plus its size. */
const SIZES: Record<string, { module_count: number; lesson_count: number }> = {
  [adminCourses[0]!.id]: { module_count: 0, lesson_count: 0 },
  [adminCourses[1]!.id]: { module_count: 3, lesson_count: 8 },
  [adminCourses[2]!.id]: { module_count: 12, lesson_count: 47 },
}

const summaries = adminCourses.map((course) => ({ ...course, ...SIZES[course.id]! }))

const EXCEL = summaries[0]!
const DATA = summaries[1]!
const NETWORKING = summaries[2]!

/** Newest first, which is what `sort=-created_at` asks the database for. */
const newestFirst = [EXCEL, DATA, NETWORKING]

function recentPage(items = newestFirst) {
  return { items, total: items.length, page: 1, page_size: 5 }
}

/**
 * The four KPI counts, plus the recent listing.
 *
 * `/admin/courses` serves both: the counting calls send no `sort`, the listing
 * does, which is exactly how the page tells them apart.
 */
function stubBoard(
  harness: AuthHarness,
  listing: MockResponse | RouteHandler = { json: recentPage() },
) {
  harness.http.on('/admin/members', { json: membersPage([], { total: 48 }) })
  harness.http.on('/admin/courses', (call) => {
    if (new URL(call.url).searchParams.get('sort') === null) {
      return { json: { items: [], total: 10, page: 1, page_size: 1 } }
    }
    return typeof listing === 'function' ? listing(call) : listing
  })
}

const openBoard = (
  beforeMount: (harness: AuthHarness) => void = (harness) => stubBoard(harness),
  width?: number,
) => renderRoute({ path: '/admin', as: 'admin', beforeMount, ...(width ? { width } : {}) })

/** The recent-courses table, identified by the heading that labels it. */
async function recentTable(): Promise<HTMLElement> {
  await screen.findByRole('heading', { name: 'Recently created courses', level: 2 })
  const tables = screen.getAllByRole('table')
  const found = tables.find((table) => within(table).queryByText('Modules') !== null)
  expect(found).toBeDefined()
  return found!
}

const rowFor = (table: HTMLElement, title: string) =>
  within(table).getByRole('rowheader', { name: new RegExp(title.slice(0, 12), 'i') }).closest('tr')!

describe('admin dashboard - recently created courses', () => {
  it('loads the section and shows a row per course', async () => {
    await openBoard()

    const table = await recentTable()
    // The header row plus one per course; no placeholder, no filler.
    expect(within(table).getAllByRole('row')).toHaveLength(newestFirst.length + 1)
  })

  it('asks the server for the five newest and lets it do the ordering', async () => {
    const { harness } = await openBoard()
    await recentTable()

    const listing = harness.http.calls
      .map((call) => new URL(call.url))
      .find((url) => url.searchParams.get('sort') !== null)!

    expect(listing.pathname).toBe('/api/v1/admin/courses')
    expect(listing.searchParams.get('sort')).toBe('-created_at')
    expect(listing.searchParams.get('page')).toBe('1')
    expect(listing.searchParams.get('page_size')).toBe('5')
  })

  it('renders the rows in the order the server returned them', async () => {
    await openBoard()

    const table = await recentTable()
    const titles = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent)

    expect(titles).toEqual(newestFirst.map((course) => course.title))
    // And that really is newest first, by the dates the rows carry.
    const dates = newestFirst.map((course) => Date.parse(course.created_at))
    expect(dates).toEqual([...dates].sort((left, right) => right - left))
  })

  it('shows the course title', async () => {
    await openBoard()

    const table = await recentTable()
    for (const course of newestFirst) {
      expect(within(table).getByText(course.title)).toBeInTheDocument()
    }
  })

  it('shows a long title in full rather than cutting it off', async () => {
    const long = 'A course whose title is far longer than the column it is drawn in'
    await openBoard((harness) =>
      stubBoard(harness, { json: recentPage([{ ...EXCEL, title: long }]) }),
    )

    const table = await recentTable()
    expect(within(table).getByText(long)).toBeInTheDocument()
  })

  it('shows the status with the design-system badge', async () => {
    await openBoard()

    const table = await recentTable()
    expect(within(rowFor(table, EXCEL.title)).getByText('DRAFT')).toBeInTheDocument()
    expect(within(rowFor(table, DATA.title)).getByText('PUBLISHED')).toBeInTheDocument()
    expect(within(rowFor(table, NETWORKING.title)).getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('shows the module count the server returned', async () => {
    await openBoard()

    const table = await recentTable()
    const cells = within(rowFor(table, DATA.title)).getAllByRole('cell')
    // Status, Modules, Lessons, Created, Open.
    expect(cells[1]).toHaveTextContent('3')
  })

  it('shows the lesson count the server returned', async () => {
    await openBoard()

    const table = await recentTable()
    expect(within(rowFor(table, DATA.title)).getAllByRole('cell')[2]).toHaveTextContent('8')
  })

  it('shows a real zero for a course with nothing in it', async () => {
    await openBoard()

    const table = await recentTable()
    const cells = within(rowFor(table, EXCEL.title)).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('0')
    expect(cells[2]).toHaveTextContent('0')
  })

  it('never invents a count when the server omits one', async () => {
    // A row without the fields must not quietly become "0": the column would
    // then be a claim about the course rather than a reading of it.
    const { module_count: _modules, lesson_count: _lessons, ...bare } = DATA
    await openBoard((harness) => stubBoard(harness, { json: recentPage([bare as never]) }))

    const table = await recentTable()
    const cells = within(rowFor(table, DATA.title)).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('')
    expect(cells[2]).toHaveTextContent('')
  })

  it('shows the creation date in the format the design writes', async () => {
    await openBoard()

    const table = await recentTable()
    const created = within(rowFor(table, EXCEL.title)).getAllByRole('cell')[3]!
    expect(created).toHaveTextContent('17 Sep 2026')
    expect(within(created).getByText('17 Sep 2026').tagName).toBe('TIME')
    expect(within(created).getByText('17 Sep 2026')).toHaveAttribute(
      'datetime',
      EXCEL.created_at,
    )
  })

  it('opens the course detail page through the route helper', async () => {
    const { router } = await openBoard()
    const table = await recentTable()

    const open = within(rowFor(table, DATA.title)).getByRole('link', {
      name: `Open ${DATA.title}`,
    })
    expect(open).toHaveAttribute('href', `/admin/courses/${DATA.id}`)

    await userEvent.click(open)

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/admin/courses/${DATA.id}`),
    )
  })

  it('leads to the course list from All courses', async () => {
    const { router } = await openBoard()
    await recentTable()

    const all = screen.getByRole('link', { name: /All courses/ })
    expect(all).toHaveAttribute('href', '/admin/courses')

    await userEvent.click(all)

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/courses'))
  })

  it('holds exactly one link per row, so nothing is nested', async () => {
    await openBoard()

    const table = await recentTable()
    for (const course of newestFirst) {
      const links = within(rowFor(table, course.title)).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAccessibleName(`Open ${course.title}`)
    }
  })

  it('labels every column', async () => {
    await openBoard()

    const table = await recentTable()
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)

    expect(headers).toEqual(['Course', 'Status', 'Modules', 'Lessons', 'Created', 'Actions'])
  })

  it('shows a loading state without inventing rows', async () => {
    let release = () => undefined as void
    const held = new Promise<void>((resolve) => {
      release = () => resolve()
    })

    await openBoard((harness) =>
      stubBoard(harness, async () => {
        await held
        return { json: recentPage() }
      }),
    )

    expect(await screen.findByLabelText('Loading recently created courses')).toBeInTheDocument()
    // Nothing that could be mistaken for a course is on screen yet.
    expect(screen.queryByText(EXCEL.title)).toBeNull()
    expect(screen.queryByText('Modules')).toBeNull()

    release()
    await recentTable()
    expect(screen.queryByLabelText('Loading recently created courses')).toBeNull()
  })

  it('shows the empty state rather than an empty table', async () => {
    await openBoard((harness) => stubBoard(harness, { json: recentPage([]) }))

    expect(await screen.findByRole('heading', { name: 'No courses yet', level: 3 })).toBeInTheDocument()
    // The section's own call to action; the page header has its own
    // "Create course" too since FE-ADMIN-DASHBOARD-01.
    const section = screen.getByRole('region', { name: 'Recently created courses' })
    expect(within(section).getByRole('link', { name: /Create course/ })).toHaveAttribute(
      'href',
      '/admin/courses/new',
    )
    expect(screen.queryByText('Modules')).toBeNull()
  })

  it('reports a failure without leaking anything internal', async () => {
    await openBoard((harness) =>
      stubBoard(harness, {
        status: 500,
        json: { detail: 'SELECT * FROM courses failed at /app/repositories/course_repository.py' },
      }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t load the recent courses')
    for (const leak of ['SELECT', 'course_repository', '/app/', 'Traceback', 'Bearer']) {
      expect(alert.textContent).not.toContain(leak)
    }
  })

  it('keeps the figures above it when only the table fails', async () => {
    await openBoard((harness) =>
      stubBoard(harness, { status: 500, json: { detail: 'boom' } }),
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('link', { name: 'Members: 48. Manage members' })).toBeInTheDocument()
  })

  it('reloads the section when the retry is used', async () => {
    let attempt = 0
    const { harness } = await openBoard((instance) =>
      stubBoard(instance, () => {
        attempt += 1
        return attempt === 1
          ? { status: 500, json: { detail: 'boom' } }
          : { json: recentPage() }
      }),
    )

    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))

    const table = await recentTable()
    expect(within(table).getByText(DATA.title)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    // Exactly one further listing request, not a loop.
    const listings = harness.http.calls.filter(
      (call) => new URL(call.url).searchParams.get('sort') !== null,
    )
    expect(listings).toHaveLength(2)
  })

  it('costs one request for the whole table, whatever it contains', async () => {
    const { harness } = await openBoard()
    await recentTable()

    const listings = harness.http.calls.filter(
      (call) => new URL(call.url).searchParams.get('sort') !== null,
    )
    expect(listings).toHaveLength(1)

    // No follow-up per course, and none per module: the counts came with the row.
    for (const call of harness.http.calls) {
      expect(call.url).not.toMatch(/\/modules(\?|$)/)
      expect(call.url).not.toMatch(/\/lessons(\?|$)/)
      for (const course of newestFirst) {
        expect(call.url).not.toContain(`/admin/courses/${course.id}`)
      }
    }
  })

  it.each([viewports.mobile, viewports.tablet, viewports.laptop, viewports.desktop, viewports.wide])(
    'renders the section at %ipx',
    async (width) => {
      await openBoard(undefined, width)

      const table = await recentTable()
      expect(within(table).getByText(DATA.title)).toBeInTheDocument()
      expect(within(table).getByRole('link', { name: `Open ${DATA.title}` })).toBeInTheDocument()
      // The card is the element that scrolls sideways, so the page body does
      // not; jsdom computes no layout, so this asserts the rule, not the pixels.
      expect(table.parentElement).toHaveClass(/scroll/)
    },
  )
})
