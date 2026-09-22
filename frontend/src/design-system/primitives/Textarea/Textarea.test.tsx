import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Textarea } from './Textarea'

describe('Textarea', () => {
  it('associates the label and honours the row count', () => {
    render(<Textarea label="Description" rows={5} />)

    const textarea = screen.getByLabelText('Description')
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    expect(textarea).toHaveAttribute('rows', '5')
  })

  it('links the hint through aria-describedby', () => {
    render(<Textarea label="Description" hint="Shown under the lesson title." />)

    expect(screen.getByLabelText('Description')).toHaveAccessibleDescription(
      'Shown under the lesson title.',
    )
  })

  it('links the error and marks itself invalid', () => {
    render(<Textarea label="Description" error="Add a short description" />)

    const textarea = screen.getByLabelText('Description')
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAccessibleDescription('Add a short description')
  })

  it('accepts typing and reports it', async () => {
    render(<Textarea label="Description" />)

    const textarea = screen.getByLabelText('Description')
    await userEvent.type(textarea, 'Hello')
    expect(textarea).toHaveValue('Hello')
  })

  it('does not accept input while disabled', async () => {
    render(<Textarea label="Description" disabled />)

    const textarea = screen.getByLabelText('Description')
    expect(textarea).toBeDisabled()
    await userEvent.type(textarea, 'Hello')
    expect(textarea).toHaveValue('')
  })

  it('shows a character counter only when both the length and the limit are given', () => {
    const { rerender } = render(<Textarea label="Description" value="abc" readOnly />)
    expect(screen.queryByText(/\//)).not.toBeInTheDocument()

    rerender(<Textarea label="Description" value="abc" readOnly maxLength={200} valueLength={3} />)
    expect(screen.getByText('3 / 200')).toBeInTheDocument()
  })

  it('exposes the required state', () => {
    render(<Textarea label="Description" required />)

    expect(screen.getByLabelText(/Description/)).toHaveAttribute('aria-required', 'true')
  })
})
