/**
 * How much of an upload's body has left the browser (G33).
 *
 * `total` is `null` when the browser cannot measure the body - the progress
 * event's `lengthComputable` is false - and at the very start of a transfer,
 * before the first measurement.
 */
export interface UploadProgress {
  loaded: number
  total: number | null
}

/**
 * `loaded / total` as a whole percentage, or `null` when there is no total to
 * divide by.
 *
 * Rounded down, so 100 is only ever shown once every byte has been sent, and
 * clamped to 0-100, so a body that reports more than its total cannot draw a
 * bar past its end. `null` means indeterminate: a percentage would be invented.
 */
export function uploadPercent({ loaded, total }: UploadProgress): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null
  if (!Number.isFinite(loaded)) return null
  return Math.min(100, Math.max(0, Math.floor((loaded / total) * 100)))
}

/**
 * The percentage to show once `progress` arrives, given the one shown now.
 *
 * Within one transfer it never goes back, whatever order measurements arrive
 * in. `loaded: 0` is the transport saying a transfer is (re)starting - the
 * first send, or the single replay after a refreshed session - so it starts
 * from its own value again, because the bytes really are being sent again. A
 * measurement with no total leaves the shown value as it is.
 */
export function advanceUploadPercent(shown: number | null, progress: UploadProgress): number | null {
  const percent = uploadPercent(progress)
  if (progress.loaded === 0) return percent
  if (percent === null) return shown
  return shown === null ? percent : Math.max(shown, percent)
}
