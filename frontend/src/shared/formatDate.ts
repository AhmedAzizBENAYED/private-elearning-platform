const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * `12 Sep 2026`, as the design writes a date.
 *
 * Spelled out rather than taken from `Intl.DateTimeFormat`, whose short month
 * names vary by ICU build - September is "Sep" in one and "Sept" in another -
 * and whose output would then depend on where the page happens to run.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const day = String(date.getDate()).padStart(2, '0')
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
