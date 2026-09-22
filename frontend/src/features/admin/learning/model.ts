import { formatDate } from '../../../shared/formatDate'

import type { LearningProgressSort, LearningStatus } from './api'

/**
 * How the tracking screens read what the backend returns.
 *
 * Nothing here computes a percentage or a status: those arrive decided. What
 * this module does is turn them into the words and the windows the boards use,
 * in one place, so the matrix, the list, the activity screen and the two detail
 * pages cannot disagree with each other.
 */

/**
 * "Active now means a learning event was received in the last 5 minutes."
 *
 * The threshold is the design's own, written on DS-11 and repeated above the
 * activity table; the Tracking-logic board still marks it TO CONFIRM. It is a
 * window this screen asks for - `active_since` - not a rule the backend holds,
 * so confirming a different figure is a change here and nowhere else.
 */
export const ACTIVE_NOW_MINUTES = 5

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The activity filter of the boards, each window expressed as `active_since`. */
export type ActivityWindow = 'any' | 'now' | 'day' | 'week'

export const ACTIVITY_WINDOWS: readonly { value: ActivityWindow; label: string; ms: number | null }[] = [
  { value: 'any', label: 'Any activity', ms: null },
  { value: 'now', label: 'Currently active', ms: ACTIVE_NOW_MINUTES * MINUTE },
  { value: 'day', label: 'Recently active (24 h)', ms: DAY },
  { value: 'week', label: 'Active this week', ms: 7 * DAY },
]

export function isActivityWindow(value: string | null): value is ActivityWindow {
  return ACTIVITY_WINDOWS.some((window) => window.value === value)
}

/**
 * The instant to send as `active_since`, or `undefined` for "any activity".
 *
 * `now` is passed in rather than read here so a component decides once per
 * query when the window starts: recomputing it on every render would change the
 * request on every render, which is a fetch loop.
 */
export function activeSince(window: ActivityWindow, now: number): string | undefined {
  const match = ACTIVITY_WINDOWS.find((option) => option.value === window)
  if (match?.ms == null) return undefined
  return new Date(now - match.ms).toISOString()
}

export const STATUS_LABEL: Record<LearningStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
}

export function isLearningStatus(value: string | null): value is LearningStatus {
  return value === 'NOT_STARTED' || value === 'IN_PROGRESS' || value === 'COMPLETED'
}

/** The board's sort menu, in its order. */
export const SORT_OPTIONS: readonly { value: LearningProgressSort; label: string }[] = [
  { value: '-last_activity', label: 'Last activity (newest)' },
  { value: '-progress', label: 'Progress (high to low)' },
  { value: 'progress', label: 'Progress (low to high)' },
  { value: '-completed', label: 'Completion date (newest)' },
  { value: '-started', label: 'Started date (newest)' },
  { value: 'member', label: 'Member name (A–Z)' },
]

export function isProgressSort(value: string | null): value is LearningProgressSort {
  return SORT_OPTIONS.some((option) => option.value === value)
}

/** `first_name last_name`, the only name the backend stores. */
export function memberName(member: { first_name: string; last_name: string }): string {
  return `${member.first_name} ${member.last_name}`.trim()
}

/**
 * `67%`, as every board writes a percentage.
 *
 * The backend's value keeps two decimals and stays the source of truth - it is
 * what the bar is drawn from; only the text is rounded, and only here.
 */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

/** `12 / 16`, the lessons cell. */
export function formatLessons(done: number, total: number): string {
  return `${done} / ${total}`
}

/**
 * "2 min ago", "Yesterday", "11 days ago", "10 Sep 2026" (DS-11).
 *
 * `null` has its own words on every screen, so it is not formatted here: a
 * member with no recorded activity has no date to soften into a phrase.
 */
export function relativeTime(iso: string, now: number): string {
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return '—'

  const elapsed = now - at
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `${minutes} min ago`
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }

  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'Yesterday'
  // Past a fortnight a relative phrase stops being useful, and the board shows
  // the date itself.
  if (days < 14) return `${days} days ago`
  return formatDate(iso)
}

/**
 * Whether an event that recent counts as "active now".
 *
 * The same 5-minute window the request asks the backend for, applied to the row
 * that came back, so the badge and the filter can never disagree.
 */
export function isActiveNow(iso: string | null, now: number): boolean {
  if (iso === null) return false
  const at = new Date(iso).getTime()
  return !Number.isNaN(at) && now - at <= ACTIVE_NOW_MINUTES * MINUTE
}

/** `21 Sep 2026, 09:40` - the exact instant, for a tooltip or a caption. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${formatDate(iso)}, ${hours}:${minutes}`
}

/** A date cell: the board's em dash when the backend sent no date. */
export function formatOptionalDate(iso: string | null): string {
  return iso === null ? '—' : formatDate(iso)
}

const EVENT_LABEL: Record<string, string> = {
  course_opened: 'Opened course',
  module_opened: 'Opened module',
  lesson_opened: 'Opened lesson',
  lesson_completed: 'Completed lesson',
}

/**
 * "Opened lesson · Conditional formulas" (Admin-Member-View).
 *
 * A lesson event names its lesson, a module event its module, and a course
 * event its course - whichever the recorded event actually carries.
 */
export function describeEvent(event: {
  type: string
  course_title: string
  module_title: string | null
  lesson_title: string | null
}): string {
  const label = EVENT_LABEL[event.type] ?? event.type
  const subject = event.lesson_title ?? event.module_title ?? event.course_title
  return `${label} · ${subject}`
}

/** 1-based page from the URL, as `Pagination` bounds it. */
export function parsePage(raw: string | null): number {
  const page = Number(raw)
  return Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1
}
