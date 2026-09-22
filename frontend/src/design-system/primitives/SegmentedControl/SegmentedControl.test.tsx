import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

type Kind = 'VIDEO' | 'DOCUMENT' | 'TEXT' | 'LINK'

const options: SegmentedOption<Kind>[] = [
  { value: 'VIDEO', label: 'Video', icon: 'video' },
  { value: 'DOCUMENT', label: 'Document', icon: 'doc' },
  { value: 'TEXT', label: 'Text', icon: 'text' },
  { value: 'LINK', label: 'Link', icon: 'link' },
]

function Harness({ initial = 'VIDEO' as Kind, onChange = vi.fn() }) {
  const [value, setValue] = useState<Kind>(initial)

  return (
    <SegmentedControl<Kind>
      label="Lesson type"
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  it('exposes radiogroup semantics with an accessible group name', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: 'Lesson type' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('marks exactly one option as checked', () => {
    render(<Harness initial="TEXT" />)

    expect(screen.getByRole('radio', { name: 'Text' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Video' })).not.toBeChecked()
  })

  it('keeps a single tab stop on the selected option', async () => {
    render(<Harness initial="DOCUMENT" />)

    await userEvent.tab()
    expect(screen.getByRole('radio', { name: 'Document' })).toHaveFocus()

    // The remaining options are reached with the arrow keys, not with Tab.
    await userEvent.tab()
    expect(screen.getByRole('radio', { name: 'Document' })).not.toHaveFocus()
  })

  it('moves and selects with ArrowRight, wrapping at the end', async () => {
    const onChange = vi.fn()
    render(<Harness initial="LINK" onChange={onChange} />)

    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('VIDEO')
    expect(screen.getByRole('radio', { name: 'Video' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Video' })).toHaveFocus()
  })

  it('moves and selects with ArrowLeft, wrapping at the start', async () => {
    const onChange = vi.fn()
    render(<Harness initial="VIDEO" onChange={onChange} />)

    await userEvent.tab()
    await userEvent.keyboard('{ArrowLeft}')

    expect(onChange).toHaveBeenCalledWith('LINK')
    expect(screen.getByRole('radio', { name: 'Link' })).toBeChecked()
  })

  it('jumps to the first and last option with Home and End', async () => {
    render(<Harness initial="DOCUMENT" />)

    await userEvent.tab()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'Link' })).toBeChecked()

    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: 'Video' })).toBeChecked()
  })

  it('selects on click', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await userEvent.click(screen.getByRole('radio', { name: 'Text' }))
    expect(onChange).toHaveBeenCalledWith('TEXT')
  })

  it('disables every option when the control is disabled', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl<Kind>
        label="Lesson type"
        options={options}
        value="VIDEO"
        onChange={onChange}
        disabled
      />,
    )

    const text = screen.getByRole('radio', { name: 'Text' })
    expect(text).toBeDisabled()
    await userEvent.click(text)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('skips a disabled option when arrowing', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl<Kind>
        label="Lesson type"
        value="VIDEO"
        onChange={onChange}
        options={[
          { value: 'VIDEO', label: 'Video' },
          { value: 'DOCUMENT', label: 'Document', disabled: true },
          { value: 'TEXT', label: 'Text' },
        ]}
      />,
    )

    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('TEXT')
  })

  it('keeps the group named when the label is hidden, and prints nothing extra', () => {
    const { rerender } = render(<Harness />)
    // Shown by default: nothing changes for the controls that already use it.
    expect(screen.getByText('Lesson type').className).not.toMatch(/labelHidden/)

    rerender(
      <SegmentedControl<Kind>
        label="Lesson type"
        hideLabel
        options={options}
        value="VIDEO"
        onChange={vi.fn()}
      />,
    )

    // Still the group's accessible name - only its printing is given up.
    expect(screen.getByRole('radiogroup', { name: 'Lesson type' })).toBeInTheDocument()
    expect(screen.getByText('Lesson type').className).toMatch(/labelHidden/)
    expect(screen.getAllByRole('radio')).toHaveLength(options.length)
  })
})
