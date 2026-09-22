import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import {
  Icon,
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
  type IconName,
} from '../design-system'

export interface LinkButtonProps {
  to: string
  /** Omitted for an `iconOnly` link, which is named by `aria-label` instead. */
  children?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  iconLeft?: IconName
  iconRight?: IconName
  className?: string
  /** The glyph alone, square, as `Button iconOnly` draws it. */
  iconOnly?: boolean
  'aria-label'?: string
  /** Router location state, for a destination that needs to know the origin. */
  state?: unknown
}

/** DS 05 pairs an 18px glyph with every button size. */
const ICON_SIZE = 18

/**
 * A router link that looks like a button.
 *
 * `Button`'s `href` renders a bare `<a>`, which in a single-page application is
 * a full document navigation: the router never sees the click and the whole
 * app reloads - losing the session state held in memory and re-downloading the
 * bundle. `buttonClassName` exists for exactly this case - its own
 * documentation says "some actions are navigation and must be a router `Link`,
 * which renders its own anchor" - so the appearance is reused without the
 * behaviour.
 *
 * It lives in `app/` rather than in the design system because it depends on the
 * router, and the design system deliberately does not: `buttonClassName` is
 * exported separately precisely so this component can be built outside it.
 * Member and admin features both use it.
 *
 * `Button href` is still the right choice for a link that leaves the
 * application - an external site, a `mailto:`, a download - where a full
 * navigation is what is actually wanted.
 */
export function LinkButton({
  to,
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  className,
  iconOnly = false,
  'aria-label': ariaLabel,
  state,
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      state={state}
      className={buttonClassName({ variant, size, iconOnly, className })}
      aria-label={ariaLabel}
    >
      {iconLeft ? <Icon name={iconLeft} size={ICON_SIZE} /> : null}
      {iconOnly ? null : <span>{children}</span>}
      {iconRight ? <Icon name={iconRight} size={ICON_SIZE} /> : null}
    </Link>
  )
}
