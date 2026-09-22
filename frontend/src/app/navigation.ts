import type { IconName } from '../design-system'

import { routes } from './routes'

export interface NavItem {
  to: string
  label: string
  icon: IconName
  /** Match this path exactly; for parents of other routes, such as `/admin`. */
  end?: boolean
}

/**
 * The navigation, declared once.
 *
 * The desktop header, the mobile bottom bar, the admin sidebar, the icon rail
 * and the mobile drawer all render from these two lists, so a route cannot be
 * present in one surface and missing from another, and there is no second place
 * where "which links does this role get?" is decided.
 *
 * Which list a surface receives is settled by the route tree, not by these
 * arrays: `adminNav` is only ever rendered inside `RequireAdmin`.
 */

/** DS 07 header: "Dashboard | Courses". */
export const memberNav: readonly NavItem[] = [
  { to: routes.dashboard, label: 'Dashboard', icon: 'home' },
  { to: routes.courses, label: 'Courses', icon: 'book' },
]

/** DS 07 sidebar, under the "ADMINISTRATION" overline. */
export const adminNav: readonly NavItem[] = [
  // `/admin` is the parent of every other admin route, so it must match exactly
  // or it would stay highlighted on /admin/members.
  { to: routes.admin, label: 'Dashboard', icon: 'home', end: true },
  { to: routes.adminMembers, label: 'Members', icon: 'users' },
  { to: routes.adminCourses, label: 'Courses', icon: 'book' },
  // DS 07 sidebar on the tracking boards, under Courses.
  { to: routes.adminLearning, label: 'Learning progress', icon: 'trending-up' },
]
