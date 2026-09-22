import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react'

import { type IconName, iconPaths } from './paths'

export interface IconProps {
  name: IconName
  /** Rendered square size in px. DS 04 draws on a 24px grid; 14/16/18/20 are
   *  the sizes the component boards actually use. */
  size?: number
  /** DS 04 strokes at 2; badges use 2.2 so 14px glyphs stay legible. */
  strokeWidth?: number
  /**
   * Accessible name. Omit it (the default) for a decorative icon sitting next
   * to a text label - the icon is then hidden from assistive technology so the
   * label is not announced twice. Supply it only when the icon is the sole
   * carrier of meaning.
   */
  title?: string
  className?: string
  style?: CSSProperties
  /**
   * Gives every shape `pathLength="1"`, so a stylesheet can draw the glyph
   * stroke by stroke with `stroke-dasharray: 1` - the Landing boards' drawn
   * icons. Invisible on its own: without that stylesheet nothing changes.
   */
  drawable?: boolean
}

/** Adds `pathLength="1"` to each shape of a glyph, however it is grouped. */
function normalised(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return child
    if (typeof child.type === 'string') {
      return cloneElement(child as React.ReactElement<Record<string, unknown>>, { pathLength: 1 })
    }
    // A fragment: descend into its shapes.
    return cloneElement(child, undefined, normalised(child.props.children))
  })
}

/**
 * The single icon renderer for the design system.
 *
 * Colour always comes from `currentColor`, so an icon inherits the colour of
 * whatever contains it and never takes a colour prop.
 */
export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  title,
  className,
  style,
  drawable = false,
}: IconProps) {
  const labelled = title !== undefined

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      {drawable ? normalised(iconPaths[name]) : iconPaths[name]}
    </svg>
  )
}
