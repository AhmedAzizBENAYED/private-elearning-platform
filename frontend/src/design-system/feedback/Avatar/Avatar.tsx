import { initialsFrom } from './initials'

import styles from './Avatar.module.css'

export type AvatarSize = 24 | 32 | 40 | 56 | 128
export type AvatarTone = 'default' | 'brand' | 'accent' | 'inactive'

export interface AvatarProps {
  /** Full name; the first and last words become the two initials. */
  name: string
  size?: AvatarSize
  tone?: AvatarTone
  className?: string
}

/** Font size per disc size, read off the DS 06 row; 128 is the Profile board's identity card. */
const fontSize: Record<AvatarSize, number> = { 24: 10, 32: 12, 40: 14, 56: 20, 128: 46 }

const toneClass: Record<AvatarTone, string> = {
  default: styles.default,
  brand: styles.brand,
  accent: styles.accent,
  inactive: styles.inactive,
}

/**
 * Initials disc (DS 06).
 *
 * Always `aria-hidden`: the avatar is a visual shorthand for a name that is
 * already written next to it, so announcing "I B" would only add noise. A
 * caller that shows an avatar with no adjacent name must render the name
 * itself, visibly or visually hidden.
 */
export function Avatar({ name, size = 40, tone = 'default', className }: AvatarProps) {
  return (
    <span
      className={[styles.avatar, toneClass[tone], className].filter(Boolean).join(' ')}
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${fontSize[size]}px` }}
      aria-hidden="true"
    >
      {initialsFrom(name)}
    </span>
  )
}
