import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../../test/authHarness'
import {
  EXCEL,
  SARRA,
  YASSINE,
  activityPage,
  activityRow,
  daysAgo,
  minutesAgo,
  silentRow,
} from '../../../test/learningFixtures'
import { renderRoute } from '../../../test/renderRoute'
import { viewports } from '../../../test/viewport'

const ACTIVITY = '/admin/learning/activity'

const rows = [
  activityRow(SARRA),
  activityRow(YASSINE, {
    last_activity_at: daysAgo(11),
    progress_percent: 27,
    completed_video_lessons: 3,
    total_video_lessons: 11,
    lesson: {
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Types',
      module_id: '88888888-8888-4888-8888-888888888888',
      module_title: 'Basics',
      module_position: 1,
    },
  }),
]

function stub(harness: AuthHarness, page = activityPage(rows, { members_with_activity: 2 })) {
  harness.http.on('/admin/learning/activity', { json: page })
}

const open = (path = ACTIVITY, width = viewports.wide, beforeMount = stub) =>
  renderRoute({ path, as: 'admin', width, beforeMount })

function lastQuery(harness: AuthHarness): URLSearchParams {
  const calls = harness.http.callsTo('/admin/learning/activity')
  const last = calls[calls.length - 1]
  if (last === undefined) throw new Error('no activity request was made')
  return new URL(last.url, 'http://localhost').searchParams
}

describe('learning activity - the table', () => {
  it('shows each member’s last course and last lesson', async () => {
    await open()
    const table = await screen.findByRole('table')

    const sarra = within(table)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Sarra'))!
    expect(within(sarra).getByRole('link', { name: EXCEL.title })).toBeInTheDocument()
    expect(sarra).toHaveTextContent('Conditional formulas')
    expect(sarra).toHaveTextContent('Module 4 · Formulas')
    expect(sarra).toHaveTextContent('75%')
    expect(sarra).toHaveTextContent('12 / 16')
  })

  it('says "Viewing now" inside the five-minute window and "Last viewed" outside it', async () => {
    await open()
    const table = await screen.findByRole('table')

    const sarra = within(table).getAllByRole('row').find((row) => row.textContent?.includes('Sarra'))!
    const yassine = within(table).getAllByRole('row').find((row) => row.textContent?.includes('Yassine'))!
    expect(sarra).toHaveTextContent('Viewing now')
    expect(sarra).toHaveTextContent('Active now')
    expect(yassine).toHaveTextContent('Last viewed')
    expect(yassine).not.toHaveTextContent('Active now')
    expect(yassine).toHaveTextContent('11 days ago')
  })

  it('keeps a member with no recorded activity, and says so', async () => {
    await open(ACTIVITY, viewports.wide, (harness) =>
      stub(harness, activityPage([silentRow(YASSINE)], { members_with_activity: 0 })),
    )
    const table = await screen.findByRole('table')

    expect(table).toHaveTextContent('No course opened yet')
    expect(table).toHaveTextContent('No activity yet')
    // No invented figure for a member who has done nothing.
    expect(table).not.toHaveTextContent('0%')
  })

  it('explains what "Active now" means, in the design’s own words', async () => {
    await open()
    await screen.findByRole('table')

    expect(screen.getByText(/a learning event was received in the last 5 minutes/i)).toBeInTheDocument()
  })

  it('reads the endpoint once, and never polls', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await waitFor(() => expect(harness.http.callsTo('/admin/learning/activity')).toHaveLength(1))
    // Give any stray interval or effect loop a chance to fire before concluding.
    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('Active now').length).toBe(1)
    expect(harness.http.callsTo('/admin/learning/activity')).toHaveLength(1)
  })
})

describe('learning activity - filters', () => {
  it('sends the search to the backend', async () => {
    const { harness, router } = await open()
    await screen.findByRole('table')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search member or course' }), 'sarra')

    await waitFor(() => expect(lastQuery(harness).get('search')).toBe('sarra'))
    expect(router.state.location.search).toContain('search=sarra')
  })

  it('turns "Active now" into active_since and only_active', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Filter by activity' })).getByRole('button', {
        name: /Active now/,
      }),
    )

    await waitFor(() => {
      const query = lastQuery(harness)
      expect(query.get('only_active')).toBe('true')
      const minutes = (Date.now() - new Date(query.get('active_since')!).getTime()) / 60_000
      expect(minutes).toBeGreaterThan(4.5)
      expect(minutes).toBeLessThan(6)
    })
  })

  it('asks for a week when the week window is chosen', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Filter by activity' })).getByRole('button', {
        name: /Active this week/,
      }),
    )

    await waitFor(() => {
      const days = (Date.now() - new Date(lastQuery(harness).get('active_since')!).getTime()) / 86_400_000
      expect(days).toBeGreaterThan(6.5)
      expect(days).toBeLessThan(7.5)
    })
  })

  it('sends no window at all for "Any activity"', async () => {
    const { harness } = await open()
    await screen.findByRole('table')

    expect(lastQuery(harness).get('active_since')).toBeNull()
    expect(lastQuery(harness).get('only_active')).toBeNull()
  })

  it('shows the backend’s own count for the chosen window', async () => {
    await open(`${ACTIVITY}?activity=now`, viewports.wide, (harness) =>
      stub(harness, activityPage(rows, { members_with_activity: 2, active_members: 1 })),
    )
    await screen.findByRole('table')

    const group = screen.getByRole('group', { name: 'Filter by activity' })
    expect(within(group).getByRole('button', { name: 'Active now: 1' })).toBeInTheDocument()
    expect(screen.getByText('With recorded activity').closest('div')).toHaveTextContent('2')
  })

  it('pages through the members', async () => {
    const { harness } = await open(ACTIVITY, viewports.wide, (harness) =>
      stub(harness, activityPage(rows, { total: 48, page: 1, page_size: 20 })),
    )
    await screen.findByRole('table')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(lastQuery(harness).get('page')).toBe('2'))
  })

  it('re-reads on Refresh, and only then', async () => {
    const { harness } = await open()
    await screen.findByRole('table')
    expect(harness.http.callsTo('/admin/learning/activity')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(harness.http.callsTo('/admin/learning/activity')).toHaveLength(2))
  })
})

describe('learning activity - states', () => {
  it('explains a failure and retries', async () => {
    const { harness } = await open(ACTIVITY, viewports.wide, (harness) => {
      harness.http.on('/admin/learning/activity', { status: 503, json: { detail: 'down' } })
    })

    expect(
      await screen.findByRole('heading', { name: /couldn’t load the learning activity/i }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(harness.http.callsTo('/admin/learning/activity').length).toBe(2))
  })

  it('has its own words for an empty window', async () => {
    await open(`${ACTIVITY}?activity=now`, viewports.wide, (harness) =>
      stub(harness, activityPage([], { total: 0, members_with_activity: 0, active_members: 0 })),
    )

    expect(await screen.findByRole('heading', { name: /No member matches these filters/i })).toBeInTheDocument()
  })
})

describe('learning activity - responsive', () => {
  for (const width of [viewports.wide, viewports.laptop, viewports.tablet, 600]) {
    it(`keeps the table at ${width}px`, async () => {
      await open(ACTIVITY, width)
      expect(await screen.findByRole('table')).toBeInTheDocument()
    })
  }

  for (const width of [viewports.mobile, 375]) {
    it(`draws cards at ${width}px`, async () => {
      await open(ACTIVITY, width)

      expect(await screen.findByText('Conditional formulas · Module 4')).toBeInTheDocument()
      expect(screen.queryByRole('table')).toBeNull()
    })
  }
})

describe('learning activity - accessibility', () => {
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

  it('marks the Activity tab as the one being viewed', async () => {
    await open()
    await screen.findByRole('table')

    const tabs = screen.getByRole('navigation', { name: 'Learning progress views' })
    expect(within(tabs).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })

  it('reaches the window filters with the keyboard', async () => {
    await open()
    await screen.findByRole('table')

    const group = screen.getByRole('group', { name: 'Filter by activity' })
    const first = within(group).getAllByRole('button')[0]!
    first.focus()
    expect(first).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(first).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the exact instant behind the relative phrase', async () => {
    await open(ACTIVITY, viewports.wide, (harness) =>
      stub(harness, activityPage([activityRow(SARRA, { last_activity_at: minutesAgo(2) })])),
    )
    const table = await screen.findByRole('table')

    expect(within(table).getByText('2 min ago').closest('span')).toHaveAttribute('title')
  })
})
