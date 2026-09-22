import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  catalogAvailable,
  catalogEnrolled,
  courseContent,
  enrollmentCompleted,
  enrollmentInProgress,
  page,
} from '../../test/courseFixtures'
import { renderRoute, type RenderRouteResult } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/** The common case: one course in progress, one completed, one available. */
function fullDashboard(harness: RenderRouteResult['harness']) {
  harness.http.on('/me/enrollments', {
    json: page([enrollmentInProgress, enrollmentCompleted]),
  })
  harness.http.on('/courses', { json: page([catalogEnrolled, catalogAvailable]) })
  harness.http.on('/content', { json: courseContent })
}

/** Mounts `/dashboard` as a signed-in member with the given stubbed responses. */
async function mountWith(
  setup: (harness: RenderRouteResult['harness']) => void,
  width = viewports.wide,
) {
  return renderRoute({ path: '/dashboard', as: 'member', width, beforeMount: setup })
}

describe('dashboard authentication', () => {
  it('is not reachable when signed out', async () => {
    const { router } = await renderRoute({ path: '/dashboard' })

    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('greets the authenticated user by their real name', async () => {
    await mountWith(fullDashboard)

    expect(
      await screen.findByRole('heading', { name: 'Welcome back, Iyed', level: 1 }),
    ).toBeInTheDocument()
  })

  it('renders the name from the session, not from a request of its own', async () => {
    const { harness } = await mountWith(fullDashboard)

    await screen.findByRole('list', { name: 'Courses in progress' })
    expect(screen.getByRole('heading', { name: 'Welcome back, Iyed', level: 1 })).toBeInTheDocument()

    // The dashboard's own traffic is the three data reads and nothing else;
    // the user came from FE-02. (The session's own /auth/me calls are its
    // business, and are asserted in the FE-02 suite.)
    const dataCalls = harness.http.calls.filter((call) => !call.url.includes('/auth/'))
    expect(dataCalls).toHaveLength(3)
  })
})

describe('dashboard loading', () => {
  it('shows a skeleton before the data lands', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', () => new Promise<never>(() => undefined))
      harness.http.on('/courses', () => new Promise<never>(() => undefined))
    })

    expect(await screen.findByRole('status', { name: 'Loading your courses' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    // The welcome block is already real: only the data areas are placeholders.
    expect(screen.getByRole('heading', { name: 'Welcome back, Iyed', level: 1 })).toBeInTheDocument()
  })
})

describe('dashboard success', () => {
  it('renders a card per enrolled course from the real response shape', async () => {
    await mountWith(fullDashboard)

    const inProgress = await screen.findByRole('list', { name: 'Courses in progress' })
    expect(within(inProgress).getAllByRole('listitem')).toHaveLength(1)
    expect(within(inProgress).getByRole('link', { name: 'Python Fundamentals' })).toBeInTheDocument()

    const completed = screen.getByRole('list', { name: 'Completed courses' })
    expect(
      within(completed).getByRole('link', { name: 'Project Management Essentials' }),
    ).toBeInTheDocument()
  })

  it('shows the backend progress percentage, not a recomputed one', async () => {
    await mountWith(fullDashboard)

    const inProgress = await screen.findByRole('list', { name: 'Courses in progress' })
    const bar = within(inProgress).getByRole('progressbar', {
      name: 'Python Fundamentals progress',
    })
    // 45.45 from the server, rounded only for display.
    expect(bar).toHaveAttribute('aria-valuenow', '45')
  })

  it('borrows the description from the catalogue response', async () => {
    await mountWith(fullDashboard)

    expect(await screen.findByText(catalogEnrolled.description)).toBeInTheDocument()
  })

  it('lists only published courses the member is not enrolled in', async () => {
    await mountWith(fullDashboard)

    const available = await screen.findByRole('list', { name: 'Available courses' })
    expect(within(available).getAllByRole('listitem')).toHaveLength(1)
    expect(
      within(available).getByRole('link', { name: 'Professional Communication' }),
    ).toBeInTheDocument()
    // The enrolled course must not appear again as "available".
    expect(
      within(available).queryByRole('link', { name: 'Python Fundamentals' }),
    ).not.toBeInTheDocument()
  })

  it('links every card to the real course id', async () => {
    await mountWith(fullDashboard)

    const inProgress = await screen.findByRole('list', { name: 'Courses in progress' })
    expect(within(inProgress).getByRole('link', { name: 'Python Fundamentals' })).toHaveAttribute(
      'href',
      `/courses/${enrollmentInProgress.course_id}`,
    )
    expect(
      within(inProgress).getByRole('link', { name: 'Continue: Python Fundamentals' }),
    ).toHaveAttribute('href', `/courses/${enrollmentInProgress.course_id}`)
  })

  it('navigates to the course when a card is followed', async () => {
    const { router } = await mountWith(fullDashboard)

    await userEvent.click(
      await screen.findByRole('link', { name: 'Python Fundamentals' }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/courses/${enrollmentInProgress.course_id}`)
    })
  })

  it('renders the continue card with the first unfinished video', async () => {
    await mountWith(fullDashboard)

    const card = await screen.findByRole('region', { name: 'Python Fundamentals' })
    expect(within(card).getByText(/Module 2/)).toBeInTheDocument()
    expect(within(card).getByText('Parameters and return values')).toBeInTheDocument()
    expect(within(card).getByText('5 of 11 videos completed')).toBeInTheDocument()
    expect(
      within(card).getByRole('link', {
        name: 'Continue Python Fundamentals: Parameters and return values',
      }),
    ).toHaveAttribute(
      'href',
      `/courses/${courseContent.course_id}/lessons/l2000000-0000-4000-8000-000000000001`,
    )
  })

  it('hides a section that has no courses', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
      harness.http.on('/courses', { json: page([catalogEnrolled]) })
      harness.http.on('/content', { json: courseContent })
    })

    await screen.findByRole('list', { name: 'Courses in progress' })
    expect(screen.queryByRole('list', { name: 'Completed courses' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Available courses' })).not.toBeInTheDocument()
  })
})

describe('dashboard empty state', () => {
  it('replaces the continue card when nothing is enrolled', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([]) })
      harness.http.on('/courses', { json: page([catalogAvailable]) })
    })

    expect(
      await screen.findByRole('heading', { name: 'You haven’t started a course yet' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Courses in progress' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Python/ })).not.toBeInTheDocument()
  })

  it('offers a CTA to a route that actually exists', async () => {
    const { router } = await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([]) })
      harness.http.on('/courses', { json: page([]) })
    })

    const cta = await screen.findByRole('link', { name: 'Browse courses' })
    expect(cta).toHaveAttribute('href', '/courses')

    await userEvent.click(cta)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/courses')
    })
  })

  it('never requests course content when there is nothing to continue', async () => {
    const { harness } = await mountWith((h) => {
      h.http.on('/me/enrollments', { json: page([]) })
      h.http.on('/courses', { json: page([]) })
    })

    await screen.findByRole('heading', { name: 'You haven’t started a course yet' })
    expect(harness.http.calls.filter((call) => call.url.includes('/content'))).toHaveLength(0)
  })
})

describe('dashboard errors', () => {
  it('shows the designed error when enrollments fail, with no technical detail', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { status: 500, json: { detail: 'Internal server error' } })
      harness.http.on('/courses', { json: page([catalogAvailable]) })
    })

    const heading = await screen.findByRole('heading', { name: 'We couldn’t load your courses' })
    expect(heading).toBeInTheDocument()
    expect(screen.queryByText(/Internal server error/)).not.toBeInTheDocument()
    expect(screen.queryByText(/500/)).not.toBeInTheDocument()
  })

  it('retries when the member asks', async () => {
    const { harness } = await mountWith((h) => {
      h.http.once('/me/enrollments', { status: 503, json: { detail: 'Unavailable' } })
      h.http.on('/me/enrollments', { json: page([enrollmentCompleted]) })
      h.http.on('/courses', { json: page([]) })
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('list', { name: 'Completed courses' })).toBeInTheDocument()
    expect(harness.http.callsTo('/me/enrollments').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the enrolled lists when only the catalogue fails', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
      harness.http.on('/courses', { status: 503, json: { detail: 'Unavailable' } })
      harness.http.on('/content', { json: courseContent })
    })

    // The page did not fail whole: the enrolled list is there ...
    expect(await screen.findByRole('list', { name: 'Courses in progress' })).toBeInTheDocument()
    // ... the optional section is not, and says so.
    expect(screen.queryByRole('list', { name: 'Available courses' })).not.toBeInTheDocument()
    expect(screen.getByText('We couldn’t load the available courses.')).toBeInTheDocument()
  })

  it('keeps the lists when only the continue card fails', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
      harness.http.on('/courses', { json: page([catalogEnrolled]) })
      harness.http.on('/content', { status: 500, json: { detail: 'Internal server error' } })
    })

    expect(await screen.findByRole('list', { name: 'Courses in progress' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Python Fundamentals' })).not.toBeInTheDocument()
  })
})

describe('dashboard request efficiency', () => {
  it('makes exactly three requests, and never one per course', async () => {
    const { harness } = await mountWith((h) => {
      h.http.on('/me/enrollments', {
        json: page([enrollmentInProgress, enrollmentCompleted]),
      })
      h.http.on('/courses', { json: page([catalogEnrolled, catalogAvailable]) })
      h.http.on('/content', { json: courseContent })
    })

    await screen.findByRole('list', { name: 'Courses in progress' })

    const dashboardCalls = harness.http.calls.filter((call) => !call.url.includes('/auth/'))
    expect(dashboardCalls).toHaveLength(3)
    expect(harness.http.callsTo('/me/enrollments')).toHaveLength(1)
    // One content call for the single course being continued, not one per card.
    expect(dashboardCalls.filter((call) => call.url.includes('/content'))).toHaveLength(1)
  })

  it('asks for one bounded page rather than everything', async () => {
    const { harness } = await mountWith(fullDashboard)

    await screen.findByRole('list', { name: 'Courses in progress' })
    const url = harness.http.callsTo('/me/enrollments')[0]?.url ?? ''
    expect(url).toContain('page=1')
    expect(url).toContain('page_size=100')
  })
})

describe('dashboard security', () => {
  it('puts no token anywhere in the rendered DOM', async () => {
    const { container, harness } = await mountWith(fullDashboard)

    await screen.findByRole('list', { name: 'Courses in progress' })

    const markup = container.innerHTML
    expect(markup).not.toContain('access-1')
    expect(markup).not.toContain('refresh-1')
    expect(markup).not.toContain('Bearer')
    expect(harness.accessTokens.get()).toBeTruthy()
  })

  it('shows only data the response carried', async () => {
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([enrollmentCompleted]) })
      harness.http.on('/courses', { json: page([]) })
    })

    const list = await screen.findByRole('list', { name: 'Completed courses' })
    // `enrollmentCompleted` has no catalogue entry, so no description exists.
    expect(screen.queryByText(/Plan, run and close a project/)).not.toBeInTheDocument()
    // BE-COURSE-CATALOG-01 (G05): the enrollment now carries its course's size
    // and video figures, so the card shows exactly those - and nothing else.
    expect(within(list).getByText('4 modules')).toBeInTheDocument()
    expect(within(list).getByText('14 videos')).toBeInTheDocument()
    expect(within(list).getByText('14 of 14 videos completed')).toBeInTheDocument()
    expect(screen.getAllByText(/modules?$/)).toHaveLength(1)
  })

  it('invents no count when the response carries none', async () => {
    // A response without the G05 figures, as a backend before
    // BE-COURSE-CATALOG-01 sent it: the lines are left out, not shown as 0.
    const { module_count: _m, total_video_lessons: _t, completed_video_lessons: _c, ...bare } =
      enrollmentCompleted
    await mountWith((harness) => {
      harness.http.on('/me/enrollments', { json: page([bare]) })
      harness.http.on('/courses', { json: page([]) })
    })

    await screen.findByRole('list', { name: 'Completed courses' })
    expect(screen.queryByText(/modules?$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/videos? completed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^0 /)).not.toBeInTheDocument()
  })
})

describe('dashboard responsive', () => {
  it('renders on a phone without losing any section', async () => {
    await mountWith(fullDashboard, viewports.mobile)

    expect(await screen.findByRole('list', { name: 'Courses in progress' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Available courses' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Python Fundamentals' })).toBeInTheDocument()
  })

  it('renders on a tablet', async () => {
    await mountWith(fullDashboard, viewports.tablet)

    expect(await screen.findByRole('list', { name: 'Courses in progress' })).toBeInTheDocument()
  })
})
