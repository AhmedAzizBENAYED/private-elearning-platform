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
  courseSummary,
  notStartedRow,
  progressPage,
  progressRow,
  publishedCoursesPage,
} from '../../../test/learningFixtures'
import { renderRoute } from '../../../test/renderRoute'
import { viewports } from '../../../test/viewport'

const BY_COURSE = '/admin/learning/courses'
const COURSE = `/admin/learning/courses/${PYTHON.id}`

const rows = [
  progressRow(SARRA, PYTHON, { progress_percent: 45.45, completed_video_lessons: 5 }),
  notStartedRow(YASSINE, PYTHON),
]

function stubCourse(harness: AuthHarness) {
  harness.http.on(`/courses/${PYTHON.id}/learning`, { json: courseSummary() })
  harness.http.on('/admin/learning/progress', { json: progressPage(rows) })
}

function stubByCourse(harness: AuthHarness) {
  harness.http.on('/admin/courses', { json: publishedCoursesPage() })
  harness.http.on(`/courses/${PYTHON.id}/learning`, { json: courseSummary() })
  harness.http.on(`/courses/${EXCEL.id}/learning`, {
    json: courseSummary({
      course: EXCEL,
      total_modules: 5,
      total_video_lessons: 16,
      counts: counts({ all: 48, not_started: 22, in_progress: 17, completed: 9, started: 26 }),
      average_progress_percent: 49,
      completion_rate_percent: 34.62,
    }),
  })
}

const open = (path: string, beforeMount: (harness: AuthHarness) => void, width = viewports.wide) =>
  renderRoute({ path, as: 'admin', width, beforeMount })

describe('course analytics', () => {
  it('shows the course, its size and the backend’s figures', async () => {
    await open(COURSE, stubCourse)

    expect(await screen.findByRole('heading', { name: PYTHON.title, level: 1 })).toBeInTheDocument()
    expect(
      screen.getByText(/3 modules · 11 video lessons · only video lessons count toward progress/),
    ).toBeInTheDocument()
    const memberCard = screen
      .getAllByText('Members')
      .map((node) => node.closest('div'))
      .find((card) => card?.textContent?.includes('can access it'))
    expect(memberCard).toHaveTextContent('48')
    const startedCard = screen
      .getAllByText('Started')
      .map((node) => node.closest('div'))
      .find((card) => card?.textContent?.includes('of members'))
    expect(startedCard).toHaveTextContent('31')
    // 31 of 48, as the backend counted them - not a share of the rows loaded.
    expect(startedCard).toHaveTextContent('65% of members')
    expect(screen.getByText('Average progress').closest('div')).toHaveTextContent('58%')
    expect(screen.getByText('Completion rate').closest('div')).toHaveTextContent('39%')
  })

  it('never recomputes the average or the rate here', async () => {
    await open(COURSE, (harness) => {
      harness.http.on(`/courses/${PYTHON.id}/learning`, {
        json: courseSummary({ average_progress_percent: 12.34, completion_rate_percent: 7.5 }),
      })
      harness.http.on('/admin/learning/progress', { json: progressPage(rows) })
    })
    await screen.findByRole('heading', { name: PYTHON.title, level: 1 })

    // The rows on screen average 22.7%; the card shows the server's 12.34.
    expect(screen.getByText('Average progress').closest('div')).toHaveTextContent('12%')
    expect(screen.getByText('Completion rate').closest('div')).toHaveTextContent('8%')
  })

  it('splits the members by status, in words as well as colour', async () => {
    await open(COURSE, stubCourse)
    await screen.findByRole('heading', { name: PYTHON.title, level: 1 })

    const panel = screen.getByRole('region', { name: 'Status of the 48 members' })
    expect(panel).toHaveTextContent('Completed 12')
    expect(panel).toHaveTextContent('In progress 19')
    expect(panel).toHaveTextContent('Not started 17')
    expect(panel).toHaveTextContent('= 12 completed ÷ 31 started')
  })

  it('reads the member rows for this course only', async () => {
    const { harness } = await open(COURSE, stubCourse)
    await screen.findByRole('table')

    for (const call of harness.http.callsTo('/admin/learning/progress')) {
      expect(new URL(call.url, 'http://localhost').searchParams.get('course_id')).toBe(PYTHON.id)
    }
  })

  it('shows each member’s own row', async () => {
    await open(COURSE, stubCourse)
    const table = await screen.findByRole('table')

    const sarra = within(table).getAllByRole('row').find((row) => row.textContent?.includes('Sarra'))!
    const yassine = within(table).getAllByRole('row').find((row) => row.textContent?.includes('Yassine'))!
    expect(sarra).toHaveTextContent('45%')
    expect(sarra).toHaveTextContent('5 / 11')
    expect(yassine).toHaveTextContent('0 / 11')
    expect(yassine).not.toHaveTextContent('45%')
  })

  it('sends the member filters of this screen to the backend', async () => {
    const { harness } = await open(COURSE, stubCourse)
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'COMPLETED')

    await waitFor(() => {
      const calls = harness.http.callsTo('/admin/learning/progress')
      const last = new URL(calls[calls.length - 1]!.url, 'http://localhost').searchParams
      expect(last.get('status')).toBe('COMPLETED')
      expect(last.get('course_id')).toBe(PYTHON.id)
    })
  })

  it('defaults the member list to progress, high to low', async () => {
    const { harness } = await open(COURSE, stubCourse)
    await screen.findByRole('table')

    const calls = harness.http.callsTo('/admin/learning/progress')
    const rowsCall = calls.find((call) => call.url.includes('page_size=20'))!
    expect(new URL(rowsCall.url, 'http://localhost').searchParams.get('sort')).toBe('-progress')
  })

  it('names the three most recently active members', async () => {
    await open(COURSE, stubCourse)
    await screen.findByRole('heading', { name: PYTHON.title, level: 1 })

    const panel = screen.getByRole('region', { name: 'Using it now or recently' })
    expect(within(panel).getByRole('link', { name: 'Sarra Mansour' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('45% of the course')
  })

  it('refuses to report on a course that is not published', async () => {
    await open(COURSE, (harness) => {
      harness.http.on(`/courses/${PYTHON.id}/learning`, {
        status: 404,
        json: { detail: 'Published course not found' },
      })
      harness.http.on('/admin/learning/progress', { json: progressPage([]) })
    })

    expect(await screen.findByRole('heading', { name: /No published course here/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all courses/i })).toHaveAttribute(
      'href',
      '/admin/learning/courses',
    )
  })

  it('links to the course editor', async () => {
    await open(COURSE, stubCourse)
    await screen.findByRole('heading', { name: PYTHON.title, level: 1 })

    expect(screen.getByRole('link', { name: /edit course/i })).toHaveAttribute(
      'href',
      `/admin/courses/${PYTHON.id}`,
    )
  })

  it('has no serious or critical violations', async () => {
    const { container } = await open(COURSE, stubCourse)
    await screen.findByRole('table')

    const results = await axe.run(container, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(
      results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
    ).toEqual([])
  })

  for (const width of [viewports.wide, viewports.laptop, viewports.tablet, 600, viewports.mobile, 375]) {
    it(`renders at ${width}px`, async () => {
      await open(COURSE, stubCourse, width)
      expect(await screen.findByRole('heading', { name: PYTHON.title, level: 1 })).toBeInTheDocument()
    })
  }
})

describe('by course', () => {
  it('lists the published courses with their own figures', async () => {
    await open(BY_COURSE, stubByCourse)
    const table = await screen.findByRole('table')

    const python = within(table).getAllByRole('row').find((row) => row.textContent?.includes(PYTHON.title))!
    expect(python).toHaveTextContent('3 modules · 11 video lessons')
    expect(python).toHaveTextContent('31 of 48')
    expect(python).toHaveTextContent('58%')
    expect(python).toHaveTextContent('39%')

    const excel = within(table).getAllByRole('row').find((row) => row.textContent?.includes(EXCEL.title))!
    expect(excel).toHaveTextContent('26 of 48')
    expect(excel).toHaveTextContent('49%')
  })

  it('asks for the published catalogue only', async () => {
    const { harness } = await open(BY_COURSE, stubByCourse)
    await screen.findByRole('table')

    const call = harness.http.callsTo('/admin/courses')[0]!
    expect(new URL(call.url, 'http://localhost').searchParams.get('status')).toBe('PUBLISHED')
  })

  it('reads each course’s figures exactly once', async () => {
    const { harness } = await open(BY_COURSE, stubByCourse)
    await screen.findByRole('table')

    await waitFor(() => {
      expect(harness.http.callsTo(`/courses/${PYTHON.id}/learning`)).toHaveLength(1)
      expect(harness.http.callsTo(`/courses/${EXCEL.id}/learning`)).toHaveLength(1)
    })
  })

  it('opens a course from its row', async () => {
    await open(BY_COURSE, stubByCourse)
    const table = await screen.findByRole('table')

    expect(within(table).getByRole('link', { name: `Open ${PYTHON.title}` })).toHaveAttribute(
      'href',
      `/admin/learning/courses/${PYTHON.id}`,
    )
  })

  it('says so when nothing is published', async () => {
    await open(BY_COURSE, (harness) => {
      harness.http.on('/admin/courses', { json: { items: [], total: 0, page: 1, page_size: 10 } })
    })

    expect(await screen.findByRole('heading', { name: /No published course yet/i })).toBeInTheDocument()
  })

  it('explains a failure of the figures', async () => {
    await open(BY_COURSE, (harness) => {
      harness.http.on('/admin/courses', { json: publishedCoursesPage([PYTHON]) })
      harness.http.on(`/courses/${PYTHON.id}/learning`, { status: 500, json: { detail: 'boom' } })
    })

    expect(
      await screen.findByRole('heading', { name: /couldn’t load the course figures/i }),
    ).toBeInTheDocument()
  })

  it('has no serious or critical violations', async () => {
    const { container } = await open(BY_COURSE, stubByCourse)
    await screen.findByRole('table')

    const results = await axe.run(container, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(
      results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
    ).toEqual([])
  })
})
