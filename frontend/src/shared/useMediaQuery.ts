/*
 * The media-query hook and the named breakpoints live in the design system,
 * where the Dialog needs them too (DS 06: a bottom sheet on a phone); they are
 * re-exported here so the rest of the application keeps importing them from
 * `shared`.
 */
export { media, useMediaQuery } from '../design-system'
