/**
 * A `matchMedia` jsdom does not provide.
 *
 * The shell mounts genuinely different structures per breakpoint - a bottom bar
 * instead of a header nav, a drawer instead of a sidebar - so tests have to be
 * able to say which viewport they are describing. This parses the handful of
 * `min-width` / `max-width` queries `useMediaQuery` actually asks for and
 * notifies listeners when the width changes.
 */

const MIN_WIDTH = /\(min-width:\s*(\d+)px\)/
const MAX_WIDTH = /\(max-width:\s*(\d+)px\)/

let currentWidth = 1440
const listeners = new Set<() => void>()

function matches(query: string): boolean {
  const min = MIN_WIDTH.exec(query)
  if (min?.[1] !== undefined && currentWidth < Number(min[1])) return false

  const max = MAX_WIDTH.exec(query)
  if (max?.[1] !== undefined && currentWidth > Number(max[1])) return false

  return Boolean(min ?? max)
}

/** Design breakpoints, named as the boards name them. */
export const viewports: Record<'mobile' | 'tablet' | 'laptop' | 'desktop' | 'wide', number> = {
  mobile: 390,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1440,
}

export function installMatchMedia(): void {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => {
      const local = new Set<() => void>()

      return {
        get matches() {
          return matches(query)
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: EventListener) => {
          const wrapped = () => listener(new Event('change'))
          local.add(wrapped)
          listeners.add(wrapped)
        },
        removeEventListener: () => {
          for (const wrapped of local) listeners.delete(wrapped)
          local.clear()
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      } as unknown as MediaQueryList
    },
  })
}

/** Sets the viewport width for the current test and notifies subscribers. */
export function setViewport(width: number): void {
  currentWidth = width
  Object.defineProperty(globalThis, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
  for (const listener of [...listeners]) listener()
}

/** Restores the default desktop width between tests. */
export function resetViewport(): void {
  currentWidth = viewports.wide
  listeners.clear()
}
