import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge } from './Badge'

describe('Badge', () => {
  it('renders the course status label as real text', () => {
    render(<Badge kind="course-status" value="PUBLISHED" />)

    expect(screen.getByText('PUBLISHED')).toBeInTheDocument()
  })

  it('always pairs the label with a glyph, so colour is never the only signal', () => {
    const { container } = render(<Badge kind="course-status" value="DRAFT" />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('DRAFT')).toBeInTheDocument()
  })

  it('covers every course status', () => {
    const { rerender } = render(<Badge kind="course-status" value="DRAFT" />)
    expect(screen.getByText('DRAFT')).toBeInTheDocument()

    rerender(<Badge kind="course-status" value="ARCHIVED" />)
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('renders member statuses', () => {
    const { rerender } = render(<Badge kind="member-status" value="active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()

    rerender(<Badge kind="member-status" value="inactive" />)
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('renders learning statuses', () => {
    const { rerender } = render(<Badge kind="learning-status" value="not-enrolled" />)
    expect(screen.getByText('Not enrolled')).toBeInTheDocument()

    rerender(<Badge kind="learning-status" value="in-progress" />)
    expect(screen.getByText('In progress')).toBeInTheDocument()

    rerender(<Badge kind="learning-status" value="completed" />)
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('renders each lesson type with its own glyph', () => {
    const { container, rerender } = render(<Badge kind="lesson-type" value="VIDEO" />)
    expect(screen.getByText('VIDEO')).toBeInTheDocument()
    const videoGlyph = container.innerHTML

    rerender(<Badge kind="lesson-type" value="LINK" />)
    expect(screen.getByText('LINK')).toBeInTheDocument()
    // A different type must not silently reuse the previous glyph.
    expect(container.innerHTML).not.toBe(videoGlyph)
  })

  it('keeps its glyph decorative, since the label already carries the meaning', () => {
    const { container } = render(<Badge kind="learning-status" value="completed" />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
