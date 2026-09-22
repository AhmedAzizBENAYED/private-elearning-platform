import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { learningContent, learningLessonIds, textLessonDetail } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { setViewport, viewports } from '../../test/viewport'

/**
 * G27 - the learning page's header below 1024px (FE-LEARN-MOBILE-HEADER-01).
 *
 * Learning-Mobile: "Back to course", the module over the course, the account
 * chip - in place of the member header. Learning-Tablet: the logo home, the
 * module over the course, the course progress, the account chip. From 1024px
 * the member header and the page's breadcrumb bar are as they were.
 */

const COURSE_ID = learningContent.course_id
const TEXT = learningLessonIds.text
const lessonPath = (lessonId = TEXT) => `/courses/${COURSE_ID}/lessons/${lessonId}`
const coursePath = `/courses/${COURSE_ID}`

function stubCourse(harness: AuthHarness) {
  harness.http.on(`/courses/${COURSE_ID}/content`, { json: learningContent })
  harness.http.on(`/lessons/${TEXT}`, { json: textLessonDetail })
}

async function openAt(width: number, beforeMount: (harness: AuthHarness) => void = stubCourse) {
  const result = await renderRoute({ path: lessonPath(), as: 'member', width, beforeMount })
  await screen.findByRole('heading', { name: 'Practice exercises', level: 1 })
  return result
}

/**
 * The page's banners. jsdom counts every `<header>` as one, including the
 * lesson's and the outline's inside `<main>`, which a browser does not; only
 * the shell's, outside `<main>`, is the page banner.
 */
const banners = () => screen.getAllByRole('banner').filter((header) => header.closest('main') === null)
const banner = () => {
  const [only, ...others] = banners()
  expect(others).toHaveLength(0)
  return only!
}

const PHONES = [viewports.mobile, 375, 599] as const
const TABLETS = [600, viewports.tablet] as const
const LAPTOPS = [viewports.laptop, viewports.desktop, viewports.wide] as const

describe('learning header - phone (Learning-Mobile)', () => {
  it.each(PHONES)('at %ipx shows the course header: back, module, course, account', async (width) => {
    await openAt(width)

    expect(banners()).toHaveLength(1)
    const back = within(banner()).getByRole('link', { name: 'Back to course' })
    expect(back).toHaveAttribute('href', coursePath)
    expect(within(banner()).getByText('Module 2 · Functions and structure')).toBeInTheDocument()
    expect(within(banner()).getByText('Python Fundamentals')).toBeInTheDocument()
    expect(within(banner()).getByRole('button', { name: /Iyed Belghith/ })).toBeInTheDocument()
  })

  it.each(PHONES)('at %ipx replaces the member header instead of stacking on it', async (width) => {
    await openAt(width)

    // No second header, no logo bar, no navigation, no bottom bar.
    expect(screen.queryByAltText('JEENISo — home')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    // The page's own breadcrumb bar is the laptop's; its content is up here now.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.getAllByText('Python Fundamentals')).toHaveLength(1)
    // Nothing the board does not draw: one link, one button.
    expect(within(banner()).getAllByRole('link')).toHaveLength(1)
    expect(within(banner()).getAllByRole('button')).toHaveLength(1)
    expect(within(banner()).queryByRole('progressbar')).toBeNull()
  })

  it('reads in the board s order: skip link, back, course, account, then the lesson', async () => {
    await openAt(viewports.mobile)

    const skip = screen.getByRole('link', { name: 'Skip to content' })
    const back = screen.getByRole('link', { name: 'Back to course' })
    const course = within(banner()).getByText('Python Fundamentals')
    const account = within(banner()).getByRole('button', { name: /Iyed Belghith/ })
    const main = screen.getByRole('main')
    const order = [skip, back, course, account, main]
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('is reached by Tab in that order, and "Back to course" works from the keyboard', async () => {
    const { router } = await openAt(viewports.mobile)

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Back to course' })).toHaveFocus()
    await userEvent.tab()
    expect(within(banner()).getByRole('button', { name: /Iyed Belghith/ })).toHaveFocus()

    screen.getByRole('link', { name: 'Back to course' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe(coursePath))
  })

  it('opens the account menu from the chip, as the member header does', async () => {
    await openAt(viewports.mobile)

    await userEvent.click(within(banner()).getByRole('button', { name: /Iyed Belghith/ }))

    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(within(menu).getByRole('menuitem', { name: 'My profile' })).toHaveFocus()
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('makes "Back to course" a 44px target', async () => {
    await openAt(viewports.mobile)

    const back = screen.getByRole('link', { name: 'Back to course' })
    expect(getComputedStyle(back).width).toBe('var(--tap-target)')
    expect(getComputedStyle(back).height).toBe('var(--tap-target)')
  })

  it('truncates a long module or course name instead of widening the page', async () => {
    await openAt(viewports.mobile)

    for (const text of ['Module 2 · Functions and structure', 'Python Fundamentals']) {
      const style = getComputedStyle(within(banner()).getByText(text))
      expect(style.whiteSpace).toBe('nowrap')
      expect(style.overflow).toBe('hidden')
      expect(style.textOverflow).toBe('ellipsis')
    }
    expect(getComputedStyle(within(banner()).getByText('Python Fundamentals').parentElement!).minWidth).toBe('0px')
  })

  it('keeps its way back while the course is still loading', async () => {
    await renderRoute({
      path: lessonPath(),
      as: 'member',
      width: viewports.mobile,
      beforeMount: (harness) =>
        harness.http.on(`/courses/${COURSE_ID}/content`, () => new Promise(() => undefined) as never),
    })

    expect(await screen.findByRole('link', { name: 'Back to course' })).toHaveAttribute('href', coursePath)
    expect(within(banner()).queryByText('Python Fundamentals')).toBeNull()
  })

  it('keeps its way back when the member is not enrolled', async () => {
    await renderRoute({
      path: lessonPath(),
      as: 'member',
      width: viewports.mobile,
      beforeMount: (harness) =>
        harness.http.on(`/courses/${COURSE_ID}/content`, {
          status: 404,
          json: { detail: 'Enrollment not found' },
        }),
    })

    await screen.findByRole('heading', { name: 'Enroll to open this lesson' })
    expect(within(banner()).getByRole('link', { name: 'Back to course' })).toHaveAttribute('href', coursePath)
  })
})

describe('learning header - tablet (Learning-Tablet)', () => {
  it.each(TABLETS)('at %ipx shows the compact bar: logo, module, course, progress, account', async (width) => {
    await openAt(width)

    expect(banners()).toHaveLength(1)
    expect(within(banner()).getByRole('link', { name: 'JEENISo — home' })).toHaveAttribute('href', '/dashboard')
    expect(within(banner()).getByText('Module 2 · Functions and structure')).toBeInTheDocument()
    expect(within(banner()).getByRole('link', { name: 'Python Fundamentals' })).toHaveAttribute('href', coursePath)
    const progress = within(banner()).getByRole('progressbar', { name: 'Course progress' })
    expect(progress).toHaveAttribute('aria-valuenow', '50')
    // The figure above the bar is for the eye; the bar already says it.
    expect(within(banner()).getByText('50%')).toHaveAttribute('aria-hidden', 'true')
    expect(within(banner()).getByRole('button', { name: /Iyed Belghith/ })).toBeInTheDocument()
  })

  it.each(TABLETS)('at %ipx is not the phone header, nor the member header', async (width) => {
    await openAt(width)

    expect(screen.queryByRole('link', { name: 'Back to course' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.getAllByAltText('JEENISo — home')).toHaveLength(1)
  })

  it('shows the account chip as the avatar alone, still named', async () => {
    await openAt(viewports.tablet)

    const chip = within(banner()).getByRole('button', { name: /Iyed Belghith/ })
    const identity = within(chip).getByText('Iyed Belghith').parentElement!
    // Hidden from sight, not from assistive technology.
    expect(getComputedStyle(identity).display).not.toBe('none')
    expect(getComputedStyle(identity).position).toBe('absolute')
    expect(getComputedStyle(identity).clipPath).toBe('inset(50%)')
  })

  it('leads to the course from its title, and home from the logo', async () => {
    const { router } = await openAt(viewports.tablet)

    await userEvent.click(within(banner()).getByRole('link', { name: 'Python Fundamentals' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(coursePath))
  })

  it('gives the course link a 44px hit area without moving its line', async () => {
    await openAt(viewports.tablet)

    const style = getComputedStyle(within(banner()).getByRole('link', { name: 'Python Fundamentals' }))
    // A 20px line plus 12px above and below; the margin gives the space back.
    expect(style.display).toBe('block')
    expect(style.paddingTop).toBe('var(--space-3)')
    expect(style.paddingBottom).toBe('var(--space-3)')
    expect(style.marginTop).toBe('calc(-1 * var(--space-3))')
    expect(style.marginBottom).toBe('calc(-1 * var(--space-3))')
  })
})

describe('learning header - laptop and desktop (unchanged)', () => {
  it.each(LAPTOPS)('at %ipx keeps the member header and the page s breadcrumb bar', async (width) => {
    await openAt(width)

    expect(banners()).toHaveLength(1)
    expect(within(banner()).getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Back to course' })).toBeNull()
    expect(within(banner()).queryByRole('progressbar')).toBeNull()
    expect(within(banner()).queryByText('Python Fundamentals')).toBeNull()
  })
})

describe('learning header - crossing the breakpoints', () => {
  it('switches header at 600 and 1024px, never showing two', async () => {
    await openAt(viewports.mobile)
    const steps: [number, string][] = [
      [599, 'phone'],
      [600, 'tablet'],
      [1023, 'tablet'],
      [1024, 'laptop'],
      [599, 'phone'],
    ]

    for (const [width, expected] of steps) {
      act(() => setViewport(width))
      expect(banners()).toHaveLength(1)
      const shown = screen.queryByRole('link', { name: 'Back to course' })
        ? 'phone'
        : within(banner()).queryByRole('progressbar', { name: 'Course progress' })
          ? 'tablet'
          : 'laptop'
      expect(`${width}: ${shown}`).toBe(`${width}: ${expected}`)
    }
  })

  it('hands the header back to the member shell when the member leaves the lesson', async () => {
    const { router } = await openAt(viewports.tablet)

    await userEvent.click(within(banner()).getByRole('link', { name: 'Python Fundamentals' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(coursePath))

    expect(within(banner()).getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(within(banner()).queryByRole('progressbar')).toBeNull()
  })

  it('leaves every other member page as it was on a phone', async () => {
    await renderRoute({ path: '/courses', as: 'member', width: viewports.mobile })
    await screen.findByRole('heading', { level: 1 })

    expect(within(banner()).getByAltText('JEENISo — home')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Back to course' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})
