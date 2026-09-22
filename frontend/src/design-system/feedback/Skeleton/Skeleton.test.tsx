import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Skeleton, SkeletonGroup } from './Skeleton'

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('fills the available width by default and accepts explicit sizes', () => {
    const { container, rerender } = render(<Skeleton />)
    expect(container.firstElementChild).toHaveStyle({ width: '100%' })

    rerender(<Skeleton variant="block" width={64} height={36} />)
    expect(container.firstElementChild).toHaveStyle({ width: '64px', height: '36px' })
  })

  it('accepts a CSS length string as well as a number', () => {
    const { container } = render(<Skeleton width="12rem" />)

    expect(container.firstElementChild).toHaveStyle({ width: '12rem' })
  })
})

describe('SkeletonGroup', () => {
  it('announces the loading state once for the whole group', () => {
    render(
      <SkeletonGroup label="Loading courses">
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>,
    )

    const group = screen.getByRole('status', { name: 'Loading courses' })
    expect(group).toHaveAttribute('aria-busy', 'true')
  })
})
