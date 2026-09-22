import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Progress } from './Progress'

describe('Progress', () => {
  it('exposes the progressbar role with its full ARIA value set', () => {
    render(<Progress value={45} label="Course progress" />)

    const bar = screen.getByRole('progressbar', { name: 'Course progress' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '45')
  })

  it('clamps values outside 0-100 instead of overflowing the track', () => {
    const { rerender } = render(<Progress value={-20} label="Course progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

    rerender(<Progress value={140} label="Course progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('treats a non-finite value as zero', () => {
    render(<Progress value={Number.NaN} label="Course progress" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('rounds the announced value to a whole percent', () => {
    render(<Progress value={45.45} label="Course progress" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45')
  })

  it('renders the header and caption when asked', () => {
    render(
      <Progress value={45} label="Progress" showHeader caption="5 of 11 videos completed" />,
    )

    expect(screen.getByText('Progress')).toBeInTheDocument()
    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getByText('5 of 11 videos completed')).toBeInTheDocument()
  })

  it('keeps its accessible name when the header is hidden', () => {
    render(<Progress value={45} label="Course progress" />)

    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Course progress')
    expect(screen.queryByText('45%')).not.toBeInTheDocument()
  })
})
