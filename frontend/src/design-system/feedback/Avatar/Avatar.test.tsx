import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'
import { initialsFrom } from './initials'

describe('initialsFrom', () => {
  it('takes the first and last name', () => {
    expect(initialsFrom('Iyed Belghith')).toBe('IB')
    expect(initialsFrom('Yassine Ben Ammar')).toBe('YA')
  })

  it('falls back to one initial for a single word', () => {
    expect(initialsFrom('Amal')).toBe('A')
  })

  it('tolerates padding, double spaces and an empty name', () => {
    expect(initialsFrom('  amal   dridi  ')).toBe('AD')
    expect(initialsFrom('   ')).toBe('')
  })
})

describe('Avatar', () => {
  it('renders the initials', () => {
    render(<Avatar name="Iyed Belghith" />)

    expect(screen.getByText('IB')).toBeInTheDocument()
  })

  it('is hidden from assistive technology, because the name is written nearby', () => {
    const { container } = render(<Avatar name="Iyed Belghith" />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('applies the requested disc size', () => {
    const { container } = render(<Avatar name="Iyed Belghith" size={56} />)

    expect(container.firstElementChild).toHaveStyle({ width: '56px', height: '56px' })
  })
})
