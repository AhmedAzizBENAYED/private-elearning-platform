import { render } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import { Gallery } from './Gallery'

/**
 * Accessibility gate for FE-01.
 *
 * The gallery renders every implemented component in every state, so running
 * axe against it covers the whole design system in one pass. The bar is zero
 * serious or critical violations; anything below that is reported but does not
 * fail the build, because a colour-contrast rule cannot be evaluated in jsdom
 * (no layout, no computed background) and would otherwise produce noise.
 */
describe('Design system gallery', () => {
  it('has no serious or critical accessibility violations', async () => {
    const { container } = render(<Gallery />)

    const results = await axe.run(container, {
      // jsdom computes no colours or geometry, so these rules cannot produce a
      // trustworthy verdict here. Contrast and target size are verified against
      // the boards and in a real browser instead.
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    })

    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    )

    expect(
      blocking.map((violation) => `${violation.id}: ${violation.help}`),
    ).toEqual([])
  }, 30_000)

  it('names every interactive control', () => {
    const { container } = render(<Gallery />)

    const unnamed = Array.from(
      container.querySelectorAll('button, a[href], input, select, textarea'),
    ).filter((element) => {
      const label = element.getAttribute('aria-label')
      const labelledBy = element.getAttribute('aria-labelledby')
      const id = element.getAttribute('id')
      const hasLabelElement = id
        ? Boolean(container.querySelector(`label[for="${CSS.escape(id)}"]`))
        : false
      const text = element.textContent?.trim()
      return !label && !labelledBy && !hasLabelElement && !text
    })

    expect(unnamed.map((element) => element.outerHTML)).toEqual([])
  })
})
