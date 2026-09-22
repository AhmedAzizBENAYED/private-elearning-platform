import { useState, type ReactNode } from 'react'
import { Outlet, useMatches } from 'react-router-dom'

import { BottomBarContext } from '../design-system'
import { media, useMediaQuery } from '../shared/useMediaQuery'

import { BrandStrip } from './components/BrandStrip'
import { CourseContextHeader } from './components/CourseContextHeader'
import { MemberBottomNav } from './components/MemberBottomNav'
import { MemberHeader } from './components/MemberHeader'
import { CourseHeaderContext, type CourseHeaderInfo } from './courseHeader'
import styles from './MemberLayout.module.css'

/** Route `handle` metadata a page can set to change the shell. */
export interface RouteHandle {
  /** DS 07: the bottom bar is "hidden on the learning page". */
  hideBottomNav?: boolean
  /**
   * G27: below 1024px the route shows the course's contextual header in place
   * of the member header (Learning-Mobile, Learning-Tablet). The page fills it
   * through `usePublishCourseHeader`; the route's `:courseId` gives it its way
   * back even before the course has loaded.
   */
  courseHeader?: boolean
}

export interface MemberLayoutProps {
  /**
   * Rendered instead of the routed outlet. Used by the shell-level pages (403,
   * 404) so someone who lands on one keeps their navigation.
   */
  children?: ReactNode
}

export function MemberLayout({ children }: MemberLayoutProps) {
  const matches = useMatches()
  const isPhone = useMediaQuery(media.belowSm)
  const isLaptop = useMediaQuery(media.mdAndUp)
  const handleSays = (key: keyof RouteHandle) =>
    matches.some((match) => (match.handle as RouteHandle | undefined)?.[key] === true)
  const hiddenByRoute = handleSays('hideBottomNav')
  // The deepest match carries every parameter of the URL.
  const courseId = matches.at(-1)?.params.courseId
  const contextual = !isLaptop && handleSays('courseHeader') && courseId !== undefined
  const [courseInfo, setCourseInfo] = useState<CourseHeaderInfo | null>(null)
  // The bar exists on phones only, and never on the learning page.
  const showBottomNav = isPhone && !hiddenByRoute

  return (
    // Toasts and dialogs rise above the bar while it is mounted (DS 06).
    <BottomBarContext.Provider value={showBottomNav}>
      <CourseHeaderContext.Provider value={setCourseInfo}>
        <div className={styles.shell}>
          {/* First thing in the tab order, so the header and the navigation can be
              skipped instead of traversed on every route (WCAG 2.4.1). */}
          <a className="dsSkipLink" href="#main">
            Skip to content
          </a>
          <BrandStrip />
          {/* One header or the other, never both: they are different structures,
              so the unused one is not mounted rather than hidden. */}
          {contextual ? (
            <CourseContextHeader
              variant={isPhone ? 'phone' : 'tablet'}
              courseId={courseId}
              info={courseInfo}
            />
          ) : (
            <MemberHeader showNav={!isPhone} />
          )}

          <main
            id="main"
            tabIndex={-1}
            className={[styles.main, showBottomNav ? styles.withBottomNav : undefined]
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.container}>{children ?? <Outlet />}</div>
          </main>

          {showBottomNav ? <MemberBottomNav /> : null}
        </div>
      </CourseHeaderContext.Provider>
    </BottomBarContext.Provider>
  )
}
