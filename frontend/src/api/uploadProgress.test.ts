import { describe, expect, it } from 'vitest'

import { advanceUploadPercent, uploadPercent } from './uploadProgress'

describe('uploadPercent (G33)', () => {
  it.each([
    [0, 100, 0],
    [25, 100, 25],
    [50, 100, 50],
    [100, 100, 100],
    [1_048_576, 4_194_304, 25],
  ])('turns %i of %i bytes into %i%%', (loaded, total, percent) => {
    expect(uploadPercent({ loaded, total })).toBe(percent)
  })

  it('never exceeds 100, even when a body reports more than its total', () => {
    expect(uploadPercent({ loaded: 150, total: 100 })).toBe(100)
    expect(uploadPercent({ loaded: Number.MAX_SAFE_INTEGER, total: 1 })).toBe(100)
  })

  it('never goes below 0', () => {
    expect(uploadPercent({ loaded: -5, total: 100 })).toBe(0)
  })

  it('rounds down, so 100% only once every byte has been sent', () => {
    expect(uploadPercent({ loaded: 999, total: 1000 })).toBe(99)
    expect(uploadPercent({ loaded: 1000, total: 1000 })).toBe(100)
  })

  it.each([
    ['no total', { loaded: 10, total: null }],
    ['a zero total', { loaded: 0, total: 0 }],
    ['a non-finite total', { loaded: 10, total: Number.POSITIVE_INFINITY }],
    ['a non-finite count', { loaded: Number.NaN, total: 100 }],
  ])('is indeterminate (null) with %s, rather than inventing a number', (_name, progress) => {
    expect(uploadPercent(progress)).toBeNull()
  })
})

describe('advanceUploadPercent (G33)', () => {
  it('follows the measurements 0, 25, 50, 100', () => {
    const seen: (number | null)[] = []
    let shown: number | null = null
    for (const loaded of [0, 25, 50, 100]) {
      shown = advanceUploadPercent(shown, { loaded, total: 100 })
      seen.push(shown)
    }
    expect(seen).toEqual([0, 25, 50, 100])
  })

  it('never goes back within one transfer, whatever order measurements arrive in', () => {
    let shown: number | null = null
    const seen: (number | null)[] = []
    for (const loaded of [10, 40, 30, 60, 55, 90]) {
      shown = advanceUploadPercent(shown, { loaded, total: 100 })
      seen.push(shown)
    }
    expect(seen).toEqual([10, 40, 40, 60, 60, 90])
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!)
  })

  it('stays indeterminate while no total is known', () => {
    expect(advanceUploadPercent(null, { loaded: 0, total: null })).toBeNull()
    expect(advanceUploadPercent(null, { loaded: 500, total: null })).toBeNull()
  })

  it('keeps the shown value when a measurement has no total', () => {
    expect(advanceUploadPercent(40, { loaded: 500, total: null })).toBe(40)
  })

  it('starts over when the transport restarts the transfer (loaded 0)', () => {
    // The replay after a refreshed session sends every byte again.
    expect(advanceUploadPercent(100, { loaded: 0, total: null })).toBeNull()
    expect(advanceUploadPercent(100, { loaded: 0, total: 100 })).toBe(0)
  })
})
