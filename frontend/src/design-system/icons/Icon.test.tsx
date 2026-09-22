import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { asIconName } from './asIconName'
import { Icon } from './Icon'
import { iconNames, iconPaths } from './paths'

describe('Icon', () => {
  it('is decorative by default', () => {
    const { container } = render(<Icon name="play" />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('role')
  })

  it('becomes an image with an accessible name when given a title', () => {
    const { container, getByTitle } = render(<Icon name="play" title="Play" />)

    expect(container.querySelector('svg')).toHaveAttribute('role', 'img')
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden')
    expect(getByTitle('Play')).toBeInTheDocument()
  })

  it('inherits colour instead of taking a colour prop', () => {
    const { container } = render(<Icon name="check" />)

    expect(container.querySelector('svg')).toHaveAttribute('stroke', 'currentColor')
  })

  it('renders at the requested size on the 24px grid', () => {
    const { container } = render(<Icon name="check" size={14} />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '14')
    expect(svg).toHaveAttribute('height', '14')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
  })

  it('draws every name in the exported set', () => {
    for (const name of iconNames) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg')?.childElementCount ?? 0).toBeGreaterThan(0)
      unmount()
    }
  })

  it('has a path entry for every declared name, and no extras', () => {
    expect(Object.keys(iconPaths).sort()).toEqual([...iconNames].sort())
  })
})

describe('asIconName', () => {
  it('passes a known name through', () => {
    expect(asIconName('check-circle')).toBe('check-circle')
  })

  it('can normalise every shape to pathLength 1, so a stylesheet can draw it', () => {
    // `compass` groups a circle and a polygon; `play` is a single shape.
    for (const name of ['compass', 'play'] as const) {
      const { container, unmount } = render(<Icon name={name} drawable />)
      const shapes = container.querySelectorAll('svg > *')
      expect(shapes.length).toBeGreaterThan(0)
      for (const shape of shapes) expect(shape).toHaveAttribute('pathLength', '1')
      unmount()
    }
  })

  it('leaves the shapes untouched when not drawable', () => {
    const { container } = render(<Icon name="compass" />)

    for (const shape of container.querySelectorAll('svg > *')) {
      expect(shape).not.toHaveAttribute('pathLength')
    }
  })

  it('throws loudly on an unknown name rather than rendering nothing', () => {
    expect(() => asIconName('not-an-icon')).toThrow(/Unknown icon/)
  })
})
