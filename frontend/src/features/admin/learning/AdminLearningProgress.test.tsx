import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../../test/authHarness'
import {
  EXCEL,
  PYTHON,
  SARRA,
  YASSINE,
  counts,
  minutesAgo,
  notStartedRow,
  progressPage,
  progressRow,
  publishedCoursesPage,
} from '../../../test/learningFixtures'
import { renderRoute } from '../../../test/renderRoute'
import { viewports } from '../../../test/viewport'

const PROGRESS = '/admin/learning'

/** Sarra is working through both courses; Yassine has opened neither. */
const rows = [
  progressRow(SARRA, PYTHON, { progress_percent: 45.45, completed_video_lessons: 5 }),
  progressRow(SARRA, EXCEL, {
    status: 'COMPLETED',
    progress_percent: 100,
    completed_video_lessons: 16,
    total_video_lessons: 16,
    completed_modules: 5,
    total_modules: 5,
    completed_at: '2026-09-17T10:00:00Z',
  }),
  notStartedRow(YASSINE, PYTHON),
  notStartedRow(YASSINE, EXCEL),
]

function stub(harness: AuthHarness, page = progressPage(rows, { counts: counts() })) {
  harness.http.on('/admin/courses', { json: publishedCoursesPage() })
  harness.http.on('/admin/learning/progress', { json: page })
}

const open = (path = PROGRESS, width = viewports.wide, beforeMount = stub) =>
  renderRoute({ path, as: 'admin', width, beforeMount })

/** The query string of the last progress request. */
function lastProgressQuery(harness: AuthHarness): URLSearchParams {
  const calls = harness.http.callsTo('/admin/learning/progress')
  const last = calls[calls.length - 1]
  if (last === undefined) throw new Error('no progress request was made')
  return new URL(last.url, 'http://localhost').searchParams
}

describe('learning progress - the matrix', () => {
  it('shows every member and every published course', async () => {
    await open()

    expect(await screen.findByRole('heading', { name: 'Learning progress', level: 1 })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: /Python Fundamentals/ })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Excel for Engineers/ })).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Sarra Mansour' })).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Yassine Ben Ammar' })).toBeInTheDocument()
  })

  it('shows the backend percentage, the lessons and the status of each pair', async () => {
    await open()
    const table = await screen.findByRole('table')

    const sarra = within(table).getAllByRole('row')[1]!
    expect(sarra).toHaveTextContent('45%')
    expect(sarra).toHaveTextContent('5 / 11 lessons')
    expect(within(sarra).getByText('Completed')).toBeInTheDocument()
    expect(sarra).toHaveTextContent('Completed 17 Sep 2026')
  })

  it('keeps each member to their own figures', async () => {
    await open()
    const table = await screen.findByRole('table')

    const yassine = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Yassine'))!
    // Sarra's 45% and her completion must not leak into the other member's row.
    expect(yassine).not.toHaveTextContent('45%')
    expect(yassine).not.toHaveTextContent('17 Sep 2026')
    expect(within(yassine).getAllByText('Not started').length).toBe(2)
    // A pair with no activity has no figure at all: the board's dashed block,
    // not a bar sitting at zero.
    expect(yassine).toHaveTextContent('No lesson opened yet · 11 lessons')
    expect(yassine).not.toHaveTextContent('0%')
    expect(within(yassine).queryAllByRole('progressbar')).toEqual([])
  })

  it('marks a deactivated account, as the boards do', async () => {
    await open()
    const table = await screen.findByRole('table')

    const yassine = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Yassine'))!
    expect(yassine).toHaveTextContent('Account inactive')
  })

  it('counts a member’s started and completed courses under their name', async () => {
    await open()
    const table = await screen.findByRole('table')

    expect(table).toHaveTextContent('2 of 2 started · 1 completed')
    expect(table).toHaveTextContent('0 of 2 started · 0 completed')
  })

  it('asks for whole members: one page is courses × members, ordered by member', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    const query = lastProgressQuery(harness)
    // Two published courses, so a page of 100 pairs holds 50 whole members.
    expect(query.get('page_size')).toBe('100')
    expect(query.get('sort')).toBe('member')
  })

  it('reads the catalogue and the pairs once each', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await waitFor(() =>
      expect(harness.http.callsTo('/admin/learning/progress')).toHaveLength(1),
    )
    expect(harness.http.callsTo('/admin/courses')).toHaveLength(1)
  })
})

describe('learning progress - the figures', () => {
  it('shows the backend counts, not a count of the rows on screen', async () => {
    await open(PROGRESS, viewports.wide, (harness) =>
      stub(
        harness,
        progressPage(rows, {
          total: 288,
          counts: counts({ all: 288, not_started: 150, in_progress: 81, completed: 57, started: 138 }),
        }),
      ),
    )
    await screen.findByRole('table')

    const pairs = screen.getByText('Member × course pairs').closest('div')!
    expect(pairs).toHaveTextContent('288')
    const started = screen.getByText('Started').closest('div')!
    expect(started).toHaveTextContent('138')
    // 150 not started, though only four rows are on screen: the figure is the
    // server's count of the whole filtered set.
    const notStarted = screen
      .getAllByText('Not started')
      .map((node) => node.closest('div')!)
      .find((card) => card.textContent?.includes('150'))
    expect(notStarted).toBeDefined()
  })

  it('sizes every status chip from the same counts', async () => {
    await open()
    await screen.findByRole('table')

    const group = screen.getByRole('group', { name: 'Filter by status' })
    expect(within(group).getByRole('button', { name: 'All: 4' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Completed: 1' })).toBeInTheDocument()
    // Two of the four rows on screen are "Not started", and the chip still
    // shows the server's own figure for the whole filtered set.
    expect(within(group).getByRole('button', { name: 'Not started: 1' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'In progress: 2' })).toBeInTheDocument()
  })
})

describe('learning progress - filters', () => {
  it('sends the search to the backend and puts it in the URL', async () => {
    const { harness, router } = await open()
    await screen.findByRole('table')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search member or course' }), 'sarra')

    await waitFor(() => expect(lastProgressQuery(harness).get('search')).toBe('sarra'))
    expect(router.state.location.search).toContain('search=sarra')
  })

  it('sends the course filter as course_id', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), PYTHON.id)

    await waitFor(() => expect(lastProgressQuery(harness).get('course_id')).toBe(PYTHON.id))
  })

  it('sends the status filter, and never filters the page here', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', {
        name: 'Completed: 1',
      }),
    )

    await waitFor(() => expect(lastProgressQuery(harness).get('status')).toBe('COMPLETED'))
  })

  it('turns the activity window into active_since', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Activity' }), 'now')

    await waitFor(() => {
      const since = lastProgressQuery(harness).get('active_since')
      expect(since).not.toBeNull()
      // The design's own window: a learning event in the last five minutes.
      const minutes = (Date.now() - new Date(since!).getTime()) / 60_000
      expect(minutes).toBeGreaterThan(4.5)
      expect(minutes).toBeLessThan(6)
    })
  })

  it('sends the sort the list view offers', async () => {
    const { harness } = await open(`${PROGRESS}?view=list`)
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), '-progress')

    await waitFor(() => expect(lastProgressQuery(harness).get('sort')).toBe('-progress'))
  })

  it('starts again at the first page when a filter changes', async () => {
    const { harness, router } = await open(`${PROGRESS}?view=list&page=3`)
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Course' }), EXCEL.id)

    await waitFor(() => expect(lastProgressQuery(harness).get('page')).toBe('1'))
    expect(router.state.location.search).not.toContain('page=3')
  })
})

describe('learning progress - the list view', () => {
  it('shows one row per pair, with its dates', async () => {
    await open(`${PROGRESS}?view=list`)
    const table = await screen.findByRole('table')

    expect(within(table).getByRole('columnheader', { name: 'Started' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Completed' })).toBeInTheDocument()
    const row = within(table)
      .getAllByRole('row')
      .find((candidate) => candidate.textContent?.includes('Python Fundamentals'))!
    expect(row).toHaveTextContent('08 Sep 2026')
  })

  it('shows an em dash where the backend sent no date', async () => {
    await open(`${PROGRESS}?view=list`)
    const table = await screen.findByRole('table')

    const yassine = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Yassine'))!
    expect(yassine).toHaveTextContent('—')
    expect(yassine).not.toHaveTextContent('Sep 2026')
  })

  it('pages with the backend’s own page and total', async () => {
    const { harness } = await open(`${PROGRESS}?view=list`, viewports.wide, (harness) =>
      stub(harness, progressPage(rows, { total: 60, page: 1, page_size: 20 })),
    )
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(lastProgressQuery(harness).get('page')).toBe('2'))
  })
})

describe('learning progress - states', () => {
  it('explains a failure and offers to try again', async () => {
    const { harness } = await open(PROGRESS, viewports.wide, (harness) => {
      harness.http.on('/admin/courses', { json: publishedCoursesPage() })
      harness.http.on('/admin/learning/progress', { status: 500, json: { detail: 'boom' } })
    })

    expect(
      await screen.findByRole('heading', { name: /couldn’t load the learning progress/i }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(harness.http.callsTo('/admin/learning/progress').length).toBe(2))
  })

  it('offers a way out of an empty filtered result', async () => {
    const { router } = await open(`${PROGRESS}?status=COMPLETED`, viewports.wide, (harness) =>
      stub(harness, progressPage([], { total: 0, counts: counts({ all: 4 }) })),
    )

    expect(await screen.findByRole('heading', { name: /No row matches these filters/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(router.state.location.search).not.toContain('status'))
  })

  it('says so when there is nothing to report at all', async () => {
    await open(PROGRESS, viewports.wide, (harness) =>
      stub(
        harness,
        progressPage([], {
          total: 0,
          counts: counts({ all: 0, not_started: 0, in_progress: 0, completed: 0, started: 0 }),
        }),
      ),
    )

    expect(await screen.findByRole('heading', { name: /Nothing to report yet/i })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('learning progress - responsive', () => {
  for (const width of [viewports.wide, viewports.desktop, viewports.laptop]) {
    it(`draws the matrix at ${width}px`, async () => {
      await open(PROGRESS, width)
      expect(await screen.findByRole('table')).toBeInTheDocument()
    })
  }

  for (const width of [600, 768]) {
    it(`falls back to the list table at ${width}px, where a matrix would not fit`, async () => {
      await open(PROGRESS, width)
      const table = await screen.findByRole('table')
      expect(within(table).getByRole('columnheader', { name: 'Course' })).toBeInTheDocument()
    })
  }

  for (const width of [viewports.mobile, 375]) {
    it(`draws a card per member at ${width}px, as the mobile board does`, async () => {
      await open(PROGRESS, width)

      expect(await screen.findByText('2 of 2 started · 1 completed')).toBeInTheDocument()
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.getByText('2 courses not started')).toBeInTheDocument()
    })
  }
})

describe('learning progress - accessibility', () => {
  it('has no serious or critical violations', async () => {
    const { container } = await open()
    await screen.findByRole('table')

    const results = await axe.run(container, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(
      results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
    ).toEqual([])
  })

  it('reaches the filters and the rows with the keyboard alone', async () => {
    await open()
    await screen.findByRole('table')

    const search = screen.getByRole('searchbox', { name: 'Search member or course' })
    search.focus()
    await userEvent.tab()
    expect(screen.getByRole('combobox', { name: 'Course' })).toHaveFocus()
  })

  it('names the tabs and marks the one being viewed', async () => {
    await open()
    await screen.findByRole('table')

    const tabs = screen.getByRole('navigation', { name: 'Learning progress views' })
    expect(within(tabs).getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: 'Activity' })).not.toHaveAttribute('aria-current')
  })

  it('links a member to their own learning page', async () => {
    await open()
    await screen.findByRole('table')

    expect(screen.getByRole('link', { name: 'Sarra Mansour' })).toHaveAttribute(
      'href',
      `/admin/members/${SARRA.id}/learning`,
    )
  })
})

describe('learning progress - activity window', () => {
  it('shows "Active now" for an event inside the design’s five minutes', async () => {
    await open(`${PROGRESS}?view=list`, viewports.wide, (harness) =>
      stub(
        harness,
        progressPage([progressRow(SARRA, PYTHON, { last_activity_at: minutesAgo(2) })]),
      ),
    )
    const table = await screen.findByRole('table')

    expect(within(table).getByText('Active now')).toBeInTheDocument()
  })

  it('shows the date, not a presence, for an older event', async () => {
    await open(`${PROGRESS}?view=list`, viewports.wide, (harness) =>
      stub(
        harness,
        progressPage([progressRow(SARRA, PYTHON, { last_activity_at: minutesAgo(90) })]),
      ),
    )
    const table = await screen.findByRole('table')

    expect(within(table).queryByText('Active now')).toBeNull()
    expect(within(table).getByText('1 hour ago')).toBeInTheDocument()
  })
})

describe('learning progress - the Matrix / List switch', () => {
  it('is the two joined options of the board, named "View" for assistive technology', async () => {
    await open()
    await screen.findByRole('table')

    const group = screen.getByRole('radiogroup', { name: 'View' })
    const [matrix, list] = within(group).getAllByRole('radio')
    expect(matrix).toHaveAccessibleName('Matrix')
    expect(list).toHaveAccessibleName('List')
    // The board prints no "View" caption beside the title: the two options say
    // what they choose, so the label is kept for the group's name only.
    expect(screen.getByText('View').className).toMatch(/labelHidden/)
    // jsdom lays nothing out, so the width cannot be measured here; what can be
    // pinned is that this instance still carries the rule that sizes it to its
    // two options instead of letting the title squeeze it to a sliver.
    expect(group.parentElement?.className).toMatch(/viewSwitch/)
  })

  it('marks the view being shown, and only that one', async () => {
    await open()
    await screen.findByRole('table')

    const group = screen.getByRole('radiogroup', { name: 'View' })
    expect(within(group).getByRole('radio', { name: 'Matrix' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'List' })).not.toBeChecked()
  })

  it('switches to the list and says so in the URL', async () => {
    const { router } = await open()
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('radio', { name: 'List' }))

    await waitFor(() => expect(router.state.location.search).toContain('view=list'))
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Course' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked()
  })

  it('goes back to the matrix, leaving no view parameter behind', async () => {
    const { router } = await open(`${PROGRESS}?view=list`)
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('radio', { name: 'Matrix' }))

    await waitFor(() => expect(router.state.location.search).not.toContain('view=list'))
  })

  it('moves between the two options with the arrow keys', async () => {
    const { router } = await open()
    await screen.findByRole('table')

    const matrix = screen.getByRole('radio', { name: 'Matrix' })
    matrix.focus()
    expect(matrix).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => expect(router.state.location.search).toContain('view=list'))
    expect(screen.getByRole('radio', { name: 'List' })).toHaveFocus()
  })

  it('keeps one tab stop, as a radio group does', async () => {
    await open()
    await screen.findByRole('table')

    expect(screen.getByRole('radio', { name: 'Matrix' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('tabindex', '-1')
  })

  for (const width of [viewports.wide, viewports.desktop, viewports.laptop, viewports.tablet, 600, viewports.mobile, 375]) {
    it(`offers both options at ${width}px`, async () => {
      await open(PROGRESS, width)
      await screen.findByRole('heading', { name: 'Learning progress', level: 1 })

      const group = screen.getByRole('radiogroup', { name: 'View' })
      expect(within(group).getAllByRole('radio')).toHaveLength(2)
      expect(screen.getByText('View').className).toMatch(/labelHidden/)
    })
  }
})
