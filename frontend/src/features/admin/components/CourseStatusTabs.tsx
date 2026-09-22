import type { CourseStatus } from '../../../api'
import { FilterTabs } from '../../../design-system'
import type { StatusCounts } from '../useAdminCourses'

export interface CourseStatusTabsProps {
  current: CourseStatus | null
  /** `null` while the figures are unknown; the tabs still filter without them. */
  counts: StatusCounts | null
  onChange: (status: CourseStatus | null) => void
}

const TABS: { value: CourseStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ARCHIVED', label: 'Archived' },
]

/**
 * The status filter (Admin-Courses: "All 10 · Published 6 · Draft 3 · Archived 1").
 *
 * The design system's `FilterTabs`, as chips. Each figure is the backend's
 * `Page.total` for that status, so a tab reading zero means the database holds
 * none - not that none is loaded.
 */
export function CourseStatusTabs({ current, counts, onChange }: CourseStatusTabsProps) {
  return (
    <FilterTabs
      label="Filter by status"
      options={TABS.map((tab) => ({
        ...tab,
        count: counts === null ? null : tab.value === null ? counts.all : counts[tab.value],
      }))}
      value={current}
      onChange={onChange}
    />
  )
}
