import { useCallback, useState } from 'react'

import { media, useMediaQuery } from '../../design-system/responsive'

export interface ModuleDisclosure {
  /** Below 1024px the modules fold; from 1024px every module is open. */
  collapsible: boolean
  isOpen: (moduleId: string) => boolean
  toggle: (moduleId: string) => void
}

/**
 * Which modules of an outline are open (DS 08: "Chevron: expand / collapse,
 * aria-expanded on the header button" and "Default: module of the current
 * lesson open, others collapsed on mobile"; Learning-Tablet and
 * Details-Mobile draw the same).
 *
 * The default follows the current module, so moving to a lesson in another
 * module opens that one; a module the member opened or closed keeps their
 * choice. From 1024px the outline is a sidebar with room for everything, as
 * the desktop boards draw it, so nothing folds.
 *
 * Shared by the course details outline and the learning sidebar.
 */
export function useModuleDisclosure(currentModuleId: string | null): ModuleDisclosure {
  const collapsible = !useMediaQuery(media.mdAndUp)
  const [choices, setChoices] = useState<Readonly<Record<string, boolean>>>({})

  const isOpen = useCallback(
    (moduleId: string) => !collapsible || (choices[moduleId] ?? moduleId === currentModuleId),
    [collapsible, choices, currentModuleId],
  )

  const toggle = useCallback(
    (moduleId: string) =>
      setChoices((previous) => ({
        ...previous,
        [moduleId]: !(previous[moduleId] ?? moduleId === currentModuleId),
      })),
    [currentModuleId],
  )

  return { collapsible, isOpen, toggle }
}
