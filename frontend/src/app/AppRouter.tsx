import { RouterProvider } from 'react-router-dom'
import { useMemo } from 'react'

import { createAppRouter } from './router'

/**
 * Mounts the browser router.
 *
 * The router is built once and kept for the life of the application, so a
 * re-render never remounts the shell or loses scroll and focus.
 */
export function AppRouter() {
  const router = useMemo(() => createAppRouter(), [])

  return <RouterProvider router={router} />
}
