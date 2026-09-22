import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

import { Icon, type IconName } from '../../icons'

import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from './buttonClassName'
import styles from './Button.module.css'

/** DS 05 pairs an 18px glyph with every button size. */
const ICON_SIZE = 18

interface OwnProps {
  variant?: ButtonVariant
  size?: ButtonSize
  iconLeft?: IconName
  iconRight?: IconName
  fullWidth?: boolean
  disabled?: boolean
  /**
   * Shows a spinner, sets `aria-busy` and blocks activation. The button keeps
   * its variant colours and its width so the layout does not shift.
   */
  loading?: boolean
  /**
   * Label shown while `loading`. DS 05: "Loading label changes to progressive
   * form (Saving...)". Falls back to the normal children when omitted.
   */
  loadingLabel?: ReactNode
  /** Renders an `<a>` instead of a `<button>`. */
  href?: string
  className?: string
}

/** Everything the underlying element accepts that this component does not own. */
type NativeProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement> & AnchorHTMLAttributes<HTMLAnchorElement>,
  keyof OwnProps | 'children'
>

/**
 * A button with no visible text. `aria-label` is required by the type, so an
 * unnamed icon-only button is a compile error rather than a review comment.
 * The glyph comes from `iconLeft`.
 */
interface IconOnlyProps extends OwnProps {
  iconOnly: true
  iconLeft: IconName
  'aria-label': string
  children?: never
}

interface LabelledProps extends OwnProps {
  iconOnly?: false
  children: ReactNode
}

export type ButtonProps = (IconOnlyProps | LabelledProps) & NativeProps

export type { ButtonSize, ButtonVariant }

/** The shape after the union has served its purpose at the call site. */
type ResolvedProps = OwnProps &
  NativeProps & {
    iconOnly?: boolean
    children?: ReactNode
  }

/**
 * The single action control of the design system (DS 05).
 *
 * Renders a real `<a>` when `href` is present and a `<button>` otherwise, so
 * navigation keeps its native affordances (middle-click, open in a new tab,
 * status bar) and actions keep theirs (Space to activate, form submission).
 */
export function Button(props: ButtonProps) {
  // The public union exists to constrain callers. Inside, both arms carry the
  // same fields, so it is collapsed once here rather than branched throughout.
  const {
    variant = 'primary',
    size = 'md',
    iconLeft,
    iconRight,
    fullWidth = false,
    loading = false,
    loadingLabel,
    iconOnly = false,
    disabled = false,
    href,
    className,
    children,
    ...rest
  } = props as ResolvedProps

  const inert = disabled || loading

  const classes = buttonClassName({ variant, size, fullWidth, iconOnly, className })

  const content = (
    <>
      {loading ? (
        <Icon name="spinner" size={ICON_SIZE} className={styles.spinner} />
      ) : iconLeft ? (
        <Icon name={iconLeft} size={ICON_SIZE} />
      ) : null}
      {iconOnly ? null : <span>{loading && loadingLabel ? loadingLabel : children}</span>}
      {!loading && iconRight ? <Icon name={iconRight} size={ICON_SIZE} /> : null}
    </>
  )

  if (href !== undefined) {
    return (
      <a
        // `rest` is NativeProps, which is the union of both elements'
        // attributes; this narrows it to the half that belongs on an anchor.
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        className={classes}
        // A disabled link has no HTML equivalent: dropping href removes it from
        // the tab order the way `disabled` removes a button, and aria-disabled
        // explains why it is still on screen.
        href={inert ? undefined : href}
        aria-disabled={inert ? true : undefined}
        aria-busy={loading ? true : undefined}
      >
        {content}
      </a>
    )
  }

  const { type = 'button', ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>

  return (
    <button
      {...buttonRest}
      type={type}
      className={classes}
      disabled={inert}
      aria-busy={loading ? true : undefined}
    >
      {content}
    </button>
  )
}
