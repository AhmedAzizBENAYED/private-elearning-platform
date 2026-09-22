/**
 * An http(s) URL, or `null` for anything else.
 *
 * Every URL the backend hands back is a string that eventually reaches an
 * `href`, and an `href` is an execution sink: `javascript:`, `data:` and
 * `vbscript:` all run in the page's own origin when clicked. Nothing that
 * arrives over the wire is trusted enough to skip this check, even where the
 * backend validates the value at write time - that gate protects the database,
 * not this browser, and a second one costs a single comparison.
 *
 * Returning `null` rather than throwing lets a caller render "not available"
 * instead of crashing a page over one bad field.
 *
 * Shared rather than feature-local because both the member area (LINK lessons)
 * and the administration area (a course's thumbnail address) render URLs the
 * backend supplied.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null

  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
