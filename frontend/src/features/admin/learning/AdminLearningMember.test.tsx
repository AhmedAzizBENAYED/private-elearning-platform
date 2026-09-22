import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../../test/authHarness'
import { adminMembers, membersPage } from '../../../test/courseFixtures'
import {
  EXCEL,
  PYTHON,
  SARRA,
  YASSINE,
  counts,
  daysAgo,
  learningEvent,
  memberLearning,
  minutesAgo,
  notStartedRow,
  progressRow,
} from '../../../test/learningFixtures'
import { renderRoute } from '../../../test/renderRoute'
import { viewports } from '../../../test/viewport'

const PAGE = `/admin/members/${SARRA.id}/learning`

function stub(harness: AuthHarness, detail = memberLearning()) {
  harness.http.on(`/learning/members/${SARRA.id}`, { json: detail })
}

const open = (path = PAGE, width = viewports.wide, beforeMount = stub) =>
  renderRoute({ path, as: 'admin', width, beforeMount })

describe('member learning - the page', () => {
  it('names the member and reads one endpoint for the whole page', async () => {
    const { harness } = await open()

    expect(await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(SARRA.email)).toBeInTheDocument()
    expect(harness.http.callsTo(`/learning/members/${SARRA.id}`)).toHaveLength(1)
  })

  it('asks for the member in the URL, not another one', async () => {
    const { harness } = await open(`/admin/members/${YASSINE.id}/learning`, viewports.wide, (harness) =>
      harness.http.on(`/learning/members/${YASSINE.id}`, {
        json: memberLearning({ member: YASSINE }),
      }),
    )

    await screen.findByRole('heading', { name: 'Yassine Ben Ammar', level: 1 })
    const call = harness.http.callsTo(`/learning/members/${YASSINE.id}`)[0]!
    expect(call.url).toContain(YASSINE.id)
    expect(call.url).not.toContain(SARRA.id)
  })

  it('shows the backend counts, over every published course', async () => {
    await open()
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    expect(screen.getByText('Courses started').closest('div')).toHaveTextContent('1 of 2')
    expect(screen.getByText(/1 started · 0 completed · 1 not started/)).toBeInTheDocument()
  })

  it('shows what the member is viewing now, with its lesson and module', async () => {
    await open()
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const panel = screen.getByRole('region', { name: 'Currently viewing' })
    expect(within(panel).getByRole('link', { name: EXCEL.title })).toBeInTheDocument()
    expect(panel).toHaveTextContent('Conditional formulas · Module 4 · Formulas')
    expect(panel).toHaveTextContent('12 / 16 lessons completed')
    expect(within(panel).getByText('Active now')).toBeInTheDocument()
  })

  it('says a member has opened nothing rather than inventing a location', async () => {
    await open(PAGE, viewports.wide, (harness) =>
      stub(
        harness,
        memberLearning({
          latest: null,
          last_activity_at: null,
          recent_events: [],
          counts: counts({ all: 2, not_started: 2, in_progress: 0, completed: 0, started: 0 }),
          courses: [notStartedRow(SARRA, EXCEL), notStartedRow(SARRA, PYTHON)],
        }),
      ),
    )
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    expect(screen.getByText('No course opened yet.')).toBeInTheDocument()
    expect(screen.getByText('No recorded event yet.')).toBeInTheDocument()
    expect(screen.getByText('Last active').closest('div')).toHaveTextContent('No activity yet')
  })

  it('lists every published course, the untouched ones included', async () => {
    await open()
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const section = screen.getByRole('region', { name: 'Course progress' })
    expect(within(section).getByRole('link', { name: EXCEL.title })).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: PYTHON.title })).toBeInTheDocument()
    expect(section).toHaveTextContent('75%')
    expect(section).toHaveTextContent('12 / 16 lessons · 3 / 5 modules')
    expect(section).toHaveTextContent('No lesson opened yet · 3 modules · 11 lessons')
  })

  it('shows a completion date instead of a last activity once a course is done', async () => {
    await open(PAGE, viewports.wide, (harness) =>
      stub(
        harness,
        memberLearning({
          courses: [
            progressRow(SARRA, EXCEL, {
              status: 'COMPLETED',
              progress_percent: 100,
              completed_at: '2026-09-17T09:00:00Z',
            }),
          ],
        }),
      ),
    )
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    expect(screen.getByText(/Completed 17 Sep 2026/)).toBeInTheDocument()
  })

  it('filters the course list by status, without asking the server again', async () => {
    const { harness } = await open()
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const section = screen.getByRole('region', { name: 'Course progress' })
    await userEvent.click(
      within(section).getByRole('button', { name: 'Not started: 1' }),
    )

    await waitFor(() => expect(within(section).queryByRole('link', { name: EXCEL.title })).toBeNull())
    expect(within(section).getByRole('link', { name: PYTHON.title })).toBeInTheDocument()
    // The endpoint answers with every course by contract; there is nothing more
    // to ask it for.
    expect(harness.http.callsTo(`/learning/members/${SARRA.id}`)).toHaveLength(1)
  })

  it('lists the recent events with their words and their instants', async () => {
    await open(PAGE, viewports.wide, (harness) =>
      stub(
        harness,
        memberLearning({
          recent_events: [
            learningEvent(),
            learningEvent({
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              type: 'lesson_completed',
              lesson_title: 'Named ranges',
              occurred_at: daysAgo(1),
            }),
          ],
        }),
      ),
    )
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const events = screen.getByRole('region', { name: 'Recent activity' })
    expect(within(events).getByText('Opened lesson · Conditional formulas')).toBeInTheDocument()
    expect(within(events).getByText('Completed lesson · Named ranges')).toBeInTheDocument()
  })

  it('shows another member’s events on their own page only', async () => {
    await open(`/admin/members/${YASSINE.id}/learning`, viewports.wide, (harness) =>
      harness.http.on(`/learning/members/${YASSINE.id}`, {
        json: memberLearning({
          member: YASSINE,
          latest: null,
          last_activity_at: null,
          recent_events: [learningEvent({ lesson_title: 'Types', course_title: PYTHON.title })],
          courses: [notStartedRow(YASSINE, PYTHON)],
        }),
      }),
    )
    await screen.findByRole('heading', { name: 'Yassine Ben Ammar', level: 1 })

    expect(screen.getByText('Opened lesson · Types')).toBeInTheDocument()
    expect(screen.queryByText('Opened lesson · Conditional formulas')).toBeNull()
    expect(screen.queryByText('75%')).toBeNull()
  })
})

describe('member learning - navigation and states', () => {
  it('offers the two tabs of the board, and comes back from the profile', async () => {
    await open()
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const tabs = screen.getByRole('navigation', { name: 'Member views' })
    expect(within(tabs).getByRole('link', { name: 'Profile & account' })).toHaveAttribute(
      'href',
      `/admin/members/${SARRA.id}`,
    )
  })

  it('is reachable from the member profile', async () => {
    const member = adminMembers[0]!
    await renderRoute({
      path: `/admin/members/${member.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        harness.http.on('/admin/members', { json: membersPage() })
        harness.http.on(`/admin/members/${member.id}`, { json: member })
      },
    })
    await screen.findByRole('heading', { level: 1 })

    const tabs = screen.getByRole('navigation', { name: 'Member views' })
    expect(within(tabs).getByRole('link', { name: 'Learning progress' })).toHaveAttribute(
      'href',
      `/admin/members/${member.id}/learning`,
    )
  })

  it('says so when the member does not exist', async () => {
    await open(PAGE, viewports.wide, (harness) =>
      harness.http.on(`/learning/members/${SARRA.id}`, {
        status: 404,
        json: { detail: 'Member not found' },
      }),
    )

    expect(await screen.findByRole('heading', { name: 'Member not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all members/i })).toHaveAttribute('href', '/admin/members')
  })

  it('offers a retry when the server is unavailable', async () => {
    const { harness } = await open(PAGE, viewports.wide, (harness) =>
      harness.http.on(`/learning/members/${SARRA.id}`, { status: 500, json: { detail: 'boom' } }),
    )

    expect(
      await screen.findByRole('heading', { name: /couldn’t load this member’s progress/i }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(harness.http.callsTo(`/learning/members/${SARRA.id}`)).toHaveLength(2))
  })
})

describe('member learning - responsive and accessibility', () => {
  for (const width of [viewports.wide, viewports.laptop, viewports.tablet, 600, viewports.mobile, 375]) {
    it(`renders at ${width}px`, async () => {
      await open(PAGE, width)
      expect(await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Course progress' })).toBeInTheDocument()
    })
  }

  it('has no serious or critical violations', async () => {
    const { container } = await open()
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const results = await axe.run(container, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(
      results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
    ).toEqual([])
  })

  it('keeps the last event’s exact instant as a machine-readable time', async () => {
    const at = minutesAgo(2)
    await open(PAGE, viewports.wide, (harness) =>
      stub(harness, memberLearning({ recent_events: [learningEvent({ occurred_at: at })] })),
    )
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const events = screen.getByRole('region', { name: 'Recent activity' })
    expect(within(events).getByRole('time')).toHaveAttribute('datetime', at)
  })
})
