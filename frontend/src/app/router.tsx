import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'

import {
  AdminCourseDetailPage,
  AdminCoursesPage,
  AdminDashboardPage,
  CourseCreatePage,
  CourseEditPage,
  CourseLearningPage,
  LearningActivityPage,
  LearningCoursesPage,
  LearningProgressPage,
  LessonCreatePage,
  LessonEditPage,
  MemberDetailPage,
  MemberEditPage,
  MemberLearningPage,
  MembersPage,
  ModuleRouteRedirect,
} from '../features/admin'
import { CourseDetailsPage, CoursesPage } from '../features/courses'
import { DashboardPage } from '../features/dashboard'
import { LandingPage } from '../features/landing'
import { LearningPage } from '../features/learning'
import { ProfileEditPage, ProfilePage } from '../features/profile'
import { AdminLayout } from '../layouts/AdminLayout'
import { MemberLayout } from '../layouts/MemberLayout'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundCard, NotFoundPage } from '../pages/NotFoundPage'

import { AuthBootstrapGate, RedirectIfAuthenticated, RequireAdmin, RequireAuth } from './guards'
import { routePatterns, routes } from './routes'

/**
 * The route tree.
 *
 * Layered so each concern is decided exactly once, by position rather than by
 * a check repeated inside pages:
 *
 *   AuthBootstrapGate        nothing renders until the session is known
 *   ├── /login               RedirectIfAuthenticated
 *   ├── RequireAuth          everything below needs a session
 *   │   ├── MemberLayout     /dashboard /courses /courses/:id [/lessons/:id] /profile[/edit]
 *   │   └── RequireAdmin     /admin/* -> AdminLayout, or the 403 page
 *   ├── /                    the public landing page
 *   └── *                    404
 *
 * Every screen is real; no route renders a placeholder.
 */
const routeTree: RouteObject[] = [
  {
    element: <AuthBootstrapGate />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [{ path: routes.login, element: <LoginPage /> }],
      },

      {
        element: <RequireAuth />,
        children: [
          {
            element: <MemberLayout />,
            children: [
              { path: routes.dashboard, element: <DashboardPage /> },
              { path: routes.courses, element: <CoursesPage /> },
              { path: routePatterns.course, element: <CourseDetailsPage /> },
              { path: routes.profile, element: <ProfilePage area="member" /> },
              { path: routes.profileEdit, element: <ProfileEditPage area="member" /> },
              {
                path: routePatterns.lesson,
                // DS 07: the bottom bar is hidden on the learning page. G27: below
                // 1024px the course's own header replaces the member header.
                handle: { hideBottomNav: true, courseHeader: true },
                element: <LearningPage />,
              },
            ],
          },

          {
            path: routes.admin,
            element: <RequireAdmin />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: 'profile', element: <ProfilePage area="admin" /> },
                  { path: 'profile/edit', element: <ProfileEditPage area="admin" /> },
                  { path: 'members', element: <MembersPage /> },
                  { path: 'members/:memberId', element: <MemberDetailPage /> },
                  { path: 'members/:memberId/edit', element: <MemberEditPage /> },
                  // The member's learning tab (Admin-Member-View).
                  { path: 'members/:memberId/learning', element: <MemberLearningPage /> },
                  // Learning progress: three tabs and one course page. Static
                  // segments before dynamic ones, as everywhere in this tree.
                  { path: 'learning', element: <LearningProgressPage /> },
                  { path: 'learning/activity', element: <LearningActivityPage /> },
                  { path: 'learning/courses', element: <LearningCoursesPage /> },
                  { path: 'learning/courses/:courseId', element: <CourseLearningPage /> },
                  { path: 'courses', element: <AdminCoursesPage /> },
                  // Static before dynamic, so `new` is never read as an id.
                  { path: 'courses/new', element: <CourseCreatePage /> },
                  { path: 'courses/:courseId', element: <AdminCourseDetailPage /> },
                  { path: 'courses/:courseId/edit', element: <CourseEditPage /> },
                  // Structure: static segments before dynamic ones throughout.
                  // Modules are added and edited in dialogs on the course editor
                  // (Admin-Editor-States); the old form paths land there.
                  { path: 'courses/:courseId/modules/new', element: <ModuleRouteRedirect /> },
                  { path: 'courses/:courseId/modules/:moduleId/edit', element: <ModuleRouteRedirect /> },
                  {
                    path: 'courses/:courseId/modules/:moduleId/lessons/new',
                    element: <LessonCreatePage />,
                  },
                  { path: 'courses/:courseId/lessons/:lessonId/edit', element: <LessonEditPage /> },
                  // Data-Needs maps this path to the lesson editor, which it now
                  // is: the bare path opens the editor, never a stub (G36).
                  {
                    path: 'courses/:courseId/lessons/:lessonId',
                    element: <Navigate to="edit" replace />,
                  },
                  // An unknown admin path answers inside the admin subtree, so
                  // it is guarded like the rest: sign-in first, 403 for a member.
                  { path: '*', element: <NotFoundCard /> },
                ],
              },
            ],
          },
        ],
      },

      // Public, for visitors and signed-in accounts alike: it only switches
      // its call to action ("Sign in" / "Go to my dashboard").
      { path: routes.home, element: <LandingPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routeTree)
}

/** Exported for the tests, which mount the same tree in a memory router. */
export { routeTree }
