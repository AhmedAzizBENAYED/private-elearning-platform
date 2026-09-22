import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * LANDING-01 - the public landing page's foundation: header, hero, footer.
 */

const TITLE = 'Learn together, at your own pace.'

async function openLanding(as: 'member' | 'admin' | null = null, width: number = viewports.wide) {
  const result = await renderRoute({ path: '/', as, width })
  await screen.findByRole('heading', { name: TITLE, level: 1 })
  return result
}

const banner = () => screen.getByRole('banner')
const footer = () => screen.getByRole('contentinfo')

describe('landing - public access', () => {
  it('opens at / without a session, and stays there', async () => {
    const { router, harness } = await openLanding()

    expect(router.state.location.pathname).toBe('/')
    expect(harness.authStore.getState().status).toBe('unauthenticated')
    // Nothing is read from the API for a visitor.
    expect(harness.http.callsTo('/auth/me')).toHaveLength(0)
  })

  it('has the page landmarks, one h1, and a skip link first', async () => {
    await openLanding()

    expect(banner()).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(footer()).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(document.getElementById('main')).toBe(screen.getByRole('main'))
  })

  it('an already signed-in account can still open it', async () => {
    const { router } = await openLanding('member')

    expect(router.state.location.pathname).toBe('/')
  })
})

describe('landing - header', () => {
  it('shows the logo, the navigation and Sign in', async () => {
    await openLanding()

    const header = banner()
    expect(within(header).getByRole('link', { name: 'JEENISo — home' })).toHaveAttribute('href', '/')
    const nav = within(header).getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '#contact')
    expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('points every in-page link at something that exists', async () => {
    await openLanding()

    const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
    expect(anchors.length).toBeGreaterThan(0)
    for (const anchor of anchors) {
      const id = anchor.getAttribute('href')!.slice(1)
      expect(document.getElementById(id), `#${id}`).not.toBeNull()
    }
    // LANDING-02: the four section anchors LANDING-01 withheld now exist and
    // are linked, in the boards' order.
    const nav = within(banner()).getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Platform', '#platform'],
      ['Preview', '#preview'],
      ['Benefits', '#benefits'],
      ['How it works', '#how'],
      ['Contact', '#contact'],
    ])
  })

  it('is reachable with the keyboard in reading order', async () => {
    await openLanding()

    await userEvent.tab() // skip link
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'JEENISo — home' })).toHaveFocus()
    for (const label of ['Platform', 'Preview', 'Benefits', 'How it works', 'Contact', 'Sign in']) {
      await userEvent.tab()
      expect(within(banner()).getByRole('link', { name: label })).toHaveFocus()
    }
  })

  it('signed in, the action becomes "Go to my dashboard" and the avatar opens My profile', async () => {
    await openLanding('member')

    const header = banner()
    expect(within(header).queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(within(header).getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(within(header).getByRole('link', { name: 'My profile — Iyed Belghith' })).toHaveAttribute(
      'href',
      '/profile',
    )
  })

  it('sends an administrator to the admin dashboard and the admin profile', async () => {
    await openLanding('admin')

    const header = banner()
    expect(within(header).getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/admin')
    expect(within(header).getByRole('link', { name: 'My profile — Amal Dridi' })).toHaveAttribute(
      'href',
      '/admin/profile',
    )
  })
})

describe('landing - hero', () => {
  it('carries the board’s words', async () => {
    await openLanding()

    const hero = screen.getByRole('region', { name: TITLE })
    expect(hero).toHaveTextContent('JEENISo · Learning platform')
    expect(hero).toHaveTextContent(
      'Video lessons, documents and resources chosen by the association, in one private place. Pick up where you left off and see your progress grow, course after course.',
    )
    expect(hero).toHaveTextContent('Private platform. Accounts are created by an administrator.')
  })

  it('Sign in leads to the sign-in page', async () => {
    const { router } = await openLanding()

    const hero = screen.getByRole('region', { name: TITLE })
    await userEvent.click(within(hero).getByRole('link', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
  })

  it('signed in, its action leads to the dashboard', async () => {
    const { router } = await openLanding('member')

    const hero = screen.getByRole('region', { name: TITLE })
    expect(within(hero).queryByRole('link', { name: 'Sign in' })).toBeNull()
    await userEvent.click(within(hero).getByRole('link', { name: 'Go to my dashboard' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('keeps the illustration out of the accessibility tree', async () => {
    await openLanding()

    // The preview card's sample figures are decoration, not content.
    expect(screen.queryByRole('progressbar')).toBeNull()
    // Drawn once per layout (under the text on a tablet, beside it on a wide
    // screen); every copy sits in a hidden subtree.
    for (const sample of screen.getAllByText('Python Fundamentals')) {
      expect(sample.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    for (const image of screen.getByRole('region', { name: TITLE }).querySelectorAll('img')) {
      expect(image).toHaveAttribute('alt', '')
    }
  })
})

describe('landing - footer', () => {
  it('is the Contact target, with real links only', async () => {
    await openLanding()

    const foot = footer()
    expect(foot).toHaveAttribute('id', 'contact')
    expect(within(foot).getByRole('img', { name: 'JEENISo' })).toBeInTheDocument()
    expect(foot).toHaveTextContent(
      'Junior Entreprise ENISo — private training platform for the members of the association.',
    )

    // LANDING-02: the column repeats the anchors the board lists there.
    const platform = within(foot).getByRole('navigation', { name: 'Platform' })
    expect(within(platform).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Preview', '#preview'],
      ['Benefits', '#benefits'],
      ['How it works', '#how'],
      ['Sign in', '/login'],
    ])
    expect(within(foot).getByRole('link', { name: 'contact@jeeniso.com' })).toHaveAttribute(
      'href',
      'mailto:contact@jeeniso.com',
    )
    expect(within(foot).getByRole('link', { name: 'Back to top' })).toHaveAttribute('href', '#top')
    expect(foot).toHaveTextContent(`© ${new Date().getFullYear()} JEENISo — Junior Entreprise ENISo`)
  })

  it('signed in, the Platform column leads to the dashboard', async () => {
    await openLanding('member')

    const platform = within(footer()).getByRole('navigation', { name: 'Platform' })
    expect(within(platform).getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })
})

describe('landing - protected routes stay protected', () => {
  it.each(['/dashboard', '/courses', '/profile', '/admin', '/admin/members'])(
    'a visitor on %s is sent to sign in',
    async (path) => {
      const { router } = await renderRoute({ path })

      await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    },
  )

  it('a member still cannot open the administration', async () => {
    await renderRoute({ path: '/admin', as: 'member' })

    expect(await screen.findByText(/403/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Admin' })).toBeNull()
  })
})

describe('landing - responsive', () => {
  it('on a tablet, a menu button replaces the navigation', async () => {
    await openLanding(null, viewports.tablet)

    expect(within(banner()).queryByRole('navigation')).toBeNull()
    expect(within(banner()).getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(within(banner()).getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('on a phone, the menu opens under the bar and closes with Escape', async () => {
    await openLanding(null, viewports.mobile)

    const toggle = screen.getByRole('button', { name: 'Open menu' })
    await userEvent.click(toggle)

    const close = screen.getByRole('button', { name: 'Close menu' })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: /Contact/ })).toHaveAttribute('href', '#contact')
    // Bar, menu, hero, administrator band, closing band, footer.
    expect(screen.getAllByRole('link', { name: 'Sign in' })).toHaveLength(6)
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
    expect(screen.getAllByRole('link', { name: 'contact@jeeniso.com' }).length).toBeGreaterThan(1)

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
  })

  it('following a menu link closes the menu', async () => {
    await openLanding(null, viewports.mobile)
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: /Contact/ }))

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('on a phone, signed in, the bar says "Dashboard"', async () => {
    await openLanding('member', viewports.mobile)

    expect(within(banner()).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
    // The avatar is a desktop element on the boards.
    expect(within(banner()).queryByRole('link', { name: /My profile/ })).toBeNull()
  })
})
