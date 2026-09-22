import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Select } from './Select'

const options = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

describe('Select', () => {
  it('is a native combobox with an associated label', () => {
    render(<Select label="Status" options={options} defaultValue="all" />)

    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInstanceOf(HTMLSelectElement)
  })

  it('renders every option', () => {
    render(<Select label="Status" options={options} defaultValue="all" />)

    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('option', { name: 'Active' })).toBeInTheDocument()
  })

  it('reports the chosen value', async () => {
    const onChange = vi.fn()
    render(<Select label="Status" options={options} defaultValue="all" onChange={onChange} />)

    await userEvent.selectOptions(screen.getByRole('combobox'), 'inactive')
    expect(screen.getByRole('combobox')).toHaveValue('inactive')
    expect(onChange).toHaveBeenCalled()
  })

  it('renders a placeholder as a disabled first option', () => {
    render(
      <Select label="Module" options={options} placeholder="Choose a module" defaultValue="" />,
    )

    expect(screen.getByRole('option', { name: 'Choose a module' })).toBeDisabled()
  })

  it('links its error and marks itself invalid', () => {
    render(
      <Select label="Module" options={options} defaultValue="all" error="Choose a module" />,
    )

    const select = screen.getByRole('combobox', { name: 'Module' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Choose a module')
  })

  it('exposes required and disabled states', () => {
    const { rerender } = render(
      <Select label="Status" options={options} defaultValue="all" required />,
    )
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-required', 'true')

    rerender(<Select label="Status" options={options} defaultValue="all" disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('hides the decorative chevron from assistive technology', () => {
    const { container } = render(<Select label="Status" options={options} defaultValue="all" />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  describe('hideLabel', () => {
    it('shows the label by default', () => {
      render(<Select label="Status" options={options} defaultValue="all" />)

      const label = screen.getByText('Status')
      expect(label.tagName).toBe('LABEL')
      expect(label.className).not.toMatch(/labelHidden/)
      // In the flow, so it occupies a row above the control.
      expect(getComputedStyle(label).position).not.toBe('absolute')
    })

    it('keeps the label for assistive technology when hidden', () => {
      render(<Select label="Status" options={options} defaultValue="all" hideLabel />)

      // The accessible name is unchanged: the label is still rendered, still
      // carries `for`, and is hidden by clipping rather than by `display:none`,
      // which would remove it from the accessibility tree entirely.
      const select = screen.getByRole('combobox', { name: 'Status' })
      const label = screen.getByText('Status')
      expect(label).toHaveAttribute('for', select.id)
      expect(label.className).toMatch(/labelHidden/)
      expect(getComputedStyle(label).display).not.toBe('none')
    })

    it('never puts the prop on the native select', () => {
      const { rerender } = render(
        <Select label="Status" options={options} defaultValue="all" hideLabel />,
      )
      expect(screen.getByRole('combobox').getAttributeNames()).not.toContain('hidelabel')

      rerender(<Select label="Status" options={options} defaultValue="all" />)
      expect(screen.getByRole('combobox').getAttributeNames()).not.toContain('hidelabel')
    })

    it('keeps every other behaviour while the label is hidden', async () => {
      const onChange = vi.fn()
      render(
        <Select
          label="Status"
          options={options}
          defaultValue="all"
          hideLabel
          required
          error="Choose a status"
          onChange={onChange}
        />,
      )

      const select = screen.getByRole('combobox', { name: 'Status' })
      expect(select).toHaveAttribute('aria-required', 'true')
      expect(select).toHaveAttribute('aria-invalid', 'true')
      expect(select).toHaveAccessibleDescription('Choose a status')
      expect(screen.getAllByRole('option')).toHaveLength(3)

      await userEvent.selectOptions(select, 'active')
      expect(onChange).toHaveBeenCalled()
    })
  })
})
