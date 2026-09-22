import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CatalogCourseListItem, CatalogEnrollmentCounts, EnrollmentFilter, EnrollmentSummary } from '../../api'
import {
  catalogAvailableRow,
  catalogEmptyRow,
  catalogEnrolledRow,
  catalogListPage,
  enrollmentCompleted,
  enrollmentInProgress,
  page,
} from '../../test/courseFixtures'
import { renderRoute, type RenderRouteResult } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-COURSE-CATALOG-01 - the catalogue on the BE-COURSE-CATALOG-01 contract.
 *
 * G04: the four tabs send `enrollment` to `GET /courses` and read their
 * figures from `enrollment_counts`. G05: each card shows the backend's
 * `module_count` and `total_video_lessons`, and an enrolled one the
 * enrollment's `completed_video_lessons` of `total_video_lessons`.
 *
 * The mocked backend below answers each tab with that tab's rows, so the page
 * cannot pass by filtering on its own.
 */

type Harness = RenderRouteResult['harness']

/** A finished course, with the size the completed enrollment reports. */
const completedRow: CatalogCourseListItem = {
  ...catalogAvailableRow,
  id: enrollmentCompleted.course_id,
  title: enrollmentCompleted.title,
  slug: enrollmentCompleted.slug,
  description: 'Plan, run and close a project.',
  module_count: 4,
  total_video_lessons: 14,
}

const ROWS: Record<EnrollmentFilter, CatalogCourseListItem[]> = {
  not_enrolled: [catalogAvailableRow, catalogEmptyRow],
  in_progress: [catalogEnrolledRow],
  completed: [completedRow],
}
const ALL = [catalogEnrolledRow, completedRow, catalogAvailableRow, catalogEmptyRow]
const COUNTS: CatalogEnrollmentCounts = { all: 4, not_enrolled: 2, in_progress: 1, completed: 1 }

/** A backend that filters by tab and counts every tab, as the real one does. */
function catalogue(
  {
    counts = COUNTS,
    rows = ROWS,
    all = ALL,
    enrollments = [enrollmentInProgress, enrollmentCompleted],
    total,
  }: {
    counts?: CatalogEnrollmentCounts
    rows?: Record<EnrollmentFilter, CatalogCourseListItem[]>
    all?: CatalogCourseListItem[]
    enrollments?: EnrollmentSummary[]
    total?: (filter: EnrollmentFilter | null) => number
  } = {},
) {
  return (harness: Harness) => {
    harness.http.on('/courses', (call) => {
      const params = new URL(call.url).searchParams
      const filter = params.get('enrollment') as EnrollmentFilter | null
      const items = filter === null ? all : rows[filter]
      return {
        json: catalogListPage(items, counts, {
          total: total ? total(filter) : items.length,
          page: Number(params.get('page') ?? 1),
        }),
      }
    })
    harness.http.on('/me/enrollments', { json: page(enrollments) })
  }
}

async function mount(
  setup: (harness: Harness) => void = catalogue(),
  { path = '/courses', width = viewports.wide } = {},
) {
  const result = await renderRoute({ path, as: 'member', width, beforeMount: setup })
  await screen.findByRole('list', { name: 'Courses' })
  return result
}

const tabs = () => screen.getByRole('group', { name: 'Filter by enrollment' })
const tab = (name: RegExp | string) => within(tabs()).getByRole('button', { name })

/** The query of the last `GET /courses`. */
function lastQuery(harness: Harness): URLSearchParams {
  const calls = harness.http.callsTo('/courses')
  return new URL(calls.at(-1)?.url ?? 'http://x/').searchParams
}

/** One course's card, found by its title link. */
function card(title: string): HTMLElement {
  return screen.getByRole('link', { name: title }).closest('article')!
}

// ------------------------------------------------------------------- API / query

describe('catalogue tabs - what is sent', () => {
  it('sends no enrollment parameter for All', async () => {
    const { harness } = await mount()

    expect(lastQuery(harness).has('enrollment')).toBe(false)
    expect(tab(/^All/)).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['Not enrolled', 'not_enrolled'],
    ['In progress', 'in_progress'],
    ['Completed', 'completed'],
  ])('sends enrollment=%s for "%s"', async (label, value) => {
    const { harness, router } = await mount()

    await userEvent.click(tab(new RegExp(`^${label}`)))

    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe(value))
    expect(router.state.location.search).toBe(`?enrollment=${value}`)
    expect(tab(new RegExp(`^${label}`))).toHaveAttribute('aria-pressed', 'true')
    expect(tab(/^All/)).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows exactly the rows the backend returned for the tab', async () => {
    await mount()

    await userEvent.click(tab(/^Not enrolled/))

    await waitFor(() => {
      const list = screen.getByRole('list', { name: 'Courses' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    })
    expect(screen.getByRole('link', { name: catalogAvailableRow.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: catalogEmptyRow.title })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: catalogEnrolledRow.title })).toBeNull()
  })

  it('sends the search and the tab together, both kept in the URL', async () => {
    const { harness, router } = await mount(catalogue(), { path: '/courses?search=python' })

    await userEvent.click(tab(/^In progress/))

    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe('in_progress'))
    expect(lastQuery(harness).get('search')).toBe('python')
    const url = new URLSearchParams(router.state.location.search)
    expect(url.get('search')).toBe('python')
    expect(url.get('enrollment')).toBe('in_progress')
  })

  it('returns to page 1 when the tab changes, keeping the search', async () => {
    const { harness, router } = await mount(catalogue(), { path: '/courses?search=python&page=3' })
    expect(lastQuery(harness).get('page')).toBe('3')

    await userEvent.click(tab(/^Completed/))

    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe('completed'))
    expect(lastQuery(harness).get('page')).toBe('1')
    expect(lastQuery(harness).get('search')).toBe('python')
    expect(new URLSearchParams(router.state.location.search).has('page')).toBe(false)
  })

  it('reads the tab from the URL on arrival, and asks for it', async () => {
    const { harness } = await mount(catalogue(), { path: '/courses?enrollment=completed' })

    expect(tab(/^Completed/)).toHaveAttribute('aria-pressed', 'true')
    expect(lastQuery(harness).get('enrollment')).toBe('completed')
    expect(harness.http.callsTo('/courses').every((call) => call.url.includes('enrollment=completed'))).toBe(true)
  })

  it('reads a value the backend would refuse as All, and sends nothing', async () => {
    const { harness } = await mount(catalogue(), { path: '/courses?enrollment=enrolled' })

    expect(tab(/^All/)).toHaveAttribute('aria-pressed', 'true')
    expect(lastQuery(harness).has('enrollment')).toBe(false)
  })

  it('follows Back and Forward: tab, search and page stay with the URL', async () => {
    const { harness, router } = await mount(catalogue(), { path: '/courses?search=py' })

    await userEvent.click(tab(/^Completed/))
    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe('completed'))

    await act(async () => {
      await router.navigate(-1)
    })
    await waitFor(() => expect(tab(/^All/)).toHaveAttribute('aria-pressed', 'true'))
    expect(lastQuery(harness).has('enrollment')).toBe(false)
    expect(lastQuery(harness).get('search')).toBe('py')
    expect(screen.getByRole('searchbox', { name: 'Search courses' })).toHaveValue('py')

    await act(async () => {
      await router.navigate(1)
    })
    await waitFor(() => expect(tab(/^Completed/)).toHaveAttribute('aria-pressed', 'true'))
    expect(lastQuery(harness).get('enrollment')).toBe('completed')
  })
})

// ------------------------------------------------------------------- counts

describe('catalogue tabs - counts', () => {
  it('shows each tab s figure from enrollment_counts', async () => {
    await mount()

    expect(tab('All: 4')).toBeInTheDocument()
    expect(tab('Not enrolled: 2')).toBeInTheDocument()
    expect(tab('In progress: 1')).toBeInTheDocument()
    expect(tab('Completed: 1')).toBeInTheDocument()
    expect(within(tab('All: 4')).getByText('4')).toBeInTheDocument()
  })

  it('never counts the rows on screen: 45 courses over one page of two', async () => {
    const counts = { all: 45, not_enrolled: 30, in_progress: 10, completed: 5 }
    await mount(catalogue({ counts, all: [catalogEnrolledRow, catalogAvailableRow], total: () => 45 }))

    expect(tab('All: 45')).toBeInTheDocument()
    expect(tab('Not enrolled: 30')).toBeInTheDocument()
    expect(tab('In progress: 10')).toBeInTheDocument()
    expect(tab('Completed: 5')).toBeInTheDocument()
    expect(screen.getByText('45 courses')).toBeInTheDocument()
  })

  it('keeps every tab s figure while one tab is open', async () => {
    await mount()

    await userEvent.click(tab(/^Completed/))

    await waitFor(() => expect(tab('Completed: 1')).toHaveAttribute('aria-pressed', 'true'))
    expect(tab('All: 4')).toBeInTheDocument()
    expect(tab('Not enrolled: 2')).toBeInTheDocument()
  })

  it('shows the backend s figures exactly, zero included', async () => {
    const counts = { all: 7, not_enrolled: 7, in_progress: 0, completed: 0 }
    await mount(catalogue({ counts }))

    expect(tab('In progress: 0')).toBeInTheDocument()
    expect(tab('Completed: 0')).toBeInTheDocument()
    expect(tab('All: 7')).toBeInTheDocument()
  })

  it('draws no figure when the response carries no counts', async () => {
    await mount((harness) => {
      harness.http.on('/courses', { json: page([catalogEnrolledRow]) })
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    for (const name of ['All', 'Not enrolled', 'In progress', 'Completed']) {
      expect(tab(name)).toHaveTextContent(name)
      expect(tab(name).textContent).not.toMatch(/\d/)
    }
  })
})

// ------------------------------------------------------------------- cards

describe('catalogue cards - course size', () => {
  it('shows the backend s module and video counts', async () => {
    await mount()

    expect(within(card(catalogEnrolledRow.title)).getByText('3 modules')).toBeInTheDocument()
    expect(within(card(catalogEnrolledRow.title)).getByText('11 videos')).toBeInTheDocument()
    expect(within(card(completedRow.title)).getByText('4 modules')).toBeInTheDocument()
    expect(within(card(completedRow.title)).getByText('14 videos')).toBeInTheDocument()
  })

  it('uses the singular for one module and one video', async () => {
    await mount()

    const one = card(catalogAvailableRow.title)
    expect(within(one).getByText('1 module')).toBeInTheDocument()
    expect(within(one).getByText('1 video')).toBeInTheDocument()
  })

  it('shows an empty course as 0 modules and 0 videos', async () => {
    await mount()

    const empty = card(catalogEmptyRow.title)
    expect(within(empty).getByText('0 modules')).toBeInTheDocument()
    expect(within(empty).getByText('0 videos')).toBeInTheDocument()
  })

  it('reads the size as one phrase, not run together', async () => {
    await mount()

    const size = within(card(catalogEnrolledRow.title)).getByText('3 modules').parentElement!
    expect(size.textContent).toBe('3 modules, 11 videos')
  })
})

describe('catalogue cards - progress', () => {
  it('shows the enrollment s completed and total videos', async () => {
    await mount()

    expect(within(card(catalogEnrolledRow.title)).getByText('5 of 11 videos completed')).toBeInTheDocument()
  })

  it('shows a finished course with the backend s figures', async () => {
    await mount()

    const done = card(completedRow.title)
    expect(within(done).getByText('14 of 14 videos completed')).toBeInTheDocument()
    expect(within(done).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('never derives the figures from the percentage', async () => {
    // 45.45% would be 5 of 11; the enrollment says 4 of 9, so 4 of 9 it is.
    const odd = { ...enrollmentInProgress, completed_video_lessons: 4, total_video_lessons: 9 }
    await mount(catalogue({ enrollments: [odd, enrollmentCompleted] }))

    expect(within(card(catalogEnrolledRow.title)).getByText('4 of 9 videos completed')).toBeInTheDocument()
    expect(screen.queryByText('5 of 11 videos completed')).toBeNull()
  })

  it('shows no progress on a course the member has not enrolled in', async () => {
    await mount()

    for (const title of [catalogAvailableRow.title, catalogEmptyRow.title]) {
      expect(within(card(title)).queryByRole('progressbar')).toBeNull()
      expect(within(card(title)).queryByText(/videos? completed/)).toBeNull()
    }
  })

  it('uses the singular for a one-video course', async () => {
    const single = { ...enrollmentInProgress, course_id: catalogAvailableRow.id, completed_video_lessons: 0, total_video_lessons: 1 }
    await mount(catalogue({ enrollments: [single] }))

    expect(within(card(catalogAvailableRow.title)).getByText('0 of 1 video completed')).toBeInTheDocument()
  })

  it('badges a filtered tab s rows with the tab s state, even if the enrollments read fails', async () => {
    await mount((harness) => {
      catalogue()(harness)
      harness.http.on('/me/enrollments', { status: 500, json: { detail: 'down' } })
    }, { path: '/courses?enrollment=completed' })

    const done = card(completedRow.title)
    // The card's action follows its state: "Completed", never "Start course".
    expect(within(done).getByRole('link', { name: `Completed: ${completedRow.title}` })).toBeInTheDocument()
    expect(within(done).queryByRole('link', { name: /^Start course/ })).toBeNull()
    expect(within(done).queryByText(/Not enrolled/)).toBeNull()
    // The figures come from the enrollment only, which could not be read.
    expect(within(done).queryByText(/videos completed/)).toBeNull()
  })

  it('lends no progress to a row the backend lists as not enrolled', async () => {
    // A stale enrollment for a course the backend now counts as not enrolled.
    const stale = { ...enrollmentInProgress, course_id: catalogAvailableRow.id }
    await mount(catalogue({ enrollments: [stale] }), { path: '/courses?enrollment=not_enrolled' })

    expect(within(card(catalogAvailableRow.title)).queryByRole('progressbar')).toBeNull()
  })
})

// ------------------------------------------------------------------- pagination

describe('catalogue tabs - pagination', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    ...catalogAvailableRow,
    id: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Open course ${index + 1}`,
  }))
  const paged = catalogue({
    rows: { ...ROWS, not_enrolled: many },
    counts: { all: 60, not_enrolled: 45, in_progress: 10, completed: 5 },
    total: (filter) => (filter === 'not_enrolled' ? 45 : 60),
  })

  it('pages with the backend total of the tab, not the rows on screen', async () => {
    await mount(paged, { path: '/courses?enrollment=not_enrolled' })

    expect(screen.getByText('45 courses')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Catalogue pages' })).toHaveTextContent('Page 1 of 3'),
    )
  })

  it('keeps tab and search while paging, then resets the page on a new tab', async () => {
    const { harness, router } = await mount(paged, { path: '/courses?enrollment=not_enrolled&search=open' })

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastQuery(harness).get('page')).toBe('2'))
    expect(lastQuery(harness).get('enrollment')).toBe('not_enrolled')
    expect(lastQuery(harness).get('search')).toBe('open')

    await userEvent.click(tab(/^In progress/))
    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe('in_progress'))
    expect(lastQuery(harness).get('page')).toBe('1')
    expect(lastQuery(harness).get('search')).toBe('open')
    expect(new URLSearchParams(router.state.location.search).has('page')).toBe(false)
  })
})

// ------------------------------------------------------------------- states

describe('catalogue tabs - states', () => {
  const nothing = { not_enrolled: [], in_progress: [], completed: [] }

  it('says so when the Completed tab is empty, and offers every course (Catalogue-States)', async () => {
    const { router } = await renderRoute({
      path: '/courses?enrollment=completed',
      as: 'member',
      beforeMount: catalogue({ rows: nothing, counts: { all: 4, not_enrolled: 4, in_progress: 0, completed: 0 } }),
    })

    expect(await screen.findByRole('heading', { name: 'No completed course yet', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Finish all the video lessons of a course to see it here.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show all courses' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(tab(/^All/)).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['in_progress', 'No course in progress'],
    ['not_enrolled', 'You’re enrolled in every course'],
  ])('has an empty state for the %s tab', async (filter, title) => {
    await renderRoute({
      path: `/courses?enrollment=${filter}`,
      as: 'member',
      beforeMount: catalogue({ rows: nothing }),
    })

    expect(await screen.findByRole('heading', { name: title, level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all courses' })).toBeInTheDocument()
  })

  it('reports an empty search inside a tab as the search, with its way out', async () => {
    await renderRoute({
      path: '/courses?enrollment=completed&search=zzz',
      as: 'member',
      beforeMount: catalogue({ rows: nothing }),
    })

    expect(await screen.findByRole('heading', { name: 'No course matches “zzz”' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('shows the error, not an empty tab, when the request fails', async () => {
    await renderRoute({
      path: '/courses?enrollment=in_progress',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/courses', { status: 500, json: { detail: 'Internal server error' } })
        harness.http.on('/me/enrollments', { json: page([]) })
      },
    })

    expect(await screen.findByRole('heading', { name: 'We couldn’t load the courses' })).toBeInTheDocument()
    expect(screen.queryByText('No course in progress')).toBeNull()
  })
})

// ------------------------------------------------------------------- keyboard, responsive

describe('catalogue tabs - keyboard and widths', () => {
  it('is reached by Tab and switched with Enter and Space', async () => {
    const { harness } = await mount()

    tab(/^All/).focus()
    await userEvent.tab()
    expect(tab(/^Not enrolled/)).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe('not_enrolled'))

    tab(/^Completed/).focus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(lastQuery(harness).get('enrollment')).toBe('completed'))
  })

  it.each([viewports.mobile, viewports.tablet, viewports.wide])(
    'offers the four tabs, the counts and the card figures at %ipx',
    async (width) => {
      await mount(catalogue(), { width })

      expect(within(tabs()).getAllByRole('button')).toHaveLength(4)
      expect(tab('All: 4')).toBeInTheDocument()
      expect(within(card(catalogEnrolledRow.title)).getByText('5 of 11 videos completed')).toBeInTheDocument()
      for (const button of within(tabs()).getAllByRole('button')) {
        expect(getComputedStyle(button).minHeight).toBe('var(--tap-target)')
      }
    },
  )
})
