import type { UserRole } from '../features/auth'

/**
 * Every path the application knows, in one place.
 *
 * Nothing builds a URL by string concatenation at a call site: a rename here is
 * a compile error everywhere it matters, and the navigation configuration and
 * the router read from the same source.
 *
 * The set is exactly the one FE-00 derived from the "Data needs & routing"
 * board - no speculative routes.
 */
export const routes = {
  // The public landing page (Data-Needs "Routing proposal": "/ - Landing (public)").
  home: '/',
  login: '/login',

  dashboard: '/dashboard',
  courses: '/courses',
  course: (courseId: string) => `/courses/${courseId}`,
  lesson: (courseId: string, lessonId: string) => `/courses/${courseId}/lessons/${lessonId}`,
  // The signed-in account's own profile (Profile and Profile-Edit boards).
  profile: '/profile',
  profileEdit: '/profile/edit',

  admin: '/admin',
  // The same screens inside the administration shell (Admin-Profile boards).
  adminProfile: '/admin/profile',
  adminProfileEdit: '/admin/profile/edit',
  adminMembers: '/admin/members',
  adminMember: (memberId: string) => `/admin/members/${memberId}`,
  // The member's learning tab (Admin-Member-View), beside their profile.
  adminMemberLearning: (memberId: string) => `/admin/members/${memberId}/learning`,
  // Data-Needs: "/admin/members/:memberId/edit - Edit member profile".
  adminMemberEdit: (memberId: string) => `/admin/members/${memberId}/edit`,
  // Learning progress (FE-LEARNING-TRACKING-02): the three tabs of the
  // tracking boards, and the course a row opens.
  adminLearning: '/admin/learning',
  adminLearningActivity: '/admin/learning/activity',
  adminLearningCourses: '/admin/learning/courses',
  adminLearningCourse: (courseId: string) => `/admin/learning/courses/${courseId}`,
  adminCourses: '/admin/courses',
  adminCourseNew: '/admin/courses/new',
  adminCourse: (courseId: string) => `/admin/courses/${courseId}`,
  adminCourseEdit: (courseId: string) => `/admin/courses/${courseId}/edit`,
  adminModuleNew: (courseId: string) => `/admin/courses/${courseId}/modules/new`,
  adminModuleEdit: (courseId: string, moduleId: string) =>
    `/admin/courses/${courseId}/modules/${moduleId}/edit`,
  adminLessonNew: (courseId: string, moduleId: string) =>
    `/admin/courses/${courseId}/modules/${moduleId}/lessons/new`,
  adminLessonEdit: (courseId: string, lessonId: string) =>
    `/admin/courses/${courseId}/lessons/${lessonId}/edit`,
  adminLesson: (courseId: string, lessonId: string) =>
    `/admin/courses/${courseId}/lessons/${lessonId}`,
} as const

/** Route patterns, as the router declares them. */
export const routePatterns = {
  course: '/courses/:courseId',
  adminMember: '/admin/members/:memberId',
  adminMemberLearning: '/admin/members/:memberId/learning',
  adminLearningCourse: '/admin/learning/courses/:courseId',
  adminMemberEdit: '/admin/members/:memberId/edit',
  lesson: '/courses/:courseId/lessons/:lessonId',
  adminCourse: '/admin/courses/:courseId',
  adminCourseEdit: '/admin/courses/:courseId/edit',
  adminModuleNew: '/admin/courses/:courseId/modules/new',
  adminModuleEdit: '/admin/courses/:courseId/modules/:moduleId/edit',
  adminLessonNew: '/admin/courses/:courseId/modules/:moduleId/lessons/new',
  adminLessonEdit: '/admin/courses/:courseId/lessons/:lessonId/edit',
  adminLesson: '/admin/courses/:courseId/lessons/:lessonId',
} as const

/**
 * Where a signed-in account belongs.
 *
 * The Flows board sends an administrator to the admin dashboard on sign-in and
 * a member to their own, which is what this encodes. It is a *landing* rule,
 * not an authorization rule - see `RequireAdmin` for that.
 */
export function landingPathFor(role: UserRole): string {
  return role === 'ADMIN' ? routes.admin : routes.dashboard
}
