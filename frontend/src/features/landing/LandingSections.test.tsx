import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * LANDING-02 - the landing sections between the hero and the footer.
 */

const TITLE = 'Learn together, at your own pace.'

/** The sections, in the boards' order, by their headings. */
const ORDER = [
  TITLE,
  'One private place to learn together',
  'Go straight to what you need',
  'A quick look inside',
  'Everything you need to learn, nothing you don’t',
  'Four steps to 100%',
  'Ready to start learning?',
]

async function openLanding(as: 'member' | 'admin' | null = null, width: number = viewports.wide) {
  const result = await renderRoute({ path: '/', as, width })
  await screen.findByRole('heading', { name: TITLE, level: 1 })
  return result
}

const section = (name: string) => screen.getByRole('region', { name })

describe('landing sections - structure', () => {
  it('renders every section, in the boards’ order, inside main', async () => {
    await openLanding()

    const main = screen.getByRole('main')
    const regions = within(main).getAllByRole('region')
    expect(regions.map((region) => region.getAttribute('aria-labelledby')).map((id) => document.getElementById(id!)?.textContent)).toEqual(ORDER)
  })

  it('keeps the order and every section at tablet and phone widths', async () => {
    for (const width of [viewports.tablet, viewports.mobile]) {
      const { unmount } = await openLanding(null, width)
      const regions = within(screen.getByRole('main')).getAllByRole('region')
      expect(regions).toHaveLength(ORDER.length)
      unmount()
    }
  })

  it('gives each anchored section its id, labelled by its own heading', async () => {
    await openLanding()

    for (const [id, heading] of [
      ['platform', 'One private place to learn together'],
      ['preview', 'A quick look inside'],
      ['benefits', 'Everything you need to learn, nothing you don’t'],
      ['how', 'Four steps to 100%'],
    ] as const) {
      const element = document.getElementById(id)
      expect(element?.tagName).toBe('SECTION')
      expect(element).toBe(section(heading))
    }
  })

  it('has one h1, section h2s, and h3s only beneath them', async () => {
    await openLanding()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const main = screen.getByRole('main')
    const levels = [...main.querySelectorAll('h1, h2, h3, h4')].map((heading) => Number(heading.tagName[1]))
    for (let index = 1; index < levels.length; index += 1) {
      // Never skips a level going down.
      expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1)
    }
  })

  it('points every in-page link on the page at an element that exists', async () => {
    await openLanding()

    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      const id = anchor.getAttribute('href')!.slice(1)
      expect(document.getElementById(id), `#${id}`).not.toBeNull()
    }
  })
})

describe('landing sections - content and destinations, visitor', () => {
  it('the hero’s "See how it works" scrolls to How it works', async () => {
    await openLanding()

    expect(within(section(TITLE)).getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '#how')
  })

  it('the platform: its words, three ticks and "Sign in to start"', async () => {
    await openLanding()

    const platform = section('One private place to learn together')
    expect(platform).toHaveTextContent('The platform')
    expect(platform).toHaveTextContent('Administrators create the courses and the member accounts.')
    expect(within(platform).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Courses published by the association',
      'Lessons in a clear order, module by module',
      'Your progress always in sight',
    ])
    expect(within(platform).getByRole('link', { name: 'Sign in to start' })).toHaveAttribute('href', '/login')
    expect(platform).toHaveTextContent('Your courses, your pace')
    // The photo is decorative: an empty alt, so no image role at all.
    const photos = platform.querySelectorAll('img')
    expect(photos).toHaveLength(1)
    expect(photos[0]).toHaveAttribute('alt', '')
    expect(within(platform).queryByRole('img')).toBeNull()
  })

  it('quick access: four cards that lead to sign in, and the administrator band', async () => {
    await openLanding()

    const quick = section('Go straight to what you need')
    const cards = within(quick).getAllByRole('link', { name: /Sign in to open/ })
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Course catalogue',
      'Continue learning',
      'My progress',
      'My profile',
    ])
    for (const card of cards) expect(card).toHaveAttribute('href', '/login')

    expect(within(quick).getByRole('heading', { name: 'You are an administrator?', level: 3 })).toBeInTheDocument()
    expect(within(quick).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('benefits: the six statements, as a list', async () => {
    await openLanding()

    const benefits = section('Everything you need to learn, nothing you don’t')
    expect(within(benefits).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Video lessons',
      'Documents and resources',
      'A clear course outline',
      'Visible progress',
      'Private by design',
      'On every screen',
    ])
    expect(within(benefits).getAllByRole('listitem')).toHaveLength(6)
    expect(within(benefits).queryByRole('link')).toBeNull()
  })

  it('how it works: four steps, as an ordered list', async () => {
    await openLanding()

    const how = section('Four steps to 100%')
    const list = within(how).getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Sign in',
      'Choose a course',
      'Learn lesson by lesson',
      'Reach 100%',
    ])
  })

  it('the closing band: Sign in, and who to ask for an account', async () => {
    await openLanding()

    const closing = section('Ready to start learning?')
    expect(closing).toHaveTextContent('Sign in with your account to open your courses.')
    expect(within(closing).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(within(closing).getByRole('link', { name: 'contact@jeeniso.com' })).toHaveAttribute(
      'href',
      'mailto:contact@jeeniso.com',
    )
  })

  it('a quick-access card takes a visitor to the sign-in page', async () => {
    const { router } = await openLanding()

    await userEvent.click(within(section('Go straight to what you need')).getByRole('link', { name: /Course catalogue/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})

describe('landing sections - destinations, signed in', () => {
  it('a member: the cards deep-link to their page and name it', async () => {
    await openLanding('member')

    const quick = section('Go straight to what you need')
    const cards = within(quick).getAllByRole('link').slice(0, 4)
    expect(cards.map((card) => [within(card).getByRole('heading').textContent, card.getAttribute('href')])).toEqual([
      ['Course catalogue', '/courses'],
      ['Continue learning', '/dashboard'],
      ['My progress', '/dashboard'],
      ['My profile', '/profile'],
    ])
    expect(within(quick).queryByText('Sign in to open')).toBeNull()
    expect(cards[0]).toHaveTextContent('Courses')
    expect(cards[3]).toHaveTextContent('My profile')
  })

  it('a member: the platform, administrator and closing actions lead to the dashboard', async () => {
    await openLanding('member')

    for (const name of ['One private place to learn together', 'Go straight to what you need', 'Ready to start learning?']) {
      const link = within(section(name)).getByRole('link', { name: 'Go to my dashboard' })
      expect(link).toHaveAttribute('href', '/dashboard')
    }
    expect(screen.queryByText(/No account yet/)).toBeNull()
  })

  it('an administrator: the profile card and the actions use the admin pages', async () => {
    await openLanding('admin')

    const quick = section('Go straight to what you need')
    expect(within(quick).getByRole('link', { name: /My profile/ })).toHaveAttribute('href', '/admin/profile')
    expect(within(quick).getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/admin')
  })
})

describe('landing sections - preview tabs', () => {
  it('opens on Courses, with the other panels hidden', async () => {
    await openLanding()

    const preview = section('A quick look inside')
    const tabs = within(within(preview).getByRole('tablist', { name: 'Preview of the platform' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Courses', 'Lessons', 'Progress'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    const panel = within(preview).getByRole('tabpanel')
    expect(panel).toHaveAccessibleName('Courses')
    expect(within(panel).getByRole('heading', { name: 'Find your course', level: 3 })).toBeInTheDocument()
    expect(within(preview).getAllByRole('tabpanel', { hidden: true })).toHaveLength(3)
  })

  it('shows the panel of the tab clicked', async () => {
    await openLanding()
    const preview = section('A quick look inside')

    await userEvent.click(within(preview).getByRole('tab', { name: 'Lessons' }))

    expect(within(preview).getByRole('tab', { name: 'Lessons' })).toHaveAttribute('aria-selected', 'true')
    expect(within(preview).getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'false')
    const panel = within(preview).getByRole('tabpanel')
    expect(panel).toHaveAccessibleName('Lessons')
    expect(panel).toHaveTextContent('Learn at your own pace')
    expect(panel).toHaveTextContent('Four lesson types in one player page')

    await userEvent.click(within(preview).getByRole('tab', { name: 'Progress' }))
    expect(within(preview).getByRole('tabpanel')).toHaveTextContent('See your progress grow')
  })

  it('is one Tab stop, moved through with the arrows, Home and End', async () => {
    await openLanding()
    const preview = section('A quick look inside')
    const [courses, lessons, progress] = within(preview).getAllByRole('tab')

    expect(courses).toHaveAttribute('tabindex', '0')
    expect(lessons).toHaveAttribute('tabindex', '-1')
    courses!.focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(lessons).toHaveFocus()
    expect(lessons).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(courses).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(progress).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(courses).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(progress).toHaveFocus()
    expect(within(preview).getByRole('tabpanel')).toHaveAccessibleName('Progress')
  })

  it('keeps the illustrations out of the accessibility tree, with the board’s note', async () => {
    await openLanding()
    const preview = section('A quick look inside')

    // The sample course names and progress bars are decoration.
    expect(within(preview).queryByRole('progressbar')).toBeNull()
    for (const sample of within(preview).getAllByText('Python Fundamentals')) {
      expect(sample.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(within(preview).queryAllByRole('link')).toHaveLength(0)
    expect(preview).toHaveTextContent('Illustration. The real screens are available after signing in.')
  })
})

describe('landing sections - navigation', () => {
  it('the header links reach the four sections', async () => {
    await openLanding()

    const nav = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Main' })
    for (const [label, id] of [
      ['Platform', 'platform'],
      ['Preview', 'preview'],
      ['Benefits', 'benefits'],
      ['How it works', 'how'],
    ] as const) {
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href', `#${id}`)
      expect(document.getElementById(id)).not.toBeNull()
    }
  })

  it('the phone menu lists the five anchors', async () => {
    await openLanding(null, viewports.mobile)

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#platform',
      '#preview',
      '#benefits',
      '#how',
      '#contact',
    ])
  })
})
