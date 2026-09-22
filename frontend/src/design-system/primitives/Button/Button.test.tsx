import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
  it('renders a button with its label and a default type of "button"', () => {
    render(<Button>Save lesson</Button>)

    const button = screen.getByRole('button', { name: 'Save lesson' })
    // Without this, a button inside a form submits it by accident.
    expect(button).toHaveAttribute('type', 'button')
  })

  it('renders an anchor when href is given', () => {
    render(<Button href="/courses">Browse courses</Button>)

    const link = screen.getByRole('link', { name: 'Browse courses' })
    expect(link).toHaveAttribute('href', '/courses')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps a disabled link out of the tab order and marks it aria-disabled', () => {
    render(
      <Button href="/courses" disabled>
        Browse courses
      </Button>,
    )

    // A disabled link is not exposed as a link once it loses its href.
    const element = screen.getByText('Browse courses').closest('a')
    expect(element).not.toHaveAttribute('href')
    expect(element).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not fire onClick while disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Publish
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Publish' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('announces the loading state, swaps the label and blocks activation', async () => {
    const onClick = vi.fn()
    render(
      <Button loading loadingLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Saving…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('falls back to the normal children when loading without a loadingLabel', () => {
    render(<Button loading>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
  })

  it('gives an icon-only button an accessible name and no visible text', () => {
    render(<Button iconOnly iconLeft="trash" aria-label="Delete lesson" />)

    const button = screen.getByRole('button', { name: 'Delete lesson' })
    expect(button).toHaveAccessibleName('Delete lesson')
    expect(button).toHaveTextContent('')
  })

  it('hides decorative icons from assistive technology', () => {
    const { container } = render(<Button iconLeft="plus">Add module</Button>)

    const svg = container.querySelector('svg')
    // The label is already announced; the glyph must not repeat it.
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('forwards native button attributes', () => {
    render(
      <Button type="submit" name="publish">
        Publish
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Publish' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveAttribute('name', 'publish')
  })
})
