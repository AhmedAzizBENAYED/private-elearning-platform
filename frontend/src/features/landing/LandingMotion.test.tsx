import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

import landingCss from './Landing.module.css?raw'
import motionCss from './motion.module.css?raw'
import sectionsCss from './sections/Sections.module.css?raw'

/**
 * LANDING-03 - the landing page's motion and interactions.
 *
 * jsdom lays nothing out and runs no CSS animation, so what is tested here is
 * what can be proven without a browser: the current-section marking, that the
 * decorative motion layers never get in the way of the page, and - read from
 * the stylesheets themselves - that nothing moves outside the
 * `prefers-reduced-motion: no-preference` gate.
 */

const TITLE = 'Learn together, at your own pace.'

/** A controllable IntersectionObserver: the test decides what crosses. */
class FakeObserver {
  static instances: FakeObserver[] = []
  readonly observed: Element[] = []
  readonly callback: IntersectionObserverCallback
  readonly options: IntersectionObserverInit | undefined
  disconnected = false

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    FakeObserver.instances.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true
  }

  takeRecords() {
    return []
  }

  /** Reports these sections as crossing (true) or leaving (false) the band. */
  report(changes: Record<string, boolean>) {
    const entries = Object.entries(changes).map(([id, isIntersecting]) => ({
      target: document.getElementById(id)!,
      isIntersecting,
    })) as unknown as IntersectionObserverEntry[]
    act(() => this.callback(entries, this as unknown as IntersectionObserver))
  }
}

async function openLanding(width: number = viewports.wide) {
  const result = await renderRoute({ path: '/', width })
  await screen.findByRole('heading', { name: TITLE, level: 1 })
  return result
}

const currentLinks = () =>
  within(screen.getByRole('banner'))
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'true')
    .map((link) => link.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
  FakeObserver.instances = []
})

describe('landing motion - the current section', () => {
  it('marks Platform at the top of the page, as the boards draw it', async () => {
    await openLanding()

    expect(currentLinks()).toEqual(['Platform'])
  })

  it('follows the section being read, in page order', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openLanding()
    const [observer] = FakeObserver.instances

    // It watches the five anchored sections, and only them.
    expect(observer!.observed.map((element) => element.id)).toEqual([
      'platform',
      'preview',
      'benefits',
      'how',
      'contact',
    ])

    observer!.report({ benefits: true })
    expect(currentLinks()).toEqual(['Benefits'])

    // Two sections in the band: the first one down the page wins.
    observer!.report({ preview: true })
    expect(currentLinks()).toEqual(['Preview'])

    observer!.report({ preview: false, benefits: false, how: true })
    expect(currentLinks()).toEqual(['How it works'])
  })

  it('keeps the last section while none crosses the band', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openLanding()
    const [observer] = FakeObserver.instances

    observer!.report({ contact: true })
    observer!.report({ contact: false })

    expect(currentLinks()).toEqual(['Contact'])
  })

  it('starts the band under the sticky header, where the anchors land', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openLanding()

    expect(FakeObserver.instances[0]!.options?.rootMargin).toMatch(/^-84px /)
  })

  it('marks the same section in the phone menu', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openLanding(viewports.mobile)
    FakeObserver.instances[0]!.report({ how: true })

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'How it works' })).toHaveAttribute('aria-current', 'true')
    expect(within(nav).getByRole('link', { name: 'Platform' })).not.toHaveAttribute('aria-current')
  })

  it('stops watching when the page is left', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { router } = await openLanding()

    await userEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    expect(FakeObserver.instances.every((observer) => observer.disconnected)).toBe(true)
  })

  it('works without IntersectionObserver: the links still lead to their sections', async () => {
    // jsdom has none, like an old browser.
    expect(typeof globalThis.IntersectionObserver).toBe('undefined')
    await openLanding()

    const nav = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Main' })
    for (const link of within(nav).getAllByRole('link')) {
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).not.toBeNull()
    }
  })
})

describe('landing motion - nothing gets in the way', () => {
  it('the heading reads as one sentence, word animation or not', async () => {
    await openLanding()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveAccessibleName(TITLE)
    expect(heading.textContent).toBe(TITLE)
  })

  it('adds no focusable element: the motion layers are decoration', async () => {
    await openLanding()

    for (const decoration of document.querySelectorAll('[aria-hidden="true"]')) {
      expect(decoration.querySelector('a, button, input, [tabindex]')).toBeNull()
    }
  })

  it('a card’s tilt zones do not swallow the click: the card still opens', async () => {
    const { router } = await openLanding()
    const card = within(screen.getByRole('region', { name: 'Go straight to what you need' })).getByRole('link', {
      name: /Course catalogue/,
    })

    // The zones are the top layer of the card; a click lands on one of them.
    const zone = card.querySelector('[aria-hidden="true"] > span')!
    await userEvent.click(zone)

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('the preview tabs still switch', async () => {
    await openLanding()
    const preview = screen.getByRole('region', { name: 'A quick look inside' })

    await userEvent.click(within(preview).getByRole('tab', { name: 'Progress' }))

    expect(within(preview).getByRole('tabpanel')).toHaveAccessibleName('Progress')
  })
})

/**
 * Removes every block gated on `prefers-reduced-motion: no-preference`, so
 * what is left is what applies to someone who asked for reduced motion.
 */
function withoutMotionGate(css: string): string {
  let result = ''
  let index = 0
  const opener = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g
  for (let match = opener.exec(css); match !== null; match = opener.exec(css)) {
    result += css.slice(index, match.index)
    let depth = 1
    let cursor = match.index + match[0].length
    while (depth > 0 && cursor < css.length) {
      if (css[cursor] === '{') depth += 1
      if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    index = cursor
    opener.lastIndex = cursor
  }
  return result + css.slice(index)
}

describe('landing motion - prefers-reduced-motion', () => {
  it.each([
    ['Landing.module.css', landingCss],
    ['Sections.module.css', sectionsCss],
    ['motion.module.css', motionCss],
  ])('%s moves nothing outside the no-preference gate', (_name, css) => {
    const reduced = withoutMotionGate(css).replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')

    // No animation, no transition...
    expect(reduced).not.toMatch(/\banimation(-name)?\s*:/)
    expect(reduced).not.toMatch(/\btransition\s*:/)
    // ...and no hover or focus state that moves anything.
    for (const rule of reduced.match(/[^{}]*:(hover|focus-visible|active)[^{]*\{[^}]*\}/g) ?? []) {
      expect(rule, rule).not.toMatch(/\btransform\s*:/)
    }
  })

  it('smooth scrolling to anchors is a motion too, and gated with the rest', () => {
    expect(withoutMotionGate(landingCss)).not.toMatch(/scroll-behavior:\s*smooth/)
    expect(landingCss).toMatch(/scroll-behavior:\s*smooth/)
  })
})
