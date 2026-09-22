import { createContext, useContext } from 'react'

/**
 * Whether a bar is fixed to the bottom edge of the screen right now - the
 * member shell's bottom navigation (DS 07), shown on phones except on the
 * learning page.
 *
 * DS 06 places toasts "above the bottom bar (mobile)", and the bottom sheet a
 * dialog becomes on a phone sits above it too. Only the shell knows whether
 * the bar is mounted, so it provides this; everywhere else it is `false`, and
 * overlays keep to the screen's own bottom edge.
 */
export const BottomBarContext = createContext(false)

export function useBottomBar(): boolean {
  return useContext(BottomBarContext)
}
