import { useCallback, useSyncExternalStore } from 'react'

import { bp } from './tokens'

/**
 * Subscribes to a CSS media query.
 *
 * The shell switches between genuinely different structures - a top navigation
 * bar versus a bottom bar, an expanded sidebar versus an icon rail versus a
 * drawer - so those alternatives are mounted conditionally rather than hidden
 * with CSS. Hiding them would leave two `<nav aria-label="Main">` landmarks in
 * the accessibility tree at once, and would ship both to every viewport.
 *
 * Returns `false` where `matchMedia` is unavailable, which keeps the desktop
 * structure as the default.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = globalThis.matchMedia?.(query)
      if (!list) return () => undefined
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => globalThis.matchMedia?.(query).matches ?? false, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/**
 * Named breakpoint queries, built from the design's `bp` tokens so no component
 * writes a pixel value of its own.
 *
 * DS 04: xs < 600 · sm 600-1023 · md 1024-1279 · lg 1280-1599 · xl >= 1600.
 */
export const media = {
  /** Phones: bottom bar, drawer navigation. */
  belowSm: `(max-width: ${bp.sm - 1}px)`,
  /** Tablet and up. */
  smAndUp: `(min-width: ${bp.sm}px)`,
  /** Laptop and up: the admin sidebar expands to 248px. */
  mdAndUp: `(min-width: ${bp.md}px)`,
} as const
