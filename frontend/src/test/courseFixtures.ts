import type {
  CatalogCourse,
  CatalogCourseListItem,
  CatalogEnrollmentCounts,
  CatalogPage,
  CatalogLesson,
  CatalogModule,
  CourseContent,
  EnrollmentSummary,
  Page,
} from '../api'

/**
 * Fixtures copied from the real backend shapes.
 *
 * Each block names the endpoint and the Pydantic model it mirrors. No field
 * here is invented: if it is absent from the fixture, it is absent from the
 * response, which is precisely what makes these useful.
 */

export function page<Item>(items: Item[]): Page<Item> {
  return { items, total: items.length, page: 1, page_size: 100 }
}

/** `GET /me/enrollments` -> `Page[EnrollmentSummary]` */
export const enrollmentInProgress: EnrollmentSummary = {
  enrollment_id: '2a1b0c9d-8e7f-4a6b-9c5d-1e2f3a4b5c6d',
  course_id: 'c0ffee00-1111-4222-8333-444444444444',
  title: 'Python Fundamentals',
  slug: 'python-fundamentals',
  thumbnail_url: 'https://cdn.example.org/python.jpg',
  enrolled_at: '2026-09-10T08:00:00Z',
  completed_at: null,
  progress_percent: 45.45,
  completed: false,
  // BE-COURSE-CATALOG-01: the figures behind the percentage (5 / 11 = 45.45).
  module_count: 3,
  total_video_lessons: 11,
  completed_video_lessons: 5,
}

export const enrollmentCompleted: EnrollmentSummary = {
  enrollment_id: '3b2c1d0e-9f8a-4b7c-8d6e-2f3a4b5c6d7e',
  course_id: 'dec0de00-2222-4333-8444-555555555555',
  title: 'Project Management Essentials',
  slug: 'project-management-essentials',
  thumbnail_url: null,
  enrolled_at: '2026-07-01T08:00:00Z',
  completed_at: '2026-08-20T17:30:00Z',
  progress_percent: 100,
  completed: true,
  module_count: 4,
  total_video_lessons: 14,
  completed_video_lessons: 14,
}

/** A second unfinished course, enrolled more recently than the first. */
export const enrollmentNewer: EnrollmentSummary = {
  enrollment_id: '4c3d2e1f-0a9b-4c8d-9e7f-3a4b5c6d7e8f',
  course_id: 'facade00-3333-4444-8555-666666666666',
  title: 'Excel for Engineers',
  slug: 'excel-for-engineers',
  thumbnail_url: null,
  enrolled_at: '2026-09-18T08:00:00Z',
  completed_at: null,
  progress_percent: 11,
  completed: false,
  module_count: 5,
  total_video_lessons: 18,
  completed_video_lessons: 2,
}

/** `GET /courses` -> `Page[CatalogCourse]` (PUBLISHED only) */
export const catalogEnrolled: CatalogCourse = {
  id: enrollmentInProgress.course_id,
  title: 'Python Fundamentals',
  slug: 'python-fundamentals',
  description: 'Learn the core building blocks of Python: variables, functions and classes.',
  thumbnail_url: 'https://cdn.example.org/python.jpg',
  status: 'PUBLISHED',
  published_at: '2026-06-18T09:00:00Z',
}

export const catalogAvailable: CatalogCourse = {
  id: 'ba5eba11-4444-4555-8666-777777777777',
  title: 'Professional Communication',
  slug: 'professional-communication',
  description: 'Write clear messages, run efficient meetings and present your ideas.',
  thumbnail_url: null,
  status: 'PUBLISHED',
  published_at: '2026-07-25T09:00:00Z',
}

/** `GET /courses/{id}/content` -> `CourseContent` */
export const courseContent: CourseContent = {
  course_id: enrollmentInProgress.course_id,
  title: 'Python Fundamentals',
  slug: 'python-fundamentals',
  description: 'Learn the core building blocks of Python: variables, functions and classes.',
  thumbnail_url: 'https://cdn.example.org/python.jpg',
  status: 'PUBLISHED',
  published_at: '2026-06-18T09:00:00Z',
  total_video_lessons: 11,
  completed_video_lessons: 5,
  progress_percent: 45.45,
  completed: false,
  modules: [
    {
      id: 'm1000000-0000-4000-8000-000000000001',
      title: 'Getting started',
      description: null,
      position: 1,
      lessons: [
        {
          id: 'l1000000-0000-4000-8000-000000000001',
          title: 'Introduction',
          description: null,
          content_type: 'VIDEO',
          duration_seconds: 384,
          position: 1,
          is_preview: false,
          has_resource: true,
          watched_seconds: 384,
          completed: true,
          completed_at: '2026-09-11T09:00:00Z',
        },
        {
          id: 'l1000000-0000-4000-8000-000000000002',
          title: 'Python cheat sheet',
          description: null,
          // A non-video lesson: its three progress fields are null, and it must
          // never be offered as the lesson to continue with.
          content_type: 'DOCUMENT',
          duration_seconds: null,
          position: 2,
          is_preview: false,
          has_resource: true,
          watched_seconds: null,
          completed: null,
          completed_at: null,
        },
      ],
    },
    {
      id: 'm1000000-0000-4000-8000-000000000002',
      title: 'Functions and structure',
      description: null,
      position: 2,
      lessons: [
        {
          id: 'l2000000-0000-4000-8000-000000000001',
          title: 'Parameters and return values',
          description: null,
          content_type: 'VIDEO',
          duration_seconds: 690,
          position: 1,
          is_preview: false,
          has_resource: true,
          watched_seconds: 252,
          completed: false,
          completed_at: null,
        },
      ],
    },
  ],
}

/**
 * `GET /courses` rows since BE-COURSE-CATALOG-01: the course plus the
 * backend's own `module_count` and `total_video_lessons`. The figures match the
 * enrollment fixtures of the same course.
 */
export const catalogEnrolledRow: CatalogCourseListItem = {
  ...catalogEnrolled,
  module_count: 3,
  total_video_lessons: 11,
}

export const catalogAvailableRow: CatalogCourseListItem = {
  ...catalogAvailable,
  module_count: 1,
  total_video_lessons: 1,
}

/** A published course with no module yet: the backend counts it 0 and 0. */
export const catalogEmptyRow: CatalogCourseListItem = {
  ...catalogAvailable,
  id: 'e0e0e0e0-5555-4666-8777-888888888888',
  title: 'Coming Soon',
  slug: 'coming-soon',
  description: 'Modules are being written.',
  module_count: 0,
  total_video_lessons: 0,
}

/** A catalogue page with its tab counts, exactly as `GET /courses` answers. */
export function catalogListPage(
  items: CatalogCourseListItem[],
  counts: CatalogEnrollmentCounts,
  { total = items.length, page = 1, pageSize = 20 }: { total?: number; page?: number; pageSize?: number } = {},
): CatalogPage {
  return { items, total, page, page_size: pageSize, enrollment_counts: counts }
}

/**
 * A catalogue page of `count` published courses, for paging tests.
 *
 * `total` is the backend's count across every page, which is what the pager and
 * the result line are built from.
 */
export function catalogPage(
  count: number,
  { total = count, page = 1, pageSize = 20 }: { total?: number; page?: number; pageSize?: number } = {},
): Page<CatalogCourse> {
  const items = Array.from({ length: count }, (_, index) => ({
    ...catalogAvailable,
    id: `aaaaaaaa-0000-4000-8000-${String(index + (page - 1) * pageSize).padStart(12, '0')}`,
    title: `Course ${index + 1 + (page - 1) * pageSize}`,
    slug: `course-${index + 1 + (page - 1) * pageSize}`,
    description: `Description of course ${index + 1 + (page - 1) * pageSize}.`,
  }))

  return { items, total, page, page_size: pageSize }
}

/**
 * `GET /courses/{id}/modules` -> `Page[CatalogModule]`, and
 * `GET /modules/{id}/lessons` -> `Page[CatalogLesson]`.
 *
 * The outline a member who is NOT enrolled is allowed to read. It describes the
 * same course as `courseContent`, with the fields those two projections drop:
 * no `has_resource`, no `watched_seconds`, no `completed`, no `completed_at` -
 * the backend reports no progress at all before enrollment.
 */
export const catalogModules: CatalogModule[] = courseContent.modules.map((module) => ({
  id: module.id,
  title: module.title,
  description: module.description,
  position: module.position,
}))

export const catalogLessonsByModule: Record<string, CatalogLesson[]> = Object.fromEntries(
  courseContent.modules.map((module) => [
    module.id,
    module.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      content_type: lesson.content_type,
      duration_seconds: lesson.duration_seconds,
      position: lesson.position,
      is_preview: lesson.is_preview,
    })),
  ]),
)

/**
 * A course tree carrying all four lesson kinds, for the learning page.
 *
 * Kept apart from `courseContent` so the dashboard and course-details
 * expectations built on that one stay stable. Shapes are identical: this is the
 * same `CourseContent` model, with `positions` deliberately out of array order
 * so the ordering strategy is actually exercised rather than assumed.
 */
export const learningContent: CourseContent = {
  course_id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  title: 'Python Fundamentals',
  slug: 'python-fundamentals',
  description: 'Learn the core building blocks of Python.',
  thumbnail_url: null,
  status: 'PUBLISHED',
  published_at: '2026-06-18T09:00:00Z',
  total_video_lessons: 2,
  completed_video_lessons: 1,
  progress_percent: 50,
  completed: false,
  modules: [
    // Position 2 listed first: the page must order by `position`, not by index.
    {
      id: 'mod-0000-0000-4000-8000-000000000002',
      title: 'Functions and structure',
      description: null,
      position: 2,
      lessons: [
        {
          id: 'les-0000-0000-4000-8000-000000000004',
          title: 'Further reading',
          description: 'External resource selected by the association.',
          content_type: 'LINK',
          duration_seconds: null,
          position: 2,
          is_preview: false,
          has_resource: false,
          watched_seconds: null,
          completed: null,
          completed_at: null,
        },
        {
          id: 'les-0000-0000-4000-8000-000000000003',
          title: 'Practice exercises',
          description: 'Three short exercises to check what you learned.',
          content_type: 'TEXT',
          duration_seconds: null,
          position: 1,
          is_preview: false,
          has_resource: false,
          watched_seconds: null,
          completed: null,
          completed_at: null,
        },
      ],
    },
    {
      id: 'mod-0000-0000-4000-8000-000000000001',
      title: 'Getting started',
      description: null,
      position: 1,
      lessons: [
        {
          id: 'les-0000-0000-4000-8000-000000000001',
          title: 'Introduction',
          description: 'How the course is organised.',
          content_type: 'VIDEO',
          duration_seconds: 384,
          position: 1,
          is_preview: false,
          has_resource: true,
          watched_seconds: 384,
          completed: true,
          completed_at: '2026-09-11T09:00:00Z',
        },
        {
          id: 'les-0000-0000-4000-8000-000000000002',
          title: 'Python cheat sheet',
          description: 'A one-page summary of the syntax covered in Module 1.',
          content_type: 'DOCUMENT',
          duration_seconds: null,
          position: 2,
          is_preview: false,
          has_resource: true,
          watched_seconds: null,
          completed: null,
          completed_at: null,
        },
      ],
    },
  ],
}

/** The order `byPosition` produces for `learningContent`. */
export const learningLessonIds = {
  introduction: 'les-0000-0000-4000-8000-000000000001',
  document: 'les-0000-0000-4000-8000-000000000002',
  text: 'les-0000-0000-4000-8000-000000000003',
  link: 'les-0000-0000-4000-8000-000000000004',
} as const

/**
 * `GET /lessons/{id}` -> `CatalogLessonContent`.
 *
 * `content` is the real payload for TEXT and LINK, and **null** for VIDEO and
 * DOCUMENT: `LessonService.catalog_get` blanks it for the two stored kinds.
 */
export const textLessonDetail = {
  id: learningLessonIds.text,
  title: 'Practice exercises',
  description: 'Three short exercises to check what you learned.',
  content_type: 'TEXT' as const,
  duration_seconds: null,
  position: 1,
  is_preview: false,
  content: 'Before you start\n\nThese exercises use only what you have seen so far.',
}

export const linkLessonDetail = {
  id: learningLessonIds.link,
  title: 'Further reading',
  description: 'External resource selected by the association.',
  content_type: 'LINK' as const,
  duration_seconds: null,
  position: 2,
  is_preview: false,
  content: 'https://docs.python.org/3/tutorial/',
}

/**
 * `GET /lessons/{id}/resource` -> `MemberResourceResponse`.
 *
 * `download_url` is API-relative and already carries the backend's short-lived
 * `playback_token`, exactly as `LessonResourceService.member_resource` builds
 * it for a VIDEO lesson. No provider URL, storage key or credential appears.
 */
export const videoResource = {
  lesson_id: learningLessonIds.introduction,
  resource_id: 'res-0000-0000-4000-8000-000000000001',
  content_type: 'VIDEO' as const,
  filename: 'demo.mp4',
  mime_type: 'video/mp4',
  size_bytes: 128000000,
  duration_seconds: 384,
  download_url: `/api/v1/lessons/${learningLessonIds.introduction}/resource/content?playback_token=pbk-test-token`,
}

/**
 * `GET /lessons/{id}/resource` -> `MemberResourceResponse` for a DOCUMENT.
 *
 * The difference that matters: `download_url` carries **no** token.
 * `LessonResourceService.member_resource` appends a `playback_token` for VIDEO
 * only, and `content()` rejects a playback token for any other kind, so these
 * bytes can be reached only by a request that sends the Authorization header.
 */
export const documentResource = {
  lesson_id: learningLessonIds.document,
  resource_id: 'res-0000-0000-4000-8000-000000000002',
  content_type: 'DOCUMENT' as const,
  filename: 'python-cheat-sheet.pdf',
  mime_type: 'application/pdf',
  size_bytes: 248_120,
  duration_seconds: null,
  download_url: `/api/v1/lessons/${learningLessonIds.document}/resource/content`,
}

/**
 * The bytes such a response streams: a real PDF signature and some filler.
 *
 * `validate_signature` rejects an upload whose leading bytes contradict
 * `application/pdf`, so anything the backend can actually serve starts here.
 */
export const pdfBytes = new TextEncoder().encode(`%PDF-1.7
${'0'.repeat(256)}
%%EOF
`)

/** A DOCUMENT resource whose media type the browser cannot render inline. */
export const unsupportedDocumentResource = {
  ...documentResource,
  filename: 'module-1-notes.docx',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/**
 * `PUT /lessons/{id}/progress` -> `ProgressResponse`.
 *
 * The server's own answer: `watched_seconds` clamped to the duration, and
 * `completed` / `completed_at` which only it can set.
 */
export function progressResponse({
  lessonId = learningLessonIds.introduction,
  watchedSeconds = 0,
  completed = false,
  durationSeconds = 384,
}: {
  lessonId?: string
  watchedSeconds?: number
  completed?: boolean
  durationSeconds?: number | null
} = {}) {
  return {
    lesson_id: lessonId,
    watched_seconds: watchedSeconds,
    duration_seconds: durationSeconds,
    completed,
    completed_at: completed ? '2026-09-20T10:00:00Z' : null,
  }
}

/** `GET /courses/{id}/progress` -> `CourseProgressResponse`. */
export function courseProgressResponse({
  completedVideoLessons = 1,
  totalVideoLessons = 2,
}: { completedVideoLessons?: number; totalVideoLessons?: number } = {}) {
  const percent = totalVideoLessons
    ? Math.round((completedVideoLessons * 10000) / totalVideoLessons) / 100
    : 0
  return {
    course_id: learningContent.course_id,
    total_video_lessons: totalVideoLessons,
    completed_video_lessons: completedVideoLessons,
    progress_percent: percent,
    completed: totalVideoLessons > 0 && completedVideoLessons === totalVideoLessons,
  }
}

/**
 * `GET /admin/members` -> `Page[MemberResponse]`.
 *
 * `MemberResponse` is `UserResponse`: id, email, first_name, last_name,
 * is_active, role, created_at, updated_at - and nothing else. The password
 * hash, the activation token hash and its expiry are columns on the row that
 * appear on no response, which is why they are absent here too.
 */
export const adminMembers = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'sarra.mansour@example.org',
    first_name: 'Sarra',
    last_name: 'Mansour',
    is_active: true,
    role: 'MEMBER' as const,
    created_at: '2026-09-12T08:00:00Z',
    updated_at: '2026-09-12T08:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'mehdi.trabelsi@example.org',
    first_name: 'Mehdi',
    last_name: 'Trabelsi',
    is_active: true,
    role: 'MEMBER' as const,
    created_at: '2026-09-09T08:00:00Z',
    updated_at: '2026-09-09T08:00:00Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'yassine.benammar@example.org',
    first_name: 'Yassine',
    last_name: 'Ben Ammar',
    is_active: false,
    role: 'MEMBER' as const,
    created_at: '2026-08-28T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
  },
]

/** One page of members, shaped exactly as `Page[MemberResponse]`. */
export function membersPage(
  items = adminMembers,
  { total = items.length, page = 1, pageSize = 20 } = {},
) {
  return { items, total, page, page_size: pageSize }
}

/**
 * `GET /admin/courses` -> `Page[CourseResponse]`.
 *
 * `CatalogCourse` plus `created_by`, `created_at`, `updated_at` and
 * `archived_at`. There is no module or lesson count on this shape, which is
 * why the admin table has no such column.
 */
const ADMIN_BY = '99999999-9999-4999-8999-999999999999'

export const adminCourses = [
  {
    id: 'aaa11111-1111-4111-8111-111111111111',
    title: 'Advanced Excel Dashboards',
    slug: 'advanced-excel-dashboards',
    description: 'Build dashboards that answer a question at a glance.',
    thumbnail_url: null,
    status: 'DRAFT' as const,
    published_at: null,
    created_by: ADMIN_BY,
    created_at: '2026-09-17T08:00:00Z',
    updated_at: '2026-09-17T08:00:00Z',
    archived_at: null,
  },
  {
    id: 'bbb22222-2222-4222-8222-222222222222',
    title: 'Introduction to Data Analysis',
    slug: 'introduction-to-data-analysis',
    description: 'From a raw table to a defensible conclusion.',
    thumbnail_url: 'https://cdn.example.org/data.jpg',
    status: 'PUBLISHED' as const,
    published_at: '2026-09-02T09:00:00Z',
    created_by: ADMIN_BY,
    created_at: '2026-09-02T08:00:00Z',
    updated_at: '2026-09-15T08:00:00Z',
    archived_at: null,
  },
  {
    id: 'ccc33333-3333-4333-8333-333333333333',
    title: 'Networking Basics (2025 edition)',
    slug: 'networking-basics-2025-edition',
    description: 'Superseded by the 2026 edition.',
    thumbnail_url: null,
    status: 'ARCHIVED' as const,
    published_at: '2025-11-12T09:00:00Z',
    created_by: ADMIN_BY,
    created_at: '2025-11-12T08:00:00Z',
    updated_at: '2026-06-14T08:00:00Z',
    archived_at: '2026-06-14T08:00:00Z',
  },
]

/** One page of courses, shaped exactly as `Page[CourseResponse]`. */
export function adminCoursesPage(
  items = adminCourses,
  { total = items.length, page = 1, pageSize = 20 } = {},
) {
  return { items, total, page, page_size: pageSize }
}

/**
 * `GET /admin/courses/{id}/modules` -> `Page[ModuleResponse]` and
 * `GET /admin/modules/{id}/lessons` -> `Page[LessonResponse]`.
 *
 * `LessonResponse` carries `content` - always, unlike the member projection -
 * which for VIDEO and DOCUMENT is the stored reference. The placeholder values
 * below are the codebase's own convention for a lesson whose file has not been
 * uploaded yet.
 */
const FE12_COURSE = 'aaa11111-1111-4111-8111-111111111111'

export const adminModules = [
  {
    id: 'mmm11111-1111-4111-8111-111111111111',
    title: 'Getting started',
    description: 'The basics, in order.',
    position: 1,
    course_id: FE12_COURSE,
    created_at: '2026-09-17T08:00:00Z',
    updated_at: '2026-09-17T08:00:00Z',
  },
  {
    id: 'mmm22222-2222-4222-8222-222222222222',
    title: 'Going further',
    description: null,
    position: 2,
    course_id: FE12_COURSE,
    created_at: '2026-09-17T09:00:00Z',
    updated_at: '2026-09-17T09:00:00Z',
  },
]

export const adminLessons = [
  {
    id: 'lll11111-1111-4111-8111-111111111111',
    title: 'Welcome',
    description: 'How the course is organised.',
    content_type: 'VIDEO' as const,
    content: 'storage://videos/pending',
    duration_seconds: 120,
    position: 1,
    is_preview: true,
    module_id: adminModules[0]!.id,
    created_at: '2026-09-17T08:10:00Z',
    updated_at: '2026-09-17T08:10:00Z',
  },
  {
    id: 'lll22222-2222-4222-8222-222222222222',
    title: 'Cheat sheet',
    description: null,
    content_type: 'DOCUMENT' as const,
    content: 'storage://documents/pending',
    duration_seconds: null,
    position: 2,
    is_preview: false,
    module_id: adminModules[0]!.id,
    created_at: '2026-09-17T08:20:00Z',
    updated_at: '2026-09-17T08:20:00Z',
  },
  {
    id: 'lll33333-3333-4333-8333-333333333333',
    title: 'Practice notes',
    description: null,
    content_type: 'TEXT' as const,
    content: 'Read this before the exercises.',
    duration_seconds: null,
    position: 1,
    is_preview: false,
    module_id: adminModules[1]!.id,
    created_at: '2026-09-17T09:10:00Z',
    updated_at: '2026-09-17T09:10:00Z',
  },
]

/** One page, shaped exactly as the backend's `Page[T]`. */
export function structurePage<Item>(items: Item[]) {
  return { items, total: items.length, page: 1, page_size: 100 }
}

export const lessonsByModule: Record<string, typeof adminLessons> = {
  [adminModules[0]!.id]: adminLessons.filter((l) => l.module_id === adminModules[0]!.id),
  [adminModules[1]!.id]: adminLessons.filter((l) => l.module_id === adminModules[1]!.id),
}

/**
 * `app.schemas.resource.ResourceResponse`, field for field.
 *
 * `provider_reference` is absent because the backend's schema omits it, and
 * `storage_key` is present because the backend sends it - the frontend reads
 * it only to prove, in the security tests, that it is never rendered.
 */
export const adminVideoResource = {
  resource_id: 'rrr11111-1111-4111-8111-111111111111',
  lesson_id: adminLessons[0]!.id,
  storage_provider: 'memory',
  storage_key: `courses/${FE12_COURSE}/videos/9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f.mp4`,
  filename: 'welcome.mp4',
  mime_type: 'video/mp4',
  size_bytes: 24_117_248,
  checksum: 'f6b1c9a2',
  duration_seconds: 100,
  created_at: '2026-09-18T10:00:00Z',
  updated_at: '2026-09-18T10:00:00Z',
}

export const documentResourceAdmin = {
  resource_id: 'rrr22222-2222-4222-8222-222222222222',
  lesson_id: adminLessons[1]!.id,
  storage_provider: 'memory',
  storage_key: `courses/${FE12_COURSE}/documents/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.pdf`,
  filename: 'cheat-sheet.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2_516_582,
  checksum: 'ab12cd34',
  duration_seconds: null,
  created_at: '2026-09-18T11:30:00Z',
  updated_at: '2026-09-18T11:30:00Z',
}
