import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminCourses, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-ADMIN-COURSES-LIST-01 - the course list as Admin-Courses, Admin-Tablet
 * and Admin-Mobile-Courses draw it: newest first, the size of each course,
 * its thumbnail, "Edit" into the editor and a "More actions" menu, a narrow
 * table on a tablet and cards on a phone.
 *
 * Every filter is the server's: status, search, page and now sort all travel
 * as `GET /admin/courses` query parameters.
 */

const COURSES = '/admin/courses'
const DRAFT = adminCourses[0]!
const PUBLISHED = adminCourses[1]!
const THUMB = 'https://cdn.example.org/thumbs/excel.jpg'

const rows = adminCourses.map((course, index) => ({
  ...course,
  thumbnail_url: index === 0 ? THUMB : null,
  module_count: [0, 4, 2][index]!,
  lesson_count: [0, 16, 8][index]!,
}))

/** Calls that read a page of rows, as opposed to the four tab counts. */
const listCalls = (harness: AuthHarness) =>
  harness.http
    .callsTo('/admin/courses')
    .map((call) => new URL(call.url))
    .filter((url) => url.searchParams.get('page_size') !== '1')

function stub(harness: AuthHarness, items = rows) {
  harness.http.on('/admin/members', { json: membersPage() })
  harness.http.on('/admin/courses', (call) => {
    const url = new URL(call.url)
    const status = url.searchParams.get('status')
    const matching = status === null ? items : items.filter((course) => course.status === status)
    if (url.searchParams.get('page_size') === '1') {
      return { json: { items: matching.slice(0, 1), total: matching.length, page: 1, page_size: 1 } }
    }
    return { json: { items: matching, total: matching.length, page: 1, page_size: 20 } }
  })
}

const open = (path = COURSES, width?: number, items = rows) =>
  renderRoute({
    path,
    as: 'admin',
    beforeMount: (harness) => stub(harness, items),
    ...(width ? { width } : {}),
  })

describe('course list - what the server is asked', () => {
  it('asks for the newest first, and leaves the tab counts unsorted', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    expect(listCalls(harness).at(-1)!.searchParams.get('sort')).toBe('-created_at')
    const counts = harness.http
      .callsTo('/admin/courses')
      .map((call) => new URL(call.url))
      .filter((url) => url.searchParams.get('page_size') === '1')
    expect(counts.length).toBeGreaterThan(0)
    for (const url of counts) expect(url.searchParams.get('sort')).toBeNull()
  })

  it('sends the status, the search and the sort together, from the URL', async () => {
    const { harness } = await open(`${COURSES}?status=DRAFT&search=excel`)
    await screen.findByRole('table')

    const params = listCalls(harness).at(-1)!.searchParams
    expect(params.get('status')).toBe('DRAFT')
    expect(params.get('search')).toBe('excel')
    expect(params.get('sort')).toBe('-created_at')
  })

  it('keeps a chosen tab in the URL, so the filtered list can be reloaded', async () => {
    const { router, harness } = await open()
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('button', { name: /^Published/ }))

    await waitFor(() => expect(router.state.location.search).toBe('?status=PUBLISHED'))
    await waitFor(() => expect(listCalls(harness).at(-1)!.searchParams.get('status')).toBe('PUBLISHED'))
  })
})

describe('course list - rows on a laptop', () => {
  it('shows each course’s thumbnail, or the navy tile when it has none', async () => {
    await open()
    const table = await screen.findByRole('table')

    const draftRow = within(table).getByRole('row', { name: new RegExp(DRAFT.title) })
    const image = draftRow.querySelector('img')!
    expect(image).toHaveAttribute('src', THUMB)
    // Decoration: the title beside it names the course.
    expect(image).toHaveAttribute('alt', '')
    const publishedRow = within(table).getByRole('row', { name: new RegExp(PUBLISHED.title) })
    expect(publishedRow.querySelector('img')).toBeNull()
  })

  it('archives from the menu, through the confirmation', async () => {
    const { harness } = await renderRoute({
      path: COURSES,
      as: 'admin',
      beforeMount: (instance) => {
        stub(instance)
        instance.http.on(`/admin/courses/${PUBLISHED.id}`, { json: PUBLISHED })
        instance.http.on(`/admin/courses/${PUBLISHED.id}/archive`, { json: { ...PUBLISHED, status: 'ARCHIVED' } })
      },
    })
    const table = await screen.findByRole('table')

    await userEvent.click(within(table).getByRole('button', { name: `More actions for ${PUBLISHED.title}` }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: `Archive “${PUBLISHED.title}”?` })).toBeInTheDocument()
    expect(harness.http.callsTo(`/admin/courses/${PUBLISHED.id}/archive`)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive course' }))
    await waitFor(() => expect(harness.http.callsTo(`/admin/courses/${PUBLISHED.id}/archive`)).toHaveLength(1))
  })

  it('closes the menu with Escape, back on its trigger', async () => {
    await open()
    const table = await screen.findByRole('table')
    const trigger = within(table).getByRole('button', { name: `More actions for ${DRAFT.title}` })

    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Edit course' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})

describe('course list - on a tablet', () => {
  it('draws the narrow table: Course, Status, Lessons, and Edit', async () => {
    await open(COURSES, viewports.tablet)
    const table = await screen.findByRole('table')

    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual(['Course', 'Status', 'Lessons', 'Actions'])

    const row = within(table).getByRole('row', { name: new RegExp(PUBLISHED.title) })
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('16')
    expect(within(row).getByRole('link', { name: `Edit ${PUBLISHED.title}` })).toHaveAttribute(
      'href',
      `${COURSES}/${PUBLISHED.id}`,
    )
    // The board draws Edit alone; Publish and Archive stay in the editor.
    expect(within(row).queryByRole('button', { name: /More actions/ })).toBeNull()
    expect(row.querySelector('img')).toBeNull()
  })
})

describe('course list - on a phone', () => {
  it('draws a card per course: thumbnail, title, badge, sizes and date', async () => {
    await open(COURSES, viewports.mobile)
    const list = await screen.findByRole('list', { name: 'Courses' })

    const card = within(list).getAllByRole('listitem')[1]!
    expect(within(card).getByRole('link', { name: PUBLISHED.title })).toBeInTheDocument()
    expect(within(card).getByText('PUBLISHED')).toBeInTheDocument()
    expect(within(card).getByText('4 modules')).toBeInTheDocument()
    expect(within(card).getByText('16 lessons')).toBeInTheDocument()
    expect(card).toHaveTextContent(/Modified/)
    // The first course has an image; the others show the navy tile.
    expect(within(list).getAllByRole('listitem')[0]!.querySelector('img')).toHaveAttribute('src', THUMB)
  })

  it('says "0 modules" for an empty course, and writes the singular', async () => {
    await open(COURSES, viewports.mobile, [
      { ...rows[0]!, module_count: 0, lesson_count: 0 },
      { ...rows[1]!, module_count: 1, lesson_count: 1 },
    ])
    const cards = within(await screen.findByRole('list', { name: 'Courses' })).getAllByRole('listitem')

    expect(within(cards[0]!).getByText('0 modules')).toBeInTheDocument()
    expect(within(cards[1]!).getByText('1 module')).toBeInTheDocument()
    expect(within(cards[1]!).getByText('1 lesson')).toBeInTheDocument()
  })

  it('offers Edit and the menu from each card', async () => {
    const { router } = await open(COURSES, viewports.mobile)
    const list = await screen.findByRole('list', { name: 'Courses' })

    await userEvent.click(within(list).getByRole('button', { name: `More actions for ${DRAFT.title}` }))
    expect(screen.getByRole('menuitem', { name: 'Publish' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(list).getByRole('link', { name: `Edit ${DRAFT.title}` }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`${COURSES}/${DRAFT.id}`))
  })
})

describe('course list - empty states', () => {
  it('draws the Archived filter’s empty state as the board does', async () => {
    const { router } = await open(`${COURSES}?status=ARCHIVED`, undefined, rows.filter((row) => row.status !== 'ARCHIVED'))

    expect(await screen.findByRole('heading', { name: 'No archived courses' })).toBeInTheDocument()
    expect(screen.getByText('Courses you archive will be listed here.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show all courses' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('keeps the general wording for the other filters', async () => {
    await open(`${COURSES}?status=DRAFT`, undefined, rows.filter((row) => row.status !== 'DRAFT'))

    expect(await screen.findByRole('heading', { name: 'No draft courses' })).toBeInTheDocument()
    expect(screen.getByText('Courses you create will appear here once they match the filter.')).toBeInTheDocument()
  })
})
