// Adds the jest-dom matchers (toBeDisabled, toHaveAccessibleName, ...) to
// Vitest's expect, together with their types.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { installObjectUrls, objectUrls } from './objectUrls'
import { installMatchMedia, resetViewport } from './viewport'

// Testing Library auto-registers cleanup only when Vitest exposes its globals.
// This project uses explicit imports, so the teardown is registered by hand -
// without it every render stays in the document and queries match the previous
// test's markup.
afterEach(cleanup)

// jsdom implements no `matchMedia`, and the responsive shell depends on it.
// Every test starts at the desktop width unless it says otherwise.
installMatchMedia()
beforeEach(resetViewport)
afterEach(resetViewport)

// jsdom implements neither `URL.createObjectURL` nor `URL.revokeObjectURL`, and
// the document viewer turns the bytes it fetches into an object URL. The stub
// also records creation and revocation, so cleanup can be asserted.
installObjectUrls()
beforeEach(() => objectUrls.reset())
