import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { TextField } from './TextField'

describe('TextField', () => {
  it('associates the label with the input', () => {
    render(<TextField label="Email address" />)

    // getByLabelText only resolves through a real label/for relationship.
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
  })

  it('links the hint to the input through aria-describedby', () => {
    render(<TextField label="Email address" hint="We only use it to sign you in." />)

    const input = screen.getByLabelText('Email address')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'We only use it to sign you in.',
    )
  })

  it('links the error message and marks the input invalid', () => {
    render(<TextField label="Email address" error="Enter a valid email address" />)

    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid email address')
  })

  it('replaces the hint with the error so aria-describedby never dangles', () => {
    render(<TextField label="Email address" hint="Optional hint" error="Something is wrong" />)

    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAccessibleDescription('Something is wrong')
    expect(screen.queryByText('Optional hint')).not.toBeInTheDocument()
  })

  it('is not marked invalid without an error', () => {
    render(<TextField label="Email address" />)

    expect(screen.getByLabelText('Email address')).not.toHaveAttribute('aria-invalid')
  })

  it('exposes the required state', () => {
    render(<TextField label="Full name" required />)

    const input = screen.getByLabelText(/Full name/)
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-required', 'true')
  })

  it('does not accept input while disabled', async () => {
    render(<TextField label="Email address" disabled />)

    const input = screen.getByLabelText('Email address')
    expect(input).toBeDisabled()
    await userEvent.type(input, 'hello')
    expect(input).toHaveValue('')
  })

  it('renders a right-hand affordance that keeps its own accessible name', () => {
    render(
      <TextField
        label="Password"
        type="password"
        rightSlot={<button type="button" aria-label="Show password" />}
      />,
    )

    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
  })
})
