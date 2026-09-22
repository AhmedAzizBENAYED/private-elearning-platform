import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  catalogAvailable,
  catalogEnrolled,
  catalogPage,
  enrollmentCompleted,
  enrollmentInProgress,
  page,
} from '../../test/courseFixtures'
import { renderRoute, type RenderRouteResult } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

type Harness = RenderRouteResult['harness']

/** Two published courses, neither enrolled. */
function twoCourses(harness: Harness) {
  harness.http.on('/courses', { json: page([catalogEnrolled, catalogAvailable]) })
  harness.http.on('/me/enrollments', { json: page([]) })
}

async function mountCatalogue(
  setup: (harness: Harness) => void = twoCourses,
  { path = '/courses', width = viewports.wide } = {},
) {
  return renderRoute({ path, as: 'member', width, beforeMount: setup })
}

/** Asserts the pager's current position, whose text spans several elements. */
async function expectPage(position: string) {
  await waitFor(() => {
    expect(screen.getByRole('navigation', { name: 'Catalogue pages' })).toHaveTextContent(position)
  })
}

/** The query string of the last `/courses` request. */
function lastCatalogQuery(harness: Harness): URLSearchParams {
  const calls = harness.http.callsTo('/courses')
  const last = calls[calls.length - 1]
  return new URL(last?.url ?? 'http://x/').searchParams
}

describe('catalogue rendering', () => {
  it('renders the page heading and lede', async () => {
    await mountCatalogue()

    expect(await screen.findByRole('heading', { name: 'Courses', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Browse the courses published by the association.')).toBeInTheDocument()
  })

  it('renders a card per course from the real response shape', async () => {
    await mountCatalogue()

    const list = await screen.findByRole('list', { name: 'Courses' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('link', { name: catalogEnrolled.title })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: catalogAvailable.title })).toBeInTheDocument()
  })

  it('shows the backend title, description and thumbnail', async () => {
    const { container } = await mountCatalogue()

    await screen.findByRole('list', { name: 'Courses' })
    expect(screen.getByText(catalogEnrolled.description)).toBeInTheDocument()
    // catalogEnrolled has a thumbnail_url; catalogAvailable has null.
    const image = container.querySelector(`img[src="${catalogEnrolled.thumbnail_url ?? ''}"]`)
    expect(image).toBeInTheDocument()
    expect(image).toHaveAttribute('alt', '')
  })

  it('shows the backend total, not the number of rows on this page', async () => {
    await mountCatalogue((harness) => {
      harness.http.on('/courses', { json: catalogPage(20, { total: 42 }) })
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    expect(await screen.findByText('42 courses')).toBeInTheDocument()
  })

  it('uses the singular for one course', async () => {
    await mountCatalogue((harness) => {
      harness.http.on('/courses', { json: page([catalogAvailable]) })
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    expect(await screen.findByText('1 course')).toBeInTheDocument()
  })

  it('invents no counts the backend does not supply', async () => {
    await mountCatalogue()

    await screen.findByRole('list', { name: 'Courses' })
    expect(screen.queryByText(/modules/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/videos/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/lessons/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/students|rating|instructor|difficulty/i)).not.toBeInTheDocument()
  })
})

describe('catalogue navigation', () => {
  it('links each card to the real course id', async () => {
    await mountCatalogue()

    const list = await screen.findByRole('list', { name: 'Courses' })
    expect(within(list).getByRole('link', { name: catalogEnrolled.title })).toHaveAttribute(
      'href',
      `/courses/${catalogEnrolled.id}`,
    )
  })

  it('navigates through the router, not a page load', async () => {
    const { router } = await mountCatalogue()

    await userEvent.click(await screen.findByRole('link', { name: catalogEnrolled.title }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/courses/${catalogEnrolled.id}`)
    })
  })
})

describe('catalogue enrollment state', () => {
  it('badges each card from a single enrollments read', async () => {
    const { harness } = await mountCatalogue((h) => {
      h.http.on('/courses', { json: page([catalogEnrolled, catalogAvailable]) })
      h.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
    })

    const list = await screen.findByRole('list', { name: 'Courses' })
    const items = within(list).getAllByRole('listitem')
    expect(within(items[0] as HTMLElement).getByText('In progress')).toBeInTheDocument()
    expect(within(items[1] as HTMLElement).getByText('Not enrolled')).toBeInTheDocument()

    // One request for every card's state - never one per course.
    expect(harness.http.callsTo('/me/enrollments')).toHaveLength(1)
  })

  it('shows the backend progress on an enrolled card', async () => {
    await mountCatalogue((h) => {
      h.http.on('/courses', { json: page([catalogEnrolled]) })
      h.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
    })

    const bar = await screen.findByRole('progressbar', {
      name: `${catalogEnrolled.title} progress`,
    })
    expect(bar).toHaveAttribute('aria-valuenow', '45')
  })

  it('marks a finished course completed', async () => {
    await mountCatalogue((h) => {
      h.http.on('/courses', { json: page([catalogEnrolled]) })
      h.http.on('/me/enrollments', {
        json: page([{ ...enrollmentCompleted, course_id: catalogEnrolled.id }]),
      })
    })

    const list = await screen.findByRole('list', { name: 'Courses' })
    // Both the status badge and the CTA read "Completed"; the badge is the
    // one that states the member's relationship to the course.
    expect(within(list).getAllByText('Completed').length).toBeGreaterThanOrEqual(1)
    expect(within(list).getByRole('link', { name: 'Completed: Python Fundamentals' })).toBeInTheDocument()
  })

  it('still lists the catalogue when the enrollments read fails', async () => {
    await mountCatalogue((h) => {
      h.http.on('/courses', { json: page([catalogEnrolled]) })
      h.http.on('/me/enrollments', { status: 503, json: { detail: 'Unavailable' } })
    })

    expect(await screen.findByRole('list', { name: 'Courses' })).toBeInTheDocument()
    expect(
      screen.getByText('We couldn’t check which courses you are enrolled in.'),
    ).toBeInTheDocument()
  })
})

describe('catalogue loading', () => {
  it('shows a skeleton while the request is pending', async () => {
    await mountCatalogue((harness) => {
      harness.http.on('/courses', () => new Promise<never>(() => undefined))
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    expect(await screen.findByRole('status', { name: 'Loading courses' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    // The heading is real straight away; only the grid is a placeholder.
    expect(screen.getByRole('heading', { name: 'Courses', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Courses' })).not.toBeInTheDocument()
  })
})

describe('catalogue empty states', () => {
  it('renders the nothing-published state', async () => {
    await mountCatalogue((harness) => {
      harness.http.on('/courses', { json: page([]) })
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    expect(await screen.findByRole('heading', { name: 'No courses yet' })).toBeInTheDocument()
    expect(screen.getByText('No course has been published yet. Come back soon.')).toBeInTheDocument()
    // Empty is a valid state, not an error.
    expect(screen.queryByRole('heading', { name: /couldn’t load/ })).not.toBeInTheDocument()
  })

  it('renders the no-search-result state and clears the search', async () => {
    const { router } = await mountCatalogue((harness) => {
      harness.http.on('/courses', { json: page([]) })
      harness.http.on('/me/enrollments', { json: page([]) })
    }, { path: '/courses?search=pyhton' })

    expect(
      await screen.findByRole('heading', { name: 'No course matches “pyhton”' }),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
  })
})

describe('catalogue errors', () => {
  it('renders the designed error without technical detail', async () => {
    await mountCatalogue((harness) => {
      harness.http.on('/courses', { status: 500, json: { detail: 'Internal server error' } })
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    expect(
      await screen.findByRole('heading', { name: 'We couldn’t load the courses' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Internal server error/)).not.toBeInTheDocument()
    expect(screen.queryByText(/500/)).not.toBeInTheDocument()
  })

  it('recovers on retry without a page reload', async () => {
    const { harness } = await mountCatalogue((h) => {
      h.http.once('/courses', { status: 503, json: { detail: 'Unavailable' } })
      h.http.on('/courses', { json: page([catalogAvailable]) })
      h.http.on('/me/enrollments', { json: page([]) })
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('list', { name: 'Courses' })).toBeInTheDocument()
    expect(harness.http.callsTo('/courses').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the search box usable while showing the error', async () => {
    await mountCatalogue((harness) => {
      harness.http.on('/courses', { status: 500, json: { detail: 'boom' } })
      harness.http.on('/me/enrollments', { json: page([]) })
    })

    await screen.findByRole('heading', { name: 'We couldn’t load the courses' })
    expect(screen.getByRole('searchbox', { name: 'Search courses' })).toBeInTheDocument()
  })
})

describe('catalogue search', () => {
  it('sends the backend search parameter and puts it in the URL', async () => {
    const { harness, router } = await mountCatalogue()
    await screen.findByRole('list', { name: 'Courses' })

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'python')

    await waitFor(() => {
      expect(lastCatalogQuery(harness).get('search')).toBe('python')
    })
    expect(router.state.location.search).toContain('search=python')
  })

  it('debounces: typing does not fire a request per keystroke', async () => {
    const { harness } = await mountCatalogue()
    await screen.findByRole('list', { name: 'Courses' })
    const before = harness.http.callsTo('/courses').length

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'python')

    await waitFor(() => {
      expect(lastCatalogQuery(harness).get('search')).toBe('python')
    })
    // Six characters typed; far fewer than six extra requests.
    expect(harness.http.callsTo('/courses').length - before).toBeLessThan(6)
  })

  it('reads the search term from the URL on first render', async () => {
    const { harness } = await mountCatalogue(twoCourses, { path: '/courses?search=excel' })

    await screen.findByRole('list', { name: 'Courses' })
    expect(lastCatalogQuery(harness).get('search')).toBe('excel')
    expect(screen.getByRole('searchbox', { name: 'Search courses' })).toHaveValue('excel')
  })

  it('omits the parameter entirely when the box is empty', async () => {
    const { harness } = await mountCatalogue()

    await screen.findByRole('list', { name: 'Courses' })
    expect(lastCatalogQuery(harness).has('search')).toBe(false)
  })

  it('returns to the first page when the search changes', async () => {
    const { harness, router } = await mountCatalogue(
      (h) => {
        h.http.on('/courses', { json: catalogPage(20, { total: 60, page: 2 }) })
        h.http.on('/me/enrollments', { json: page([]) })
      },
      { path: '/courses?page=2' },
    )
    await screen.findByRole('list', { name: 'Courses' })

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'a')

    await waitFor(() => {
      expect(lastCatalogQuery(harness).get('search')).toBe('a')
    })
    // Page 3 of the old results means nothing against the new ones.
    expect(lastCatalogQuery(harness).get('page')).toBe('1')
    expect(router.state.location.search).not.toContain('page=')
  })
})

describe('catalogue pagination', () => {
  const paged = (harness: Harness) => {
    harness.http.on('/courses', (call) => {
      const requested = Number(new URL(call.url).searchParams.get('page') ?? '1')
      return { json: catalogPage(20, { total: 45, page: requested }) }
    })
    harness.http.on('/me/enrollments', { json: page([]) })
  }

  it('requests the backend page size and the first page by default', async () => {
    const { harness } = await mountCatalogue(paged)

    await screen.findByRole('list', { name: 'Courses' })
    const query = lastCatalogQuery(harness)
    expect(query.get('page')).toBe('1')
    expect(query.get('page_size')).toBe('20')
  })

  it('derives the page count from total and page_size', async () => {
    await mountCatalogue(paged)

    // 45 courses at 20 per page is three pages.
    const pager = await screen.findByRole('navigation', { name: 'Catalogue pages' })
    expect(within(pager).getByText(/Page/)).toHaveTextContent('Page 1 of 3')
  })

  it('shows no pager when everything fits on one page', async () => {
    await mountCatalogue()

    await screen.findByRole('list', { name: 'Courses' })
    expect(screen.queryByRole('navigation', { name: 'Catalogue pages' })).not.toBeInTheDocument()
  })

  it('moves to the next page and puts it in the URL', async () => {
    const { harness, router } = await mountCatalogue(paged)
    await screen.findByRole('list', { name: 'Courses' })

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(lastCatalogQuery(harness).get('page')).toBe('2')
    })
    expect(router.state.location.search).toContain('page=2')
    await expectPage('Page 2 of 3')
  })

  it('moves back to the previous page', async () => {
    const { router } = await mountCatalogue(paged, { path: '/courses?page=2' })
    await expectPage('Page 2 of 3')

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))

    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    await expectPage('Page 1 of 3')
  })

  it('disables Previous on the first page and Next on the last', async () => {
    await mountCatalogue(paged)
    await screen.findByRole('list', { name: 'Courses' })

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('disables Next on the last page', async () => {
    await mountCatalogue(paged, { path: '/courses?page=3' })

    await expectPage('Page 3 of 3')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })

  it('restores the page from the URL after a refresh', async () => {
    const { harness } = await mountCatalogue(paged, { path: '/courses?page=3' })

    await screen.findByRole('list', { name: 'Courses' })
    expect(lastCatalogQuery(harness).get('page')).toBe('3')
  })

  it('treats a nonsense page parameter as the first page', async () => {
    const { harness } = await mountCatalogue(paged, { path: '/courses?page=abc' })

    await screen.findByRole('list', { name: 'Courses' })
    expect(lastCatalogQuery(harness).get('page')).toBe('1')
  })

  it('does not append pages: each page replaces the grid', async () => {
    await mountCatalogue(paged)
    const list = await screen.findByRole('list', { name: 'Courses' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(20)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await expectPage('Page 2 of 3')

    expect(
      within(screen.getByRole('list', { name: 'Courses' })).getAllByRole('listitem'),
    ).toHaveLength(20)
  })
})

describe('catalogue security', () => {
  it('renders no token anywhere in the DOM', async () => {
    const { container, harness } = await mountCatalogue()

    await screen.findByRole('list', { name: 'Courses' })
    const markup = container.innerHTML
    expect(markup).not.toContain('access-1')
    expect(markup).not.toContain('refresh-1')
    expect(markup).not.toContain('Bearer')
    expect(harness.accessTokens.get()).toBeTruthy()
  })

  it('never reaches an admin endpoint for the catalogue', async () => {
    const { harness } = await mountCatalogue()

    await screen.findByRole('list', { name: 'Courses' })
    expect(harness.http.calls.filter((call) => call.url.includes('/admin'))).toEqual([])
  })
})

describe('catalogue responsive', () => {
  it('renders on a phone', async () => {
    await mountCatalogue(twoCourses, { width: viewports.mobile })

    expect(await screen.findByRole('list', { name: 'Courses' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search courses' })).toBeInTheDocument()
  })

  it('renders on a tablet', async () => {
    await mountCatalogue(twoCourses, { width: viewports.tablet })

    expect(await screen.findByRole('list', { name: 'Courses' })).toBeInTheDocument()
  })
})
