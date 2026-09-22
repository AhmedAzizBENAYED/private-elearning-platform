import { type IconName, iconNames } from './paths'

const knownIconNames = new Set<string>(iconNames)

/**
 * Narrows a string that must be an icon name.
 *
 * The design export's `tokens.ts` types its icon references as plain strings;
 * this turns a typo there into an immediate, loud failure instead of an icon
 * that silently renders as an empty square.
 */
export function asIconName(value: string): IconName {
  if (!knownIconNames.has(value)) {
    throw new Error(`Unknown icon "${value}". Add it to design-system/icons/paths.tsx.`)
  }
  return value as IconName
}
