import type {
  CourseLearningSummary,
  LearningActivityPageData,
  LearningActivityRow,
  LearningCounts,
  LearningEventEntry,
  LearningProgressPageData,
  LearningProgressRow,
  LearningStatus,
  MemberLearningDetail,
} from '../features/admin/learning'

/**
 * Fixtures for the tracking screens, copied from `app.schemas.tracking`.
 *
 * Two members and two published courses, which is the smallest shape that can
 * show isolation: every screen test can check that one member's figures never
 * appear on the other's row. No field here is invented - a field absent from a
 * fixture is absent from the response, which is what makes these useful.
 */

export const SARRA = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Sarra',
  last_name: 'Mansour',
  email: 'sarra.mansour@example.org',
  is_active: true,
}

export const YASSINE = {
  id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Yassine',
  last_name: 'Ben Ammar',
  email: 'yassine@example.org',
  is_active: false,
}

export const PYTHON = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Python Fundamentals',
  slug: 'python-fundamentals',
}

export const EXCEL = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Excel for Engineers',
  slug: 'excel-for-engineers',
}

/** `GET /admin/courses?status=PUBLISHED` - the matrix columns. */
export function publishedCoursesPage(courses = [PYTHON, EXCEL]) {
  return {
    items: courses.map((course) => ({
      id: course.id,
      title: course.title,
      slug: course.slug,
      description: 'A course.',
      thumbnail_url: null,
      status: 'PUBLISHED',
      published_at: '2026-09-01T08:00:00Z',
      created_by: SARRA.id,
      created_at: '2026-08-01T08:00:00Z',
      updated_at: '2026-09-01T08:00:00Z',
      archived_at: null,
      module_count: 3,
      lesson_count: 11,
    })),
    total: courses.length,
    page: 1,
    page_size: 100,
  }
}

/** Minutes before now, as an ISO instant - for "2 min ago" and "Active now". */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export function counts(overrides: Partial<LearningCounts> = {}): LearningCounts {
  return { all: 4, not_started: 1, in_progress: 2, completed: 1, started: 3, ...overrides }
}

export function progressRow(
  member: typeof SARRA,
  course: typeof PYTHON,
  overrides: Partial<LearningProgressRow> = {},
): LearningProgressRow {
  const status: LearningStatus = overrides.status ?? 'IN_PROGRESS'
  return {
    member,
    course,
    status,
    progress_percent: 45.45,
    completed_video_lessons: 5,
    total_video_lessons: 11,
    completed_modules: 1,
    total_modules: 3,
    started_at: '2026-09-08T08:00:00Z',
    last_activity_at: minutesAgo(2),
    completed_at: null,
    ...overrides,
  }
}

/** A pair the member never opened: no figure and no date at all. */
export function notStartedRow(
  member: typeof SARRA,
  course: typeof PYTHON,
): LearningProgressRow {
  return progressRow(member, course, {
    status: 'NOT_STARTED',
    progress_percent: 0,
    completed_video_lessons: 0,
    completed_modules: 0,
    started_at: null,
    last_activity_at: null,
    completed_at: null,
  })
}

export function progressPage(
  items: LearningProgressRow[],
  overrides: Partial<LearningProgressPageData> = {},
): LearningProgressPageData {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
    counts: counts({ all: items.length }),
    ...overrides,
  }
}

export function activityRow(
  member: typeof SARRA,
  overrides: Partial<LearningActivityRow> = {},
): LearningActivityRow {
  return {
    member,
    last_activity_at: minutesAgo(2),
    course: EXCEL,
    lesson: {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Conditional formulas',
      module_id: '66666666-6666-4666-8666-666666666666',
      module_title: 'Formulas',
      module_position: 4,
    },
    status: 'IN_PROGRESS',
    progress_percent: 75,
    completed_video_lessons: 12,
    total_video_lessons: 16,
    ...overrides,
  }
}

/** A member the tracking has never heard from. */
export function silentRow(member: typeof SARRA): LearningActivityRow {
  return activityRow(member, {
    last_activity_at: null,
    course: null,
    lesson: null,
    status: null,
    progress_percent: null,
    completed_video_lessons: null,
    total_video_lessons: null,
  })
}

export function activityPage(
  items: LearningActivityRow[],
  overrides: Partial<LearningActivityPageData> = {},
): LearningActivityPageData {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
    members_with_activity: items.filter((row) => row.last_activity_at !== null).length,
    active_members: null,
    ...overrides,
  }
}

export function learningEvent(overrides: Partial<LearningEventEntry> = {}): LearningEventEntry {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    type: 'lesson_opened',
    occurred_at: minutesAgo(2),
    course_id: EXCEL.id,
    course_title: EXCEL.title,
    module_id: '66666666-6666-4666-8666-666666666666',
    module_title: 'Formulas',
    lesson_id: '55555555-5555-4555-8555-555555555555',
    lesson_title: 'Conditional formulas',
    ...overrides,
  }
}

export function memberLearning(
  overrides: Partial<MemberLearningDetail> = {},
): MemberLearningDetail {
  return {
    member: SARRA,
    counts: counts({ all: 2, not_started: 1, in_progress: 1, completed: 0, started: 1 }),
    last_activity_at: minutesAgo(2),
    latest: activityRow(SARRA),
    courses: [
      progressRow(SARRA, EXCEL, {
        progress_percent: 75,
        completed_video_lessons: 12,
        total_video_lessons: 16,
        completed_modules: 3,
        total_modules: 5,
      }),
      notStartedRow(SARRA, PYTHON),
    ],
    recent_events: [learningEvent()],
    ...overrides,
  }
}

export function courseSummary(
  overrides: Partial<CourseLearningSummary> = {},
): CourseLearningSummary {
  return {
    course: PYTHON,
    total_modules: 3,
    total_video_lessons: 11,
    counts: counts({ all: 48, not_started: 17, in_progress: 19, completed: 12, started: 31 }),
    average_progress_percent: 58.06,
    completion_rate_percent: 38.71,
    ...overrides,
  }
}
