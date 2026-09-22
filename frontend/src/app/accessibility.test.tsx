import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import {
  adminCourses,
  adminLessons,
  adminMembers,
  adminModules,
  adminVideoResource,
  documentResourceAdmin,
  lessonsByModule,
  catalogAvailable,
  catalogEnrolled,
  catalogLessonsByModule,
  catalogModules,
  catalogPage,
  catalogListPage,
  catalogEnrolledRow,
  catalogAvailableRow,
  catalogEmptyRow,
  courseContent,
  learningContent,
  learningLessonIds,
  linkLessonDetail,
  progressResponse,
  textLessonDetail,
  videoResource,
  enrollmentCompleted,
  enrollmentInProgress,
  page,
} from '../test/courseFixtures'
import { testUser } from '../test/authHarness'
import type { RecordedCall } from '../test/fetchMock'
import { renderRoute, type RenderRouteResult } from '../test/renderRoute'
import { viewports } from '../test/viewport'

/** A dashboard with every section populated, for the audits below. */
function fullDashboard(harness: RenderRouteResult['harness']) {
  harness.http.on('/me/enrollments', { json: page([enrollmentInProgress, enrollmentCompleted]) })
  harness.http.on('/courses', { json: page([catalogEnrolled, catalogAvailable]) })
  harness.http.on('/content', { json: courseContent })
}

/** The learning page's single course tree, plus its two lesson details. */
function learningCourse(harness: RenderRouteResult['harness']) {
  harness.http.on(`/courses/${learningContent.course_id}/content`, { json: learningContent })
  harness.http.on(`/lessons/${learningLessonIds.text}`, { json: textLessonDetail })
  harness.http.on(`/lessons/${learningLessonIds.link}`, { json: linkLessonDetail })
  // FE-08: the video lesson resolves and renders a real player.
  harness.http.on(`/lessons/${learningLessonIds.introduction}/resource`, { json: videoResource })
  harness.http.on(`/lessons/${learningLessonIds.introduction}/progress`, {
    json: progressResponse(),
  })
}

/** A course details page for a member who is not enrolled in it. */
function notEnrolledCourse(harness: RenderRouteResult['harness']) {
  harness.http.on(`/courses/${catalogEnrolled.id}`, { json: catalogEnrolled })
  harness.http.on(`/courses/${catalogEnrolled.id}/content`, {
    status: 404,
    json: { detail: 'Enrollment not found' },
  })
  harness.http.on(`/courses/${catalogEnrolled.id}/modules`, { json: page(catalogModules) })
  for (const module of catalogModules) {
    harness.http.on(`/modules/${module.id}/lessons`, {
      json: page(catalogLessonsByModule[module.id] ?? []),
    })
  }
}

/**
 * Accessibility gate for the shell.
 *
 * Contrast and target size are disabled: jsdom computes neither colour nor
 * geometry, so a verdict there would be noise. Both are held to the design,
 * which specifies the palette's ratios and a 44px minimum, and are checked in a
 * real browser instead.
 */
async function auditBlocking(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      'target-size': { enabled: false },
    },
  })

  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.help}`)
}

describe('accessibility', () => {
  /* ---- LANDING-01: the public landing page --------------------------- */

  it('the landing page, for a visitor, is clean', async () => {
    const { container } = await renderRoute({ path: '/' })
    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the landing page, signed in, is clean', async () => {
    const { container } = await renderRoute({ path: '/', as: 'member' })
    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the landing page on a phone, menu open, is clean', async () => {
    const { container } = await renderRoute({ path: '/', width: viewports.mobile })
    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- LANDING-02: the sections between the hero and the footer ------- */

  it('the landing sections, Lessons tab selected, are clean', async () => {
    const { container } = await renderRoute({ path: '/' })
    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })
    await userEvent.click(screen.getByRole('tab', { name: 'Lessons' }))

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the landing page on a tablet is clean', async () => {
    const { container } = await renderRoute({ path: '/', width: viewports.tablet })
    await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('login has no serious or critical violations', async () => {
    const { container } = await renderRoute({ path: '/login' })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('login on a phone has no serious or critical violations', async () => {
    const { container } = await renderRoute({ path: '/login', width: viewports.mobile })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-LOGIN-01: the stacked tablet layout, and the page's two message states.
  it('login on a tablet has no serious or critical violations', async () => {
    const { container } = await renderRoute({ path: '/login', width: viewports.tablet })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('login with the session-expired notice has no serious or critical violations', async () => {
    const { container } = await renderRoute({ path: '/login?expired=1' })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('login with validation and credential errors has no serious or critical violations', async () => {
    const { container, harness } = await renderRoute({ path: '/login', width: viewports.mobile })
    harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByText('Enter your email address')
    expect(await auditBlocking(container)).toEqual([])

    await userEvent.type(screen.getByLabelText(/Email address/), 'iyed@example.org')
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')
    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the member shell has no serious or critical violations', async () => {
    const { container } = await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the member shell with the user menu open is clean', async () => {
    const { container } = await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Iyed Belghith/ })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: /Iyed Belghith/ }))

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the mobile bottom navigation is clean', async () => {
    const { container } = await renderRoute({
      path: '/dashboard',
      as: 'member',
      width: viewports.mobile,
    })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the admin sidebar is clean', async () => {
    const { container } = await renderRoute({ path: '/admin', as: 'admin' })
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the admin icon rail is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin',
      as: 'admin',
      width: viewports.tablet,
    })
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the admin mobile drawer is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin',
      as: 'admin',
      width: viewports.mobile,
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    })
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the populated member dashboard is clean', async () => {
    const { container } = await renderRoute({
      path: '/dashboard',
      as: 'member',
      beforeMount: fullDashboard,
    })
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Courses in progress' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the dashboard on a phone is clean', async () => {
    const { container } = await renderRoute({
      path: '/dashboard',
      as: 'member',
      width: viewports.mobile,
      beforeMount: fullDashboard,
    })
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Courses in progress' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the empty dashboard is clean', async () => {
    const { container } = await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'You haven’t started a course yet' }),
      ).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the dashboard error state is clean', async () => {
    const { container } = await renderRoute({
      path: '/dashboard',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/me/enrollments', { status: 500, json: { detail: 'Internal server error' } })
      },
    })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'We couldn’t load your courses' }),
      ).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the catalogue is clean', async () => {
    const { container } = await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/courses', { json: catalogPage(20, { total: 45 }) })
        harness.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
      },
    })
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Courses' })).toBeInTheDocument()
    })
    // Includes the pager, which only appears when there is more than one page.
    expect(screen.getByRole('navigation', { name: 'Catalogue pages' })).toBeInTheDocument()

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the catalogue on a phone is clean', async () => {
    const { container } = await renderRoute({
      path: '/courses',
      as: 'member',
      width: viewports.mobile,
      beforeMount: (harness) => {
        harness.http.on('/courses', { json: page([catalogEnrolled, catalogAvailable]) })
        harness.http.on('/me/enrollments', { json: page([]) })
      },
    })
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Courses' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-COURSE-CATALOG-01 (G04, G05): the enrollment tabs with their counts,
  // and cards carrying the course size and the video progress.
  it.each([
    ['laptop', viewports.wide, '/courses'],
    ['phone', viewports.mobile, '/courses?enrollment=in_progress'],
  ])('the catalogue with its tabs and course figures (%s) is clean', async (_name, width, path) => {
    const { container } = await renderRoute({
      path,
      as: 'member',
      width,
      beforeMount: (harness) => {
        harness.http.on('/courses', {
          json: catalogListPage([catalogEnrolledRow, catalogAvailableRow, catalogEmptyRow], {
            all: 3, not_enrolled: 2, in_progress: 1, completed: 0,
          }),
        })
        harness.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
      },
    })
    await screen.findByText('5 of 11 videos completed')
    expect(screen.getByRole('group', { name: 'Filter by enrollment' })).toBeInTheDocument()

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('an empty enrollment tab is clean', async () => {
    const { container } = await renderRoute({
      path: '/courses?enrollment=completed',
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on('/courses', {
          json: catalogListPage([], { all: 3, not_enrolled: 2, in_progress: 1, completed: 0 }),
        })
        harness.http.on('/me/enrollments', { json: page([enrollmentInProgress]) })
      },
    })
    await screen.findByRole('heading', { name: 'No completed course yet' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the empty catalogue is clean', async () => {
    const { container } = await renderRoute({ path: '/courses', as: 'member' })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No courses yet' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('course details, not enrolled, is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      beforeMount: notEnrolledCourse,
    })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: catalogEnrolled.title, level: 1 }),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /enroll in this course/i })).toBeInTheDocument()

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('course details, enrolled, is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${catalogEnrolled.id}`, { json: catalogEnrolled })
        harness.http.on(`/courses/${catalogEnrolled.id}/content`, { json: courseContent })
      },
    })
    await waitFor(() => {
      expect(screen.getByText('5 of 11 videos completed')).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('course details on a phone is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      width: viewports.mobile,
      beforeMount: notEnrolledCourse,
    })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: catalogEnrolled.title, level: 1 }),
      ).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the unavailable-course state is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${catalogEnrolled.id}`, {
          status: 404,
          json: { detail: 'Course not found' },
        })
      },
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'This course isn’t available' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the learning page (video lesson) is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.introduction}`,
      as: 'member',
      beforeMount: learningCourse,
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Introduction', level: 1 })).toBeInTheDocument()
    })
    // The audit must cover the real player, not a loading placeholder.
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-PLAYER-01 (G17, G26): every state of the player the boards draw, with
  // its controls over the frame, on a laptop and on a phone.
  it.each([
    ['ready', viewports.wide],
    ['ready', viewports.mobile],
    ['buffering', viewports.wide],
    ['ended', viewports.wide],
    ['ended', viewports.mobile],
    ['error', viewports.wide],
    ['error', viewports.mobile],
  ] as const)('the video player, %s, at %ipx, is clean', async (state, width) => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.introduction}`,
      as: 'member',
      width,
      beforeMount: learningCourse,
    })
    const video = (await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      return element
    })) as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 384 })
    fireEvent.loadedMetadata(video)

    if (state === 'buffering') {
      Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
      fireEvent.play(video)
      fireEvent.waiting(video)
      await screen.findByText('Buffering…')
    } else if (state === 'ended') {
      // This fixture's video is already complete on the server.
      fireEvent.ended(video)
      await screen.findByRole('heading', { name: 'Lesson completed', level: 2 })
    } else if (state === 'error') {
      fireEvent.error(video)
      await screen.findByRole('heading', { name: 'This video can’t be played', level: 2 })
    } else {
      await screen.findByRole('button', { name: 'Play video' })
    }

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the video player while it loads is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.introduction}`,
      as: 'member',
      beforeMount: (harness) => {
        learningCourse(harness)
        harness.http.on(`/lessons/${learningLessonIds.introduction}/resource`, () => new Promise(() => ({})))
      },
    })
    await screen.findByText('Loading video…')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-LEARN-COMPLETE-SCREEN-01: the course-completed screen, laptop and phone.
  it.each([
    ['laptop', viewports.wide],
    ['phone', viewports.mobile],
  ])('the course-completed screen on a %s is clean', async (_name, width) => {
    const completed = {
      ...learningContent,
      total_video_lessons: 1,
      completed_video_lessons: 1,
      progress_percent: 100,
      completed: true,
    }
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.introduction}`,
      as: 'member',
      width,
      beforeMount: (harness) => {
        learningCourse(harness)
        harness.http.on(`/courses/${learningContent.course_id}/content`, { json: completed })
      },
    })
    await screen.findByRole('heading', { name: 'Course completed', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the learning page (text lesson) is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.text}`,
      as: 'member',
      beforeMount: learningCourse,
    })
    await waitFor(() => {
      expect(screen.getByText('Before you start')).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the learning page on a phone is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.link}`,
      as: 'member',
      width: viewports.mobile,
      beforeMount: learningCourse,
    })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open link/i })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-QA-FINAL-01: the new states of the member side.
  it('the learning page with its outline folded (tablet) is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.text}`,
      as: 'member',
      width: viewports.tablet,
      beforeMount: learningCourse,
    })
    await screen.findByRole('button', { name: 'Getting started' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the Error 500 card is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.text}`,
      as: 'member',
      beforeMount: (harness) => {
        learningCourse(harness)
        harness.http.on(`/courses/${learningContent.course_id}/content`, { status: 503, json: { detail: 'down' } })
      },
    })
    await screen.findByText('Error 500')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('course details, enrolled, on a phone with folded modules, is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      width: viewports.mobile,
      beforeMount: (harness) => {
        harness.http.on(`/courses/${catalogEnrolled.id}`, { json: catalogEnrolled })
        harness.http.on(`/courses/${catalogEnrolled.id}/content`, { json: courseContent })
        harness.http.on(`/courses/${catalogEnrolled.id}/modules`, { json: page(catalogModules) })
        harness.http.on('/me/enrollments', { json: page([]) })
      },
    })
    await screen.findByText('Next up')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the unavailable-lesson state is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/00000000-0000-4000-8000-000000000000`,
      as: 'member',
      beforeMount: learningCourse,
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'This lesson isn’t available' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-LEARN-MOBILE-HEADER-01 (G27): the learning page's own header below 1024px.
  it.each([
    ['the phone header (390px)', viewports.mobile],
    ['the phone header (599px)', 599],
    ['the tablet bar (600px)', 600],
    ['the tablet bar (768px)', viewports.tablet],
  ])('the learning page with %s is clean', async (_name, width) => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.text}`,
      as: 'member',
      width,
      beforeMount: learningCourse,
    })
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the phone learning header with its account menu open is clean', async () => {
    const { container } = await renderRoute({
      path: `/courses/${learningContent.course_id}/lessons/${learningLessonIds.text}`,
      as: 'member',
      width: viewports.mobile,
      beforeMount: learningCourse,
    })
    await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: /Iyed Belghith/ }))
    await screen.findByRole('menu', { name: 'Account' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('404 is clean', async () => {
    const { container } = await renderRoute({ path: '/nope' })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'We can’t find this page' })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('403 is clean', async () => {
    const { container } = await renderRoute({ path: '/admin', as: 'member' })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'You don’t have access to this page' }),
      ).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)
})

describe('keyboard navigation', () => {
  it('reaches every member navigation link with Tab', async () => {
    await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })

    // The skip link comes first, so the header and nav can be bypassed.
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    await userEvent.tab() // logo
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /Iyed Belghith/ })).toHaveFocus()
  })

  it('opens and closes the user menu from the keyboard, returning focus', async () => {
    await renderRoute({ path: '/dashboard', as: 'member' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Iyed Belghith/ })).toBeInTheDocument()
    })

    const trigger = screen.getByRole('button', { name: /Iyed Belghith/ })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('reaches the admin navigation with Tab', async () => {
    await renderRoute({ path: '/admin', as: 'admin' })
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
    })

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    await userEvent.tab() // sidebar logo
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Members' })).toHaveFocus()
  })

  it('submits the login form with Enter', async () => {
    const { harness, router } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', {
      json: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
    })
    harness.http.on('/auth/me', {
      json: {
        id: '1',
        email: 'iyed@example.org',
        first_name: 'Iyed',
        last_name: 'Belghith',
        is_active: true,
        role: 'MEMBER',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      },
    })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await userEvent.type(screen.getByLabelText(/Email address/), 'iyed@example.org')
    await userEvent.type(screen.getByLabelText(/Password/), 'correct-horse{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })
})

/**
 * The administration screens (FE-10 to FE-13).
 *
 * The audits above stop at FE-09: every screen built after it - members,
 * courses, the course structure, the lesson forms and the file panels - had
 * never been through this gate. These close that gap.
 */
describe('accessibility - administration', () => {
  const DRAFT = adminCourses[0]!
  const M1 = adminModules[0]!

  /** The course management screen, with a module, its lessons and one file. */
  function adminCourse(harness: RenderRouteResult['harness'], resources: unknown[] = []) {
    harness.http.on(`/admin/courses/${DRAFT.id}`, { json: DRAFT })
    harness.http.on(`/admin/courses/${DRAFT.id}/modules`, { json: page(adminModules) })
    harness.http.on(`/admin/courses/${DRAFT.id}/resources`, { json: resources })
    for (const module of adminModules) {
      harness.http.on(`/admin/modules/${module.id}/lessons`, {
        json: page(lessonsByModule[module.id] ?? []),
      })
    }
  }

  /** The board: four counts, and the recent-courses listing populated. */
  function adminBoard(harness: RenderRouteResult['harness'], courses = adminCourses) {
    harness.http.on('/admin/members', { json: page(adminMembers) })
    harness.http.on('/admin/courses', (call) =>
      new URL(call.url).searchParams.get('sort') === null
        ? { json: page([]) }
        : { json: page(courses.map((course) => ({ ...course, module_count: 3, lesson_count: 8 }))) },
    )
  }

  it('the board with its recent-courses table is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin',
      as: 'admin',
      beforeMount: adminBoard,
    })
    await screen.findByRole('heading', { name: 'Recently created courses', level: 2 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the board with no courses yet is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin',
      as: 'admin',
      beforeMount: (harness) => adminBoard(harness, []),
    })
    await screen.findByRole('heading', { name: 'No courses yet', level: 3 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the board at 390px is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin',
      as: 'admin',
      beforeMount: adminBoard,
      width: viewports.mobile,
    })
    await screen.findByRole('heading', { name: 'Recently created courses', level: 2 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- MEMBERS-01: Add member ------------------------------------------ */

  async function openAddMember(width?: number) {
    const result = await renderRoute({
      path: '/admin/members',
      as: 'admin',
      beforeMount: (harness) =>
        harness.http.on('/admin/members', (call) =>
          call.method === 'POST'
            ? { status: 409, json: { detail: 'Email already in use' } }
            : { json: page(adminMembers) },
        ),
      ...(width ? { width } : {}),
    })
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    await screen.findByRole('dialog', { name: 'Add a member' })
    return result
  }

  it('the Add member dialog is clean', async () => {
    const { container } = await openAddMember()

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the Add member dialog with errors is clean', async () => {
    const { container } = await openAddMember()
    // Local validation on every field, then a server refusal on top.
    await userEvent.click(screen.getByRole('button', { name: 'Create member' }))
    await screen.findByText('Enter the member’s first name')
    expect(await auditBlocking(container)).toEqual([])

    await userEvent.type(screen.getByLabelText(/First name/), 'Hedi')
    await userEvent.type(screen.getByLabelText(/Last name/), 'Bouzid')
    await userEvent.type(screen.getByLabelText(/Email address/), 'hedi@example.org')
    await userEvent.type(screen.getByLabelText(/^Password/), 'initial-password-12')
    await userEvent.click(screen.getByRole('button', { name: 'Create member' }))
    await screen.findByText('This email is already used')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the Add member dialog at 390px is clean', async () => {
    const { container } = await openAddMember(viewports.mobile)

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- FE-PROFILE-01: My profile / Edit profile ------------------------ */

  it('an administrator’s profile page is clean', async () => {
    const { container } = await renderRoute({ path: '/admin/profile', as: 'admin' })
    await screen.findByRole('heading', { name: 'My profile', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('a member’s profile page, on a phone, is clean', async () => {
    const { container } = await renderRoute({
      path: '/profile',
      as: 'member',
      width: viewports.mobile,
    })
    await screen.findByRole('heading', { name: 'My profile', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-MOBILE-01 (G29, G32): the phone's profile foot for an administrator,
  // and a dialog and a toast placed above the member bottom bar.
  it('an administrator’s profile page, on a phone, is clean', async () => {
    const { container } = await renderRoute({ path: '/admin/profile', as: 'admin', width: viewports.mobile })
    await screen.findByRole('button', { name: 'Sign out' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the password strength meter is clean', async () => {
    const { container } = await renderRoute({ path: '/profile/edit', as: 'member' })
    const field = await screen.findByLabelText(/^New password/)
    await userEvent.type(field, 'Blue-bird Evening 7')
    await screen.findByText('Strength: Strong')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the discard dialog, as a sheet above the bottom bar, is clean', async () => {
    const { container } = await renderRoute({ path: '/profile/edit', as: 'member', width: viewports.mobile })
    await userEvent.type(await screen.findByRole('textbox', { name: /First name/ }), ' Amine')
    await userEvent.click(screen.getByRole('link', { name: 'Account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    expect(dialog.parentElement).toHaveAttribute('data-bottom-bar')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the saved toast, above the bottom bar, is clean', async () => {
    const { container } = await renderRoute({
      path: '/profile/edit',
      as: 'member',
      width: viewports.mobile,
      beforeMount: (harness) =>
        harness.http.on('/auth/me', (call) =>
          call.method === 'PATCH'
            ? { json: { ...testUser, first_name: 'Iyed Amine' } }
            : { json: testUser },
        ),
    })
    await userEvent.type(await screen.findByRole('textbox', { name: /First name/ }), ' Amine')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const toast = (await screen.findByText('Profile updated')).closest('[role="status"]')!
    expect(toast).toHaveAttribute('data-bottom-bar')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the edit profile page, with errors in both forms, is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin/profile/edit',
      as: 'admin',
      beforeMount: (harness) =>
        harness.http.on('/auth/change-password', {
          status: 400,
          json: { detail: 'Current password is incorrect' },
        }),
    })
    await screen.findByRole('heading', { name: 'Edit profile', level: 1 })
    await userEvent.clear(screen.getByRole('textbox', { name: /First name/ }))
    await userEvent.clear(screen.getByRole('textbox', { name: /Last name/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await userEvent.type(screen.getByLabelText(/Current password/), 'not-my-password')
    await userEvent.type(screen.getByLabelText(/^New password/), 'a-brand-new-password')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'a-brand-new-password')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await screen.findByText('Your current password is incorrect')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the discard-changes dialog is clean', async () => {
    const { container } = await renderRoute({ path: '/admin/profile/edit', as: 'admin' })
    await screen.findByRole('heading', { name: 'Edit profile', level: 1 })
    await userEvent.type(screen.getByRole('textbox', { name: /First name/ }), ' Nour')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByRole('dialog', { name: 'Discard your changes?' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- MEMBERS-02: activate / deactivate ------------------------------- */

  it('the deactivation dialog, refused, is clean', async () => {
    const member = adminMembers[0]!
    const { container } = await renderRoute({
      path: `/admin/members/${member.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        harness.http.on(`/admin/members/${member.id}`, { json: member })
        harness.http.on(`/admin/members/${member.id}/status`, { status: 500, json: { detail: 'boom' } })
      },
    })
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await screen.findByText(/could not be saved/i)

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- FE-ADMIN-MEMBER-EDIT-01: edit a member ------------------------- */

  it('the edit member page, and its validation errors, are clean', async () => {
    const member = adminMembers[0]!
    const { container } = await renderRoute({
      path: `/admin/members/${member.id}/edit`,
      as: 'admin',
      width: viewports.mobile,
      beforeMount: (harness) => harness.http.on(`/admin/members/${member.id}`, { json: member }),
    })
    await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })
    expect(await auditBlocking(container)).toEqual([])

    await userEvent.clear(screen.getByLabelText(/^First name/))
    await userEvent.clear(screen.getByLabelText(/^Last name/))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('alert')
    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- FE-ADMIN-DASHBOARD-01: header actions ----------------------------- */

  it('the admin dashboard with its header actions is clean on a phone', async () => {
    const { container } = await renderRoute({ path: '/admin', as: 'admin', width: viewports.mobile })
    await screen.findByRole('link', { name: 'Create course' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  /* ---- FE-ADMIN-MEMBERS-MENU-01: row menu and member view --------------- */

  it('the member list with a row menu open is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin/members',
      as: 'admin',
      beforeMount: (harness) => harness.http.on('/admin/members', { json: page(adminMembers) }),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Sarra Mansour' }))
    await screen.findByRole('menu', { name: 'Actions for Sarra Mansour' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it.each([
    ['laptop', viewports.wide],
    ['phone', viewports.mobile],
  ])('the member view on a %s is clean', async (_name, width) => {
    const member = adminMembers[0]!
    const { container } = await renderRoute({
      path: `/admin/members/${member.id}`,
      as: 'admin',
      width,
      beforeMount: (harness) => harness.http.on(`/admin/members/${member.id}`, { json: member }),
    })
    await screen.findByRole('region', { name: 'Account & security' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the member list with its row actions is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin/members',
      as: 'admin',
      beforeMount: (harness) => harness.http.on('/admin/members', { json: page(adminMembers) }),
    })
    await screen.findByRole('link', { name: 'Edit profile for Sarra Mansour' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the member list is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin/members',
      as: 'admin',
      beforeMount: (harness) => harness.http.on('/admin/members', { json: page(adminMembers) }),
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Members', level: 1 })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the empty member list is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin/members',
      as: 'admin',
      beforeMount: (harness) => harness.http.on('/admin/members', { json: page([]) }),
    })
    await screen.findByRole('heading', { name: /no members/i })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the course list is clean', async () => {
    const { container } = await renderRoute({
      path: '/admin/courses',
      as: 'admin',
      beforeMount: (harness) => harness.http.on('/admin/courses', { json: page(adminCourses) }),
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Courses', level: 1 })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-ADMIN-COURSES-LIST-01: the table with a row menu open, the narrow
  // tablet table and the phone cards.
  it.each([
    ['laptop, menu open', viewports.wide],
    ['tablet', viewports.tablet],
    ['phone', viewports.mobile],
  ])('the course list (%s) is clean', async (name, width) => {
    const sized = adminCourses.map((course) => ({ ...course, module_count: 2, lesson_count: 5 }))
    const { container } = await renderRoute({
      path: '/admin/courses',
      as: 'admin',
      width,
      beforeMount: (harness) => harness.http.on('/admin/courses', { json: page(sized) }),
    })
    const first = adminCourses[0]!
    await screen.findByRole('link', { name: `Edit ${first.title}` })
    if (name.includes('menu')) {
      await userEvent.click(screen.getByRole('button', { name: `More actions for ${first.title}` }))
      await screen.findByRole('menu')
    }

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the course structure, with modules and lessons, is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the course structure carrying stored files is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness, [adminVideoResource, documentResourceAdmin]),
    })
    // The row's line for a stored file: its duration and name.
    await screen.findByText('02:00 · welcome.mp4')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the course structure on a phone is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      width: viewports.mobile,
      beforeMount: (harness) => adminCourse(harness, [adminVideoResource]),
    })
    await screen.findByText('02:00 · welcome.mp4')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-ADMIN-COURSE-EDITOR-01: the Status and Course information cards, with
  // a thumbnail and field errors on a draft, and read-only on a published course.
  it('the course editor with field errors is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        adminCourse(harness)
        harness.http.on(`/admin/courses/${DRAFT.id}`, {
          json: { ...DRAFT, thumbnail_url: 'https://cdn.example.org/thumb.jpg' },
        })
      },
    })
    const info = await screen.findByRole('region', { name: 'Course information' })
    await userEvent.clear(within(info).getByLabelText(/^Title/))
    await userEvent.click(within(info).getByRole('button', { name: 'Save information' }))
    await within(info).findByText('Enter a course title')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it.each([
    ['laptop', viewports.wide],
    ['phone', viewports.mobile],
  ])('a published course in the editor (%s) is clean', async (_name, width) => {
    const published = adminCourses[1]!
    const { container } = await renderRoute({
      path: `/admin/courses/${published.id}`,
      as: 'admin',
      width,
      beforeMount: (harness) => {
        harness.http.on(`/admin/courses/${published.id}`, { json: published })
        harness.http.on(`/admin/courses/${published.id}/modules`, { json: page([]) })
        harness.http.on(`/admin/courses/${published.id}/resources`, { json: [] })
      },
    })
    await screen.findByRole('region', { name: 'Course information' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the course form is clean', async () => {
    const { container } = await renderRoute({ path: '/admin/courses/new', as: 'admin' })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create course', level: 1 })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the course form showing validation errors is clean', async () => {
    const { container } = await renderRoute({ path: '/admin/courses/new', as: 'admin' })
    await screen.findByRole('heading', { name: 'Create course', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))
    await waitFor(() => {
      expect(screen.getByLabelText(/^Title/)).toHaveAttribute('aria-invalid', 'true')
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the lesson form is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Add lesson', level: 1 })).toBeInTheDocument()
    })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('an open confirmation dialog is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await screen.findByRole('heading', { name: M1.title, level: 3 })
    await userEvent.click(
      screen.getByRole('button', { name: `Delete module ${M1.title}` }),
    )
    await screen.findByRole('dialog')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-LESSON-EDITOR-01: the lesson editor in its states, the module dialogs,
  // a collapsed module, and the guard against leaving with changes.
  const lessonEditor = (lessonId: string) => `/admin/courses/${DRAFT.id}/lessons/${lessonId}/edit`

  it.each([
    ['a VIDEO lesson holding a file (laptop)', adminLessons[0]!.id, viewports.wide],
    ['a VIDEO lesson holding a file (phone)', adminLessons[0]!.id, viewports.mobile],
    ['a DOCUMENT lesson with no file (tablet)', adminLessons[1]!.id, viewports.tablet],
    ['a TEXT lesson (laptop)', adminLessons[2]!.id, viewports.wide],
  ])('the lesson editor for %s is clean', async (_name, lessonId, width) => {
    const { container } = await renderRoute({
      path: lessonEditor(lessonId),
      as: 'admin',
      width,
      beforeMount: (harness) => adminCourse(harness, [adminVideoResource]),
    })
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-UPLOAD-PROGRESS-01 (G33): a transfer under way, with its measured
  // percentage and its quarter-step status region.
  it.each([
    ['laptop', viewports.wide],
    ['phone', viewports.mobile],
  ])('the lesson editor with an upload at 64%% (%s) is clean', async (_name, width) => {
    let call: RecordedCall | undefined
    const { container } = await renderRoute({
      path: lessonEditor(adminLessons[0]!.id),
      as: 'admin',
      width,
      beforeMount: (harness) => {
        adminCourse(harness)
        harness.http.on(`/admin/lessons/${adminLessons[0]!.id}/resource`, (recorded) => {
          call = recorded
          return new Promise<never>(() => undefined)
        })
      },
    })
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })
    const input = document.getElementById('lesson-file')!.querySelector('input[type="file"]')!
    await userEvent.upload(
      input as HTMLInputElement,
      new File([new Uint8Array(100)], 'intro.mp4', { type: 'video/mp4' }),
    )
    await waitFor(() => expect(call).toBeDefined())
    await act(async () => call!.reportUploadProgress!(64, 100))
    await screen.findByText('64%')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the lesson editor showing field errors and a server refusal is clean', async () => {
    const { container } = await renderRoute({
      path: lessonEditor(adminLessons[0]!.id),
      as: 'admin',
      beforeMount: (harness) => {
        adminCourse(harness)
        harness.http.on(`/admin/lessons/${adminLessons[0]!.id}`, {
          status: 409,
          json: { detail: 'Lesson position already in use in this module' },
        })
      },
    })
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })
    await userEvent.clear(screen.getByLabelText(/^Duration/))
    await userEvent.type(screen.getByLabelText(/^Duration/), '8:3')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))
    await screen.findByText('Use the mm:ss format, for example 08:30')
    // Then a valid entry the server refuses.
    await userEvent.clear(screen.getByLabelText(/^Duration/))
    await userEvent.type(screen.getByLabelText(/^Duration/), '08:30')
    await userEvent.click(screen.getByRole('button', { name: 'Save lesson' }))
    await screen.findByText('That position is already taken in this module')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the lesson editor for a new LINK lesson is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}/modules/${M1.id}/lessons/new`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await screen.findByRole('heading', { name: 'Add lesson', level: 1 })
    await userEvent.click(screen.getByRole('radio', { name: 'Link' }))

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the discard-changes dialog is clean', async () => {
    const { container } = await renderRoute({
      path: lessonEditor(adminLessons[2]!.id),
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await screen.findByRole('heading', { name: 'Edit lesson', level: 1 })
    await userEvent.type(screen.getByLabelText(/^Title/), '!')
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await screen.findByRole('dialog', { name: 'Discard your changes?' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it.each([
    ['laptop', viewports.wide],
    ['phone', viewports.mobile],
  ])('the add-module dialog showing an error (%s) is clean', async (_name, width) => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      width,
      beforeMount: (harness) => adminCourse(harness),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Add module' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a module' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))
    await within(dialog).findByText('Enter a module title')

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the edit-module dialog is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await userEvent.click(await screen.findByRole('button', { name: `Edit module ${M1.title}` }))
    await screen.findByRole('dialog', { name: 'Edit module' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-LESSON-REORDER-01: a move being written (one PUT, rows already moved),
  // and a move the server refused (the order shown before, and the toast).
  it.each([
    ['being written', 'pending'],
    ['refused', 'refused'],
  ])('the structure with a move %s is clean', async (_name, outcome) => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        adminCourse(harness)
        harness.http.on(
          `/admin/courses/${DRAFT.id}/structure`,
          outcome === 'pending'
            ? () => new Promise<never>(() => undefined)
            : { status: 409, json: { detail: 'Only DRAFT courses can be edited' } },
        )
      },
    })
    const header = (await screen.findByRole('heading', { name: M1.title, level: 3 })).closest('header')!
    await userEvent.click(within(header).getByRole('button', { name: 'Move module down' }))
    if (outcome === 'refused') await screen.findByText(/no longer a draft/)
    else await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull())

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  // FE-THUMBNAIL-UPLOAD-01: Replace image while the file is being sent (busy
  // button, Remove and Save disabled), and after the server refused it (the
  // inline alert that describes the button).
  it.each([
    ['being sent', 'pending'],
    ['refused', 'refused'],
  ])('the course information with a thumbnail upload %s is clean', async (_name, outcome) => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        adminCourse(harness)
        harness.http.on(
          `/admin/courses/${DRAFT.id}/thumbnail`,
          outcome === 'pending'
            ? () => new Promise<never>(() => undefined)
            : { status: 422, json: { detail: 'File content is not a valid image/png image' } },
        )
      },
    })
    const card = await screen.findByRole('region', { name: 'Course information' })
    await userEvent.upload(
      card.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([new Uint8Array(16)], 'cover.png', { type: 'image/png' }),
    )
    if (outcome === 'refused') await within(card).findByRole('alert')
    else await within(card).findByRole('button', { name: 'Uploading…' })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('the structure with a collapsed module is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => adminCourse(harness),
    })
    await userEvent.click(
      await screen.findByRole('button', { name: `Collapse module ${M1.title}` }),
    )
    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)

  it('an empty course structure is clean', async () => {
    const { container } = await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        adminCourse(harness)
        harness.http.on(`/admin/courses/${DRAFT.id}/modules`, { json: page([]) })
      },
    })
    await screen.findByRole('heading', { name: 'This course has no modules yet', level: 3 })

    expect(await auditBlocking(container)).toEqual([])
  }, 30_000)
})
